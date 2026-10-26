import { json, publicRoute } from "@/server/http/route";
import { memoryRateLimit } from "@/server/http/memory-limit";
import { clientIp } from "@/server/services/rate-limit";
import { searchPublic } from "@/server/services/search";
import { loadAllSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";

/** Public search API: published + public documents only (see searchPublic). */
export const GET = publicRoute(async ({ req }) => {
  if (!(await loadAllSettings()).features.search) return json({ error: "Search is turned off." }, 404);
  if (!memoryRateLimit(`search:${clientIp(req.headers)}`, 60, 60_000)) return json({ error: "Too many searches. Slow down a little." }, 429);
  const q = req.nextUrl.searchParams.get("q")?.slice(0, 120) ?? "";
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 10);
  const results = q.trim().length >= 2 ? await searchPublic(q, { typeSlug: req.nextUrl.searchParams.get("type") ?? undefined, limit: Number.isFinite(limit) ? limit : 10 }) : [];
  return json({ results }, 200, { "Cache-Control": "public, max-age=0, s-maxage=60" });
});
