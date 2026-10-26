import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { getDocumentForEdit, setCollectionItems } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export const PUT = adminRoute<{ id: string }>(async ({ req, actor, params }) => {
  const result = await setCollectionItems(actor, params.id, await readJson(req));
  if (result.affectsPublic) invalidatePublicSite();
  return { items: (await getDocumentForEdit(actor, params.id)).collectionItems };
});
