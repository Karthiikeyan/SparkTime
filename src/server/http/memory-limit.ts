import "server-only";

/**
 * Best-effort in-memory limiter for cheap, high-frequency public reads
 * (search-as-you-type). Per instance only; the contact form and login use
 * the Postgres-backed limiter instead.
 */
const buckets = new Map<string, { count: number; reset: number }>();

export function memoryRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}
