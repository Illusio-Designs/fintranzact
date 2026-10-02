/**
 * Per-organisation cache behind getEntitlements. Separate from
 * entitlements.ts so the billing service can invalidate it without importing
 * the module that imports the service.
 */

export const ENTITLEMENTS_CACHE_MS = 30_000;

const cache = new Map<string, { at: number; value: unknown }>();

export function cacheGet<T>(tenantId: string, now = Date.now()): T | undefined {
  const hit = cache.get(tenantId);
  if (!hit) return undefined;
  if (now - hit.at >= ENTITLEMENTS_CACHE_MS) {
    cache.delete(tenantId);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet(tenantId: string, value: unknown, now = Date.now()): void {
  cache.set(tenantId, { at: now, value });
}

/** Forget one organisation's entitlements (every billing/plan/trial/status change calls this). */
export function invalidateEntitlements(tenantId: string): void {
  cache.delete(tenantId);
}

/** Forget everything (tests, and plan-catalogue edits that change limits). */
export function clearEntitlementsCache(): void {
  cache.clear();
}
