import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { deleteMedia, findMediaReferences, updateMedia } from "@/server/services/media";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = adminRoute<Params>(async ({ params }) => ({ references: await findMediaReferences(params.id) }));

export const PATCH = adminRoute<Params>(async ({ req, actor, params }) => {
  const asset = await updateMedia(actor, params.id, await readJson(req));
  invalidatePublicSite();
  return asset;
});

export const DELETE = adminRoute<Params>(async ({ req, actor, params }) => {
  await deleteMedia(actor, params.id, { force: req.nextUrl.searchParams.get("force") === "1" });
  invalidatePublicSite();
  return { ok: true };
});
