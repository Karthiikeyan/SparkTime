import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { getDocumentForEdit, setDocumentTaxonomy } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export const PUT = adminRoute<{ id: string }>(async ({ req, actor, params }) => {
  const result = await setDocumentTaxonomy(actor, params.id, await readJson(req));
  if (result.affectsPublic) invalidatePublicSite();
  const doc = await getDocumentForEdit(actor, params.id);
  return { categories: doc.categories, tags: doc.tags };
});
