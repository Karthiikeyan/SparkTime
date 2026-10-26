import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { getDocumentForEdit, setDocumentRelations } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export const PUT = adminRoute<{ id: string }>(async ({ req, actor, params }) => {
  const result = await setDocumentRelations(actor, params.id, await readJson(req));
  if (result.affectsPublic) invalidatePublicSite();
  return { relations: (await getDocumentForEdit(actor, params.id)).relations };
});
