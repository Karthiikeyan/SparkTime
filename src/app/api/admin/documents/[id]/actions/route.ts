import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { runDocumentAction } from "@/server/services/documents";

export const dynamic = "force-dynamic";

/** publish · discardChanges · setStatus · convert · derive · duplicate · changeSlug */
export const POST = adminRoute<{ id: string }>(async ({ req, actor, params }) => {
  const result = await runDocumentAction(actor, params.id, await readJson(req));
  if (result.affectsPublic) invalidatePublicSite();
  return result;
});
