/**
 * Full Access Trial: starting one at sign-up and the platform admin's controls.
 *
 * Storage is on the organisation row: trial_started_at, trial_ends_at and
 * trial_source (signup | partner | admin | none). deriveAccess (shared) turns
 * that into access: Business-level and the add-ons while it runs, then
 * read-only until a plan is bought. Nothing is deleted at the end.
 *
 * Starting (sign-up, tenant.create): decideNewOrgTrial looks at the owner's
 * email claim and the partner code and returns the fields to insert with the
 * organisation; finishNewOrgTrial records the claim in the same transaction
 * and, if another sign-up won the race for the same email, turns the trial
 * into "none". An organisation with no trial (a trial was already used) is
 * stored as started-and-ended-now, so it is read-only until a plan is bought.
 *
 * Admin controls (all recorded in billing_events with the acting admin and the
 * reason, and all drop the entitlements cache and reset the reminder log):
 * extendTrial, grantCustomTrial, endTrialNow and the raw setTrial.
 */

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { controlDb, tenants } from "@fintranzact/db";
import {
  TRIAL_ADMIN_MAX_DAYS,
  trialDaysForSource,
  trialWindow,
  type TrialSource,
} from "@fintranzact/shared";
import { invalidateEntitlements } from "./entitlements-cache.js";
import { recordBillingEvent } from "./billing/service.js";
import { getEntitlements } from "./entitlements.js";
import { getTrialSettings } from "./trial-settings.js";
import { anyClaimHeld, hashClaims, recordClaims, type ClaimInput, type HashedClaim } from "./trial-claims.js";
import { resetTrialReminders } from "./trial-reminders.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type DbLike = Pick<typeof controlDb, "select" | "insert" | "update">;

export interface NewOrgTrial {
  trialStartedAt: Date;
  trialEndsAt: Date;
  trialSource: TrialSource;
  /** What to record in trial_claims once the organisation row exists. */
  claims: HashedClaim[];
}

/**
 * The trial a brand-new organisation gets. `partner` is true when a valid,
 * approved partner referral code was used (a longer trial). When a claim for
 * the owner's email (or phone, where collected) is already held, there is no
 * trial: the organisation starts read-only until a plan is bought.
 */
export async function decideNewOrgTrial(
  db: DbLike,
  opts: { email?: string | null; phone?: string | null; partner?: boolean; now?: Date },
): Promise<NewOrgTrial> {
  const now = opts.now ?? new Date();
  const claimInputs: ClaimInput[] = [
    { kind: "email", value: opts.email },
    { kind: "phone", value: opts.phone },
  ];
  const claims = hashClaims(claimInputs);
  if (await anyClaimHeld(db, claims)) {
    return { trialStartedAt: now, trialEndsAt: now, trialSource: "none", claims: [] };
  }
  const settings = await getTrialSettings();
  const source = opts.partner ? "partner" : "signup";
  const { startedAt, endsAt } = trialWindow(now, trialDaysForSource(source, settings));
  return { trialStartedAt: startedAt, trialEndsAt: endsAt, trialSource: source, claims };
}

/**
 * Record the claims in the organisation's own transaction. If another
 * sign-up claimed the same email between the lookup and now, this
 * organisation's trial is turned into "none" (still inside the transaction).
 * Returns whether the trial stands.
 */
export async function finishNewOrgTrial(db: DbLike, tenantId: string, trial: NewOrgTrial): Promise<boolean> {
  if (trial.trialSource === "none") return false;
  const ok = await recordClaims(db, tenantId, trial.claims);
  if (ok) return true;
  const now = new Date();
  await db.update(tenants).set({ trialEndsAt: now, trialSource: "none" }).where(eq(tenants.id, tenantId));
  return false;
}

// ── Admin controls ──────────────────────────────────────────────────────────

export interface TrialActor {
  actorUserId?: string;
}

interface TrialRow {
  id: string;
  trialEndsAt: Date | null;
  trialStartedAt: Date | null;
  trialSource: string | null;
}

