import "server-only";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { env } from "../env";

/**
 * Fixed-window rate limiting stored in Postgres, so limits hold across
 * serverless instances (an in-memory counter resets on every cold start).
 * One atomic upsert per check.
 */
export async function consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }> {
  const result = await getDb().execute(sql`
    insert into studio.rate_limits (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when studio.rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else studio.rate_limits.count + 1 end,
      window_start = case when studio.rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else studio.rate_limits.window_start end
    returning count
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{ count: number }>;
  const used = Number(rows[0]?.count ?? 1);
  return { allowed: used <= limit, remaining: Math.max(0, limit - used) };
}

/** Hash an IP with the server secret so raw addresses are never stored. */
export function hashIdentifier(value: string): string {
  const secret = env().AUTH_SECRET ?? "dev-only-secret";
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

/** Best-effort client IP from the platform's proxy headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Periodic cleanup of stale windows (called from the keep-alive cron). */
export async function pruneRateLimits(): Promise<void> {
  await getDb().execute(sql`delete from studio.rate_limits where window_start < now() - interval '1 day'`);
}
