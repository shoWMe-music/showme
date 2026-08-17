/**
 * Tiny in-memory sliding-window rate limiter — framework-agnostic and
 * dependency-free.
 *
 * NOTE: state lives in the process, so on a multi-instance / scale-to-zero
 * deployment (Cloud Run) it throttles per instance, not globally. It stops casual
 * abuse, accidental floods, and single-source spam; true global DoS protection
 * belongs at the edge (Cloud Armor / load-balancer rate limiting) once deploy
 * infra exists. See docs/STATUS.md.
 */
export interface RateLimiter {
  /** Records a hit for `key` and returns true if still within budget, false if over. */
  take(key: string): boolean;
}

export function createSlidingWindowRateLimiter(options: {
  limit: number;
  windowMs: number;
  /** Upper bound on tracked keys, to keep memory bounded under key churn. */
  maxKeys?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000, now = () => Date.now() } = options;
  const hits = new Map<string, number[]>();

  return {
    take(key) {
      const current = now();
      const cutoff = current - windowMs;
      const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(current);
      hits.set(key, recent);
      // Bound memory: evict the oldest-inserted key once we exceed the cap.
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return true;
    },
  };
}
