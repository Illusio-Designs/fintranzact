/**
 * tenant.setSecurityPolicy: an organisation's two-factor policy.
 *
 * Persistence and side effects are injected (PolicyDeps) so the rules are
 * unit-testable without a database. Wiring is in routers/tenant.ts.
 *
 *  - Only the owner (and superadmin) may change it, like billing.
 *  - The caller must have 2FA on to set anything but 'off', so the person
 *    switching enforcement on can never lock themselves (or the only owner)
 *    out. That also covers the "only owner without 2FA, grace 0" case.
 *  - enforcedAt (the start of everyone's grace period) moves to now only when
 *    the policy is TIGHTENED (off -> admins/all, admins -> all) or the grace
 *    days change while enforcing. Relaxing keeps it; 'off' clears it.
 */

import { TRPCError } from "@trpc/server";
import { DEFAULT_TWO_FACTOR_GRACE_DAYS, type TwoFactorPolicy } from "@fintranzact/shared";
import type { SecurityEventInput } from "./security-events.js";

export const POLICY_MANAGER_ROLES: readonly string[] = ["owner", "superadmin"];
export const MAX_GRACE_DAYS = 30;
export const OWN_TWO_FACTOR_FIRST_MESSAGE = "Turn on two-factor authentication for your own account first.";

const RANK: Record<TwoFactorPolicy, number> = { off: 0, admins: 1, all: 2 };

export interface PolicyState {
  policy: TwoFactorPolicy;
  graceDays: number;
  enforcedAt: Date | null;
}

export interface PolicyDeps {
  getPolicy(tenantId: string): Promise<PolicyState | null>;
  getCaller(tenantId: string, userId: string): Promise<{ role: string; hasTwoFactor: boolean } | null>;
  save(tenantId: string, next: PolicyState): Promise<void>;
  record(event: SecurityEventInput): Promise<void>;
  /** Forget cached gate entries for the organisation. */
  invalidate(tenantId: string): void;
  now(): Date;
}

export interface PolicyInput {
  policy: TwoFactorPolicy;
  graceDays?: number;
}

/** Pure: the state to store, or null when nothing would change. */
export function nextPolicyState(current: PolicyState, input: PolicyInput, now: Date): PolicyState | null {
  const graceDays = input.graceDays ?? current.graceDays;
  if (input.policy === current.policy && graceDays === current.graceDays) return null;
  if (input.policy === "off") return { policy: "off", graceDays, enforcedAt: null };
  const tightened = RANK[input.policy] > RANK[current.policy];
  const graceChanged = graceDays !== current.graceDays;
  return {
    policy: input.policy,
    graceDays,
    enforcedAt: tightened || graceChanged || !current.enforcedAt ? now : current.enforcedAt,
  };
}

export async function setSecurityPolicy(
  deps: PolicyDeps,
  args: { tenantId: string; actorId: string; input: PolicyInput; ip?: string | null; userAgent?: string | null },
): Promise<PolicyState> {
  const { tenantId, actorId, input } = args;
  if (input.graceDays !== undefined && (!Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > MAX_GRACE_DAYS)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Grace period must be between 0 and ${MAX_GRACE_DAYS} days.` });
  }

  const caller = await deps.getCaller(tenantId, actorId);
  if (!caller || !POLICY_MANAGER_ROLES.includes(caller.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the organization owner can change security settings." });
  }
  if (input.policy !== "off" && !caller.hasTwoFactor) {
    throw new TRPCError({ code: "BAD_REQUEST", message: OWN_TWO_FACTOR_FIRST_MESSAGE });
  }

  const current = (await deps.getPolicy(tenantId)) ?? { policy: "off" as const, graceDays: DEFAULT_TWO_FACTOR_GRACE_DAYS, enforcedAt: null };
  const next = nextPolicyState(current, input, deps.now());
  if (!next) return current;

  await deps.save(tenantId, next);
  deps.invalidate(tenantId);
  await deps.record({
    userId: actorId,
    actorUserId: actorId,
    tenantId,
    type: "2fa.policy_changed",
    ip: args.ip,
    userAgent: args.userAgent,
    metadata: {
      tenant_id: tenantId,
      actor: actorId,
      from: { policy: current.policy, graceDays: current.graceDays },
      to: { policy: next.policy, graceDays: next.graceDays },
      enforcedAt: next.enforcedAt ? next.enforcedAt.toISOString() : null,
    },
  });
  return next;
}
