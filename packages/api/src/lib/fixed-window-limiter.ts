/**
 * Small in-memory fixed-window rate limiter, keyed by any string (usually an
 * IP address). Same shape as the per-IP maps in server.ts, packaged so a
 * router can own its own limit without reaching into the HTTP layer.
 *
 * In-memory means per process: good enough for a single API instance and for
 * blunting form spam. Stale windows are swept every five minutes.
 */
export function createFixedWindowLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, { count: number; reset: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now > entry.reset) hits.delete(key);
    }
  }, 5 * 60_000).unref();

  return {
    /** Count one request for `key`. Returns false once the key is over the limit. */
    hit(key: string): boolean {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || now > entry.reset) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return true;
      }
      if (entry.count >= limit) return false;
      entry.count++;
      return true;
    },
    /** Forget every key (tests only). */
    clear() {
      hits.clear();
    },
  };
}
