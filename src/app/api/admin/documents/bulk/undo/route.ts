import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { undoBulkOperation } from "@/server/services/content-ops";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Undoes a recent reversible bulk operation, from the server's own record of it. */
export const POST = adminRoute(async ({ req, actor }) => {
  const result = await undoBulkOperation(actor, await readJson(req, 4 * 1024));
  if (result.affectsPublic) invalidatePublicSite();
  return result;
});
