import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { createContentType, listContentTypes, reorderContentTypes } from "@/server/services/content-types";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => ({ items: await listContentTypes() }));

export const POST = adminRoute(async ({ req, actor }) => {
  const type = await createContentType(actor, await readJson(req));
  invalidatePublicSite();
  return type;
});

/** Reorder: { order: string[] } */
export const PUT = adminRoute(async ({ req, actor }) => {
  const body = (await readJson(req)) as { order?: unknown };
  await reorderContentTypes(actor, Array.isArray(body.order) ? (body.order as string[]) : []);
  invalidatePublicSite();
  return { ok: true };
});
