import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { deleteDocument, getDocumentForEdit, saveDocument } from "@/server/services/documents";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = adminRoute<Params>(async ({ actor, params }) => getDocumentForEdit(actor, params.id));

/** Autosave endpoint: body edits (staged if published) and settings. */
export const PATCH = adminRoute<Params>(async ({ req, actor, params }) => {
  const result = await saveDocument(actor, params.id, await readJson(req, 4 * 1024 * 1024));
  if (result.affectsPublic) invalidatePublicSite();
  return result;
});

export const DELETE = adminRoute<Params>(async ({ req, actor, params }) => {
  const body = (await readJson(req)) as { confirmation?: unknown };
  const result = await deleteDocument(actor, params.id, typeof body.confirmation === "string" ? body.confirmation : "");
  if (result.affectsPublic) invalidatePublicSite();
  return { ok: true };
});
