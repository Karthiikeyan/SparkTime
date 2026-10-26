import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { deleteContentType, setContentTypeArchived, updateContentType } from "@/server/services/content-types";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const PATCH = adminRoute<Params>(async ({ req, actor, params }) => {
  const body = (await readJson(req)) as { archived?: unknown };
  if (typeof body.archived === "boolean" && Object.keys(body).length === 1) {
    await setContentTypeArchived(actor, params.id, body.archived);
    invalidatePublicSite();
    return { ok: true };
  }
  const type = await updateContentType(actor, params.id, body);
  invalidatePublicSite();
  return type;
});

export const DELETE = adminRoute<Params>(async ({ actor, params }) => {
  await deleteContentType(actor, params.id);
  invalidatePublicSite();
  return { ok: true };
});
