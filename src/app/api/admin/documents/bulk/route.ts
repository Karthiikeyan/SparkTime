import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { runBulkChunk } from "@/server/services/content-ops";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Runs one chunk (≤ 100 ids) of a bulk operation. The browser sends an operation as a sequence of these. */
export const POST = adminRoute(async ({ req, actor }) => {
  const result = await runBulkChunk(actor, await readJson(req, 64 * 1024));
  if (result.affectsPublic) invalidatePublicSite();
  return result;
});
