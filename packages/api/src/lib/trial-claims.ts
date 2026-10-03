/**
 * One trial per business. A claim says "a trial was already used for this
 * email / phone / GSTIN" and stores only a salted SHA-256 hash of the
 * normalised value (trial_claims), never the value itself.
 *
 * Rules the callers rely on:
 *  - checking never fails a sign-up: `hasClaim` is a plain lookup, and a claim
 *    that cannot be recorded is logged and treated as "no conflict";
 *  - the answer never says WHICH organisation holds a claim, only that one
 *    exists;
 *  - recording is atomic and idempotent: UNIQUE (kind, value_hash) with
 *    ON CONFLICT DO NOTHING, so saving the same value again on the same
 *    organisation is a no-op and two racing sign-ups cannot both win;
 *  - GSTIN claims cannot be used to poison someone else's number: only a
 *    well-formed GSTIN with a valid check digit counts, an organisation holds
 *    at most MAX_GSTIN_CLAIMS_PER_TENANT, and saves are rate-limited per
 *    organisation;
 *  - TRIAL_CLAIMS=off turns every check off (self-hosted installs, e2e).
 */

import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { controlDb, tenants, trialClaims } from "@fintranzact/db";
import {
  normaliseClaimValue,
  type TrialClaimKind,
} from "@fintranzact/shared";
import { createFixedWindowLimiter } from "./fixed-window-limiter.js";
import { logger } from "./logger.js";
import { invalidateEntitlements } from "./entitlements-cache.js";
import { recordBillingEvent } from "./billing/service.js";

type DbLike = Pick<typeof controlDb, "select" | "insert" | "update">;

export const MAX_GSTIN_CLAIMS_PER_TENANT = 3;

/** False when TRIAL_CLAIMS=off: no claim is checked or recorded. */
export function trialClaimsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRIAL_CLAIMS?.trim().toLowerCase() !== "off";
}

function salt(): string {
  return process.env.TRIAL_CLAIM_SALT || process.env.DB_ENCRYPTION_KEY || "fintranzact-trial-claims-v1";
}

/** Salted SHA-256 of the normalised value; the kind is part of the input so values never collide across kinds. */
export function hashClaimValue(kind: TrialClaimKind, normalised: string, saltValue: string = salt()): string {
  return createHash("sha256").update(`${saltValue}:${kind}:${normalised}`).digest("hex");
}

export interface ClaimInput {
  kind: TrialClaimKind;
  /** Raw value as entered; normalised here. */
  value: string | null | undefined;
}

export interface HashedClaim {
  kind: TrialClaimKind;
  hash: string;
}

/** Normalise and hash; values that are not valid for their kind are dropped. */
export function hashClaims(inputs: ClaimInput[]): HashedClaim[] {
  const out: HashedClaim[] = [];
  for (const i of inputs) {
    const normalised = normaliseClaimValue(i.kind, i.value);
    if (!normalised) continue;
    const hash = hashClaimValue(i.kind, normalised);
    if (!out.some((c) => c.kind === i.kind && c.hash === hash)) out.push({ kind: i.kind, hash });
  }
  return out;
}

