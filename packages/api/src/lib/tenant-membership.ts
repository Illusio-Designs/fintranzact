/**
 * "Is this user still a member of this organisation?" asked on EVERY
 * tenant-scoped request (hasTenantAccess in trpc.ts).
 *
 * Why: a session carries its tenantId (cached up to 60s per process) and an
 * API key carries one forever, neither proves the person is still in the
 * organisation. Removing a member clears the removing instance's caches, but
 * other instances honour the old tenantId until their cache expires, and an
 * API key has no session to clear. Asking tenant_members (unique index on
 * (tenant_id, user_id), one indexed row lookup) closes both.
 *
 * Cost: only a POSITIVE answer is cached, 15s per process, keyed
 * (tenantId, userId). So one lookup per member per organisation per process
 * per 15s, not one per request. Only existence is cached (never the role:
 * the role is read from tenant_members by withPermissions on each request).
 * A "no" is never cached, so a person added or re-added is let in at once.
 *
 * Residual window: removal invalidates the entry on the instance that handled
 * it. Another instance may keep answering "yes" for up to
 * MEMBERSHIP_CACHE_MS (15s), the cross-instance bound documented in
 * docs/ACCOUNTANT-ACCESS.md (shorter than the 60s session cache).
 */
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { controlDb, tenantMembers } from "@fintranzact/db";

export const MEMBERSHIP_CACHE_MS = 15_000;
export const ACCESS_REMOVED_MESSAGE = "You no longer have access to this organisation";
const MAX_ENTRIES = 5000;

const SEP = "|";
const cache = new Map<string, number>(); // key -> time of the positive answer
const key = (tenantId: string, userId: string) => `${tenantId}${SEP}${userId}`;

export interface MembershipDeps {
  /** True when a tenant_members row exists for (tenantId, userId). */
  lookup(tenantId: string, userId: string): Promise<boolean>;
  now(): number;
}

const defaultDeps: MembershipDeps = {
  async lookup(tenantId, userId) {
    const [row] = await controlDb
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
      .limit(1);
    return !!row;
  },
  now: () => Date.now(),
};

export async function isCurrentTenantMember(
  tenantId: string,
  userId: string,
  deps: MembershipDeps = defaultDeps,
): Promise<boolean> {
  const k = key(tenantId, userId);
  const at = cache.get(k);
  const now = deps.now();
  if (at !== undefined) {
    if (now - at < MEMBERSHIP_CACHE_MS) return true;
    cache.delete(k);
  }
  if (!(await deps.lookup(tenantId, userId))) return false;
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(k, now);
  return true;
}

/** Throws FORBIDDEN (a plain, clean error) when the user has no membership. */
export async function requireTenantMembership(
  tenantId: string,
  userId: string,
  deps: MembershipDeps = defaultDeps,
): Promise<void> {
  if (!(await isCurrentTenantMember(tenantId, userId, deps))) {
    throw new TRPCError({ code: "FORBIDDEN", message: ACCESS_REMOVED_MESSAGE });
  }
}

/** Call when a membership is removed or its role changes (this process only). */
export function invalidateTenantMembership(tenantId: string, userId: string): void {
  cache.delete(key(tenantId, userId));
}

/** Test hook: forget every cached answer. */
export function clearTenantMembershipCache(): void {
  cache.clear();
}
