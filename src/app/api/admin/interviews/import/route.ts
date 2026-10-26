import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { runInterviewImport } from "@/server/services/interview-import";

export const dynamic = "force-dynamic";

/** Import a previewed company package with the options shown in the preview (publication, indexing, pages). */
export const POST = adminRoute(async ({ req, actor }) => {
  const result = await runInterviewImport(actor, await readJson(req, 4 * 1024 * 1024));
  if (result.affectsPublic) invalidatePublicSite();
  return result;
});
