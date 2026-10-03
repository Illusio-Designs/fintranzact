/**
 * Request-time enforcement of an organisation's two-factor policy.
 *
 * trpc.ts runs `twoFactorGate` on tenantProcedure, businessProcedure and
 * authorizedProcedure, after hasTenantAccess and before entitlementGate. The
 * decision itself is the pure twoFactorGateDecision below; the data comes from
 * ONE small control-database query per request, cached 30s per
 * (organisation, user) (two-factor-gate-cache.ts).
 *
 * Skipped: API keys (authTokenKind null: they never do 2FA), users who have
 * 2FA, organisations whose policy is off or does not cover the member's role,
 * the allowlisted paths a blocked user needs to see the setup prompt, and
 * anyone with no membership (platform admins). During the grace period nothing
 * is refused; the countdown is exposed on tenant.current.
 */

import { and, eq } from "drizzle-orm";
import { controlDb, tenantMembers, tenants, users } from "@fintranzact/db";
import {
  TWO_FACTOR_GATE_ALLOWED_PATHS,
  TWO_FACTOR_SETUP_PATH,
  twoFactorRequiredForMember,
  type TwoFactorPolicy,
  type TwoFactorRequirement,
  type TwoFactorRequirementView,
} from "@fintranzact/shared";
import { gateCacheGet, gateCacheSet, type GateEntry, type GateMembership } from "./two-factor-gate-cache.js";

export { TWO_FACTOR_GATE_ALLOWED_PATHS };

export type AuthTokenKind = "access" | "refresh" | "cookie" | null | undefined;

export interface GateDecisionInput {
  /** How the request authenticated; null = API key (or no session). */
  authTokenKind: AuthTokenKind;
  userHasTwoFactor: boolean;
  policy: string;
  role: string;
  enforcedAt: Date | null;
  graceDays: number;
  /** null = no membership in the organisation (platform admin): never gated. */
  memberSince: Date | null;
  now: Date;
  path: string;
}

export interface TwoFactorGateResult {
  allow: boolean;
  requirement: TwoFactorRequirement;
}

const NOT_REQUIRED: TwoFactorRequirement = { required: false, blocked: false, graceEndsAt: null };

/** The whole gate decision, pure. `allow: false` means throw twoFactorRequiredError(). */
export function twoFactorGateDecision(input: GateDecisionInput): TwoFactorGateResult {
  if (input.authTokenKind === null) return { allow: true, requirement: NOT_REQUIRED };
  if (input.userHasTwoFactor) return { allow: true, requirement: NOT_REQUIRED };
  if (!input.memberSince) return { allow: true, requirement: NOT_REQUIRED };
  const requirement = twoFactorRequiredForMember({
    policy: input.policy as TwoFactorPolicy,
    role: input.role,
    enforcedAt: input.enforcedAt,
    graceDays: input.graceDays,
    memberSince: input.memberSince,
    hasTwoFactor: false,
    now: input.now,
  });
  if (!requirement.blocked) return { allow: true, requirement };
  if (TWO_FACTOR_GATE_ALLOWED_PATHS.includes(input.path)) return { allow: true, requirement };
  return { allow: false, requirement };
}

/** What the caller must do in the selected organisation (tenant.current). */
export function twoFactorRequirementView(input: Omit<GateDecisionInput, "path">): TwoFactorRequirementView {
  const { requirement } = twoFactorGateDecision({ ...input, path: "" });
  return {
    ...requirement,
    policy: (input.policy as TwoFactorPolicy) ?? "off",
    setupPath: TWO_FACTOR_SETUP_PATH,
  };
}

// ── Data ────────────────────────────────────────────────────────────────────

/** The one small query: membership + policy + 2FA flag. */
export async function loadGateMembership(tenantId: string, userId: string): Promise<GateEntry> {
  const [row] = await controlDb
    .select({
      role: tenantMembers.role,
      memberSince: tenantMembers.createdAt,
      policy: tenants.twoFactorPolicy,
      enforcedAt: tenants.twoFactorEnforcedAt,
      graceDays: tenants.twoFactorGraceDays,
      hasTwoFactor: users.twoFactorEnabled,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Cached membership/policy/flag; `fresh` bypasses and refreshes the cache. */
export async function getGateMembership(
  tenantId: string,
  userId: string,
  opts: { fresh?: boolean } = {},
): Promise<{ entry: GateEntry; fromCache: boolean }> {
  if (!opts.fresh) {
    const hit = gateCacheGet(tenantId, userId);
    if (hit) return { entry: hit.value, fromCache: true };
  }
  const entry = await loadGateMembership(tenantId, userId);
  // A missing membership is never cached, so a user who has just joined is covered at once.
  if (entry) gateCacheSet(tenantId, userId, entry);
  return { entry, fromCache: false };
}

function decide(entry: GateEntry, authTokenKind: AuthTokenKind, path: string, now: Date): TwoFactorGateResult {
  const m: GateMembership | null = entry;
  return twoFactorGateDecision({
    authTokenKind,
    userHasTwoFactor: m?.hasTwoFactor ?? false,
    policy: m?.policy ?? "off",
    role: m?.role ?? "",
    enforcedAt: m?.enforcedAt ?? null,
    graceDays: m?.graceDays ?? 0,
    memberSince: m?.memberSince ?? null,
    now,
    path,
  });
}

/** Middleware body: true = let the request through. Re-reads once before refusing a cached verdict. */
export async function checkTwoFactorGate(args: {
  tenantId: string;
  userId: string;
  authTokenKind: AuthTokenKind;
  path: string;
  now?: Date;
}): Promise<boolean> {
  if (args.authTokenKind === null) return true;
  const now = args.now ?? new Date();
  const first = await getGateMembership(args.tenantId, args.userId);
  let result = decide(first.entry, args.authTokenKind, args.path, now);
  if (!result.allow && first.fromCache) {
    const fresh = await getGateMembership(args.tenantId, args.userId, { fresh: true });
    result = decide(fresh.entry, args.authTokenKind, args.path, now);
  }
  return result.allow;
}

/** The caller's requirement for `tenant.current` (cached; API keys are never required). */
export async function getTwoFactorRequirementForCaller(args: {
  tenantId: string;
  userId: string;
  authTokenKind: AuthTokenKind;
  now?: Date;
}): Promise<TwoFactorRequirementView> {
  const { entry } = await getGateMembership(args.tenantId, args.userId);
  return twoFactorRequirementView({
    authTokenKind: args.authTokenKind,
    userHasTwoFactor: entry?.hasTwoFactor ?? false,
    policy: entry?.policy ?? "off",
    role: entry?.role ?? "",
    enforcedAt: entry?.enforcedAt ?? null,
    graceDays: entry?.graceDays ?? 0,
    memberSince: entry?.memberSince ?? null,
    now: args.now ?? new Date(),
  });
}