/** True when any of the claims is already held. Never throws: a failed lookup counts as no claim. */
export async function anyClaimHeld(db: DbLike, claims: HashedClaim[]): Promise<boolean> {
  if (claims.length === 0 || !trialClaimsEnabled()) return false;
  try {
    for (const c of claims) {
      const [row] = await db
        .select({ id: trialClaims.id })
        .from(trialClaims)
        .where(and(eq(trialClaims.kind, c.kind), eq(trialClaims.valueHash, c.hash)))
        .limit(1);
      if (row) return true;
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[trial] claim lookup failed");
  }
  return false;
}

/**
 * Record the claims for an organisation. Returns true when every claim is
 * now held by THIS organisation (newly recorded or already its own), false
 * when at least one is held by another organisation (or one whose organisation
 * has since been deleted). Call it inside the sign-up transaction.
 */
export async function recordClaims(db: DbLike, tenantId: string, claims: HashedClaim[]): Promise<boolean> {
  if (claims.length === 0 || !trialClaimsEnabled()) return true;
  let ok = true;
  for (const c of claims) {
    const inserted = await db
      .insert(trialClaims)
      .values({ kind: c.kind, valueHash: c.hash, tenantId })
      .onConflictDoNothing()
      .returning({ id: trialClaims.id });
    if (inserted.length > 0) continue;
    const [held] = await db
      .select({ tenantId: trialClaims.tenantId })
      .from(trialClaims)
      .where(and(eq(trialClaims.kind, c.kind), eq(trialClaims.valueHash, c.hash)))
      .limit(1);
    if (!held || held.tenantId !== tenantId) ok = false;
  }
  return ok;
}

// ── GSTIN, when a business first saves one ──────────────────────────────────

const gstinLimiter = createFixedWindowLimiter({ limit: 10, windowMs: 60 * 60_000 });

export function clearGstinClaimLimiter(): void {
  gstinLimiter.clear();
}

export type GstinClaimResult =
  | { status: "ignored"; reason: "disabled" | "invalid" | "not_applicable" | "rate_limited" | "cap" }
  | { status: "claimed" }
  | { status: "denied" };

/**
 * Called when a business saves a GSTIN. Only an organisation that started a
 * self-serve trial (source signup or partner) takes part. If the GSTIN is not
 * claimed yet, this organisation claims it. If another organisation holds it
 * and this organisation's trial is still running, the trial ends now (source
 * "none") and the organisation is read-only until a plan is bought; the
 * answer is the same whoever holds the claim. Re-saving the same GSTIN is a
 * no-op. Never throws.
 */
export async function claimGstinForTenant(tenantId: string, gstin: string | null | undefined, now: Date = new Date()): Promise<GstinClaimResult> {
  try {
    if (!trialClaimsEnabled()) return { status: "ignored", reason: "disabled" };
    const [claim] = hashClaims([{ kind: "gstin", value: gstin }]);
    if (!claim) return { status: "ignored", reason: "invalid" };

    const [tenant] = await controlDb
      .select({
        source: tenants.trialSource,
        endsAt: tenants.trialEndsAt,
        grandfathered: tenants.accessGrandfathered,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant || tenant.grandfathered || (tenant.source !== "signup" && tenant.source !== "partner")) {
      return { status: "ignored", reason: "not_applicable" };
    }

    if (!gstinLimiter.hit(tenantId)) return { status: "ignored", reason: "rate_limited" };

    const [mine] = await controlDb
      .select({ n: sql<number>`count(*)::int` })
      .from(trialClaims)
      .where(and(eq(trialClaims.tenantId, tenantId), eq(trialClaims.kind, "gstin")));
    const held = await controlDb
      .select({ tenantId: trialClaims.tenantId })
      .from(trialClaims)
      .where(and(eq(trialClaims.kind, "gstin"), eq(trialClaims.valueHash, claim.hash)))
      .limit(1);
    const existing = held[0];
    if (existing && existing.tenantId === tenantId) return { status: "claimed" }; // idempotent
    if (!existing && (mine?.n ?? 0) >= MAX_GSTIN_CLAIMS_PER_TENANT) return { status: "ignored", reason: "cap" };

    const ok = existing ? false : await recordClaims(controlDb, tenantId, [claim]);
    if (ok) return { status: "claimed" };

    // Held by someone else: this organisation's trial ends now if it is still running.
    const trialRunning = !!tenant.endsAt && tenant.endsAt.getTime() > now.getTime();
    if (trialRunning) {
      await controlDb
        .update(tenants)
        .set({ trialEndsAt: now, trialSource: "none", updatedAt: now })
        .where(and(eq(tenants.id, tenantId), inArray(tenants.trialSource, ["signup", "partner"])));
      invalidateEntitlements(tenantId);
      await recordBillingEvent({
        provider: "local",
        type: "tenant.trial_denied",
        tenantId,
        payload: { kind: "gstin" },
      });
    }
    return { status: "denied" };
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[trial] gstin claim failed");
    return { status: "ignored", reason: "not_applicable" };
  }
}
