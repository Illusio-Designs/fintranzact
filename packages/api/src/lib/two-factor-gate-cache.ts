/**
 * Per (organisation, user) cache behind the two-factor gate: the member's
 * role, the organisation's policy and the user's 2FA flag in one entry, kept
 * ~30s. Separate from two-factor-gate.ts (like entitlements-cache.ts) so the
 * code that changes a policy, a membership or the 2FA flag can invalidate it
 * without importing the module that reads the database.
 *
 * The cache is per process. A change made on another instance shows here
 * within the TTL; the gate re-reads before refusing, so a user who has just
 * turned 2FA on is never kept out by a stale entry.
 */

export const TWO_FACTOR_GATE_CACHE_MS = 30_000;
const MAX_ENTRIES = 5000;

export interface GateMembership {
  role: string;
  memberSince: Date;
  policy: string;
  enforcedAt: Date | null;
  graceDays: number;
  hasTwoFactor: boolean;
}

/** null = the user has no membership in the organisation (never stored in the cache). */
export type GateEntry = GateMembership | null;

const SEP = "|";
const cache = new Map<string, { at: number; value: GateEntry }>();
const key = (tenantId: string, userId: string) => `${tenantId}${SEP}${userId}`;

export function gateCacheGet(tenantId: string, userId: string, now = Date.now()): { value: GateEntry } | undefined {
  const k = key(tenantId, userId);
  const hit = cache.get(k);
  if (!hit) return undefined;
  if (now - hit.at >= TWO_FACTOR_GATE_CACHE_MS) {
    cache.delete(k);
    return undefined;
  }
  return { value: hit.value };
}

export function gateCacheSet(tenantId: string, userId: string, value: GateEntry, now = Date.now()): void {
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key(tenantId, userId), { at: now, value });
}

/** One member's entry (membership added, removed or its role changed). */
export function invalidateTwoFactorGateMember(tenantId: string, userId: string): void {
  cache.delete(key(tenantId, userId));
}

/** Every member of one organisation (its policy changed). */
export function invalidateTwoFactorGateTenant(tenantId: string): void {
  const prefix = `${tenantId}${SEP}`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

/** Every organisation of one user (2FA turned on, off or reset). */
export function invalidateTwoFactorGateUser(userId: string): void {
  const suffix = `${SEP}${userId}`;
  for (const k of cache.keys()) if (k.endsWith(suffix)) cache.delete(k);
}

export function clearTwoFactorGateCache(): void {
  cache.clear();
}
