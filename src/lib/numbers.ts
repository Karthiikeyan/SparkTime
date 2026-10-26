/**
 * Query-string numbers arrive as Number(...) of attacker-controlled text, so
 * they can be NaN, ±Infinity or negative. Postgres rejects those as LIMIT /
 * OFFSET parameters (a 500), so every paging value goes through here first.
 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
