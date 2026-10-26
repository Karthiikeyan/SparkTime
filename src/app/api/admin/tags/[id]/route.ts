import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { deleteTag, updateTag } from "@/server/services/taxonomy";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const PATCH = adminRoute<Params>(async ({ req, actor, params }) => {
  const tag = await updateTag(actor, params.id, await readJson(req));
  invalidatePublicSite();
  return tag;
});

export const DELETE = adminRoute<Params>(async ({ actor, params }) => {
  await deleteTag(actor, params.id);
  invalidatePublicSite();
  return { ok: true };
});