async function loadTrialRow(tenantId: string): Promise<(TrialRow & { accessGrandfathered: boolean }) | null> {
  const [row] = await controlDb
    .select({
      id: tenants.id,
      trialEndsAt: tenants.trialEndsAt,
      trialStartedAt: tenants.trialStartedAt,
      trialSource: tenants.trialSource,
      accessGrandfathered: tenants.accessGrandfathered,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row ?? null;
}

async function applyTrial(
  tenantId: string,
  before: TrialRow,
  next: { trialEndsAt: Date | null; trialStartedAt: Date | null; trialSource: TrialSource | null },
  event: { type: string; actorUserId?: string; reason?: string | null; extra?: Record<string, unknown> },
  now: Date,
): Promise<{ id: string; trialEndsAt: Date | null; trialStartedAt: Date | null; trialSource: string | null }> {
  const [row] = await controlDb
    .update(tenants)
    .set({ ...next, updatedAt: now })
    .where(eq(tenants.id, tenantId))
    .returning({
      id: tenants.id,
      trialEndsAt: tenants.trialEndsAt,
      trialStartedAt: tenants.trialStartedAt,
      trialSource: tenants.trialSource,
    });
  invalidateEntitlements(tenantId);
  await resetTrialReminders(tenantId, now);
  await recordBillingEvent({
    provider: "local",
    type: event.type,
    tenantId,
    payload: {
      from: before.trialEndsAt?.toISOString() ?? null,
      to: next.trialEndsAt?.toISOString() ?? null,
      source: next.trialSource,
      reason: event.reason ?? null,
      actorUserId: event.actorUserId ?? null,
      ...event.extra,
    },
  });
  return row!;
}

/**
 * Set the trial end (or clear it with null). The raw control behind
 * platform.setTrial: a new trial is stamped as started now with source
 * "admin"; clearing also clears start and source. Returns null when the
 * organisation does not exist.
 */
export async function setTrial(
  tenantId: string,
  endsAt: Date | null,
  opts: TrialActor & { reason?: string | null; now?: Date } = {},
): Promise<{ id: string; trialEndsAt: Date | null } | null> {
  const before = await loadTrialRow(tenantId);
  if (!before) return null;
  const now = opts.now ?? new Date();
  const row = await applyTrial(
    tenantId,
    before,
    endsAt
      ? { trialEndsAt: endsAt, trialStartedAt: before.trialStartedAt ?? now, trialSource: (before.trialSource as TrialSource | null) ?? "admin" }
      : { trialEndsAt: null, trialStartedAt: null, trialSource: null },
    { type: "tenant.trial_set", actorUserId: opts.actorUserId, reason: opts.reason },
    now,
  );
  return { id: row.id, trialEndsAt: row.trialEndsAt };
}

/** Whether this organisation is on a plan that makes a trial pointless (paid or grandfathered). */
async function refuseIfPaidOrGrandfathered(tenantId: string, grandfathered: boolean, now: Date): Promise<void> {
  if (grandfathered) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This organisation has permanent full access (grandfathered); it needs no trial." });
  }
  const ent = await getEntitlements(tenantId, now);
  if (ent.state === "active" || ent.state === "past_due_grace") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This organisation already has a paid plan; a trial would change nothing." });
  }
}

/**
 * Add days to a trial: from its current end when it is still running, from
 * now when it has ended (or never ran). Allowed whatever its source, including
 * "none"; a "none" organisation becomes source "admin".
 */
export async function extendTrial(
  tenantId: string,
  days: number,
  opts: TrialActor & { reason: string; now?: Date },
): Promise<{ id: string; trialEndsAt: Date | null; trialStartedAt: Date | null; trialSource: string | null }> {
  assertDays(days);
  const before = await loadTrialRow(tenantId);
  if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found" });
  const now = opts.now ?? new Date();
  await refuseIfPaidOrGrandfathered(tenantId, before.accessGrandfathered, now);
  const from = before.trialEndsAt && before.trialEndsAt.getTime() > now.getTime() ? before.trialEndsAt : now;
  const endsAt = new Date(from.getTime() + days * DAY_MS);
  const source: TrialSource = !before.trialSource || before.trialSource === "none" ? "admin" : (before.trialSource as TrialSource);
  return applyTrial(
    tenantId,
    before,
    { trialEndsAt: endsAt, trialStartedAt: before.trialStartedAt ?? now, trialSource: source },
    { type: "tenant.trial_extended", actorUserId: opts.actorUserId, reason: opts.reason, extra: { days } },
    now,
  );
}

/**
 * A custom trial of `days` days starting now, source "admin". Allowed even
 * when a claim exists (that is its purpose); refused for a grandfathered or
 * already-paying organisation.
 */
export async function grantCustomTrial(
  tenantId: string,
  days: number,
  opts: TrialActor & { reason: string; now?: Date },
): Promise<{ id: string; trialEndsAt: Date | null; trialStartedAt: Date | null; trialSource: string | null }> {
  assertDays(days);
  const before = await loadTrialRow(tenantId);
  if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found" });
  const now = opts.now ?? new Date();
  await refuseIfPaidOrGrandfathered(tenantId, before.accessGrandfathered, now);
  const { startedAt, endsAt } = trialWindow(now, days);
  return applyTrial(
    tenantId,
    before,
    { trialEndsAt: endsAt, trialStartedAt: startedAt, trialSource: "admin" },
    { type: "tenant.trial_granted", actorUserId: opts.actorUserId, reason: opts.reason, extra: { days } },
    now,
  );
}

/** End a running trial now; the organisation is read-only until a plan is bought. */
export async function endTrialNow(
  tenantId: string,
  opts: TrialActor & { reason: string; now?: Date },
): Promise<{ id: string; trialEndsAt: Date | null; trialStartedAt: Date | null; trialSource: string | null }> {
  const before = await loadTrialRow(tenantId);
  if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found" });
  const now = opts.now ?? new Date();
  if (before.accessGrandfathered) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This organisation has permanent full access (grandfathered); it has no trial to end." });
  }
  if (!before.trialEndsAt || before.trialEndsAt.getTime() <= now.getTime()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This organisation has no running trial to end." });
  }
  return applyTrial(
    tenantId,
    before,
    { trialEndsAt: now, trialStartedAt: before.trialStartedAt ?? now, trialSource: (before.trialSource as TrialSource | null) ?? "admin" },
    { type: "tenant.trial_ended", actorUserId: opts.actorUserId, reason: opts.reason },
    now,
  );
}

function assertDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > TRIAL_ADMIN_MAX_DAYS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Days must be a whole number from 1 to ${TRIAL_ADMIN_MAX_DAYS}.` });
  }
}
