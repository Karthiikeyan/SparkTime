import { ServiceError } from "@/server/errors";
import { adminRoute, readJson } from "@/server/http/route";
import { memoryRateLimit } from "@/server/http/memory-limit";
import { fetchLinkPreview } from "@/server/services/link-preview";

export const dynamic = "force-dynamic";

export const POST = adminRoute(async ({ req, actor }) => {
  if (!memoryRateLimit(`preview:${actor.userId}`, 30, 60_000)) throw new ServiceError("rate_limited", "Too many previews — try again in a minute.");
  const body = (await readJson(req)) as { url?: unknown };
  return fetchLinkPreview(actor, body.url);
});
