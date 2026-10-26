import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { createCategory, listCategories, mergeCategories, reorderCategories, taxonomyUsage } from "@/server/services/taxonomy";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async ({ actor }) => ({ items: await listCategories(), usage: (await taxonomyUsage(actor)).categories }));

export const POST = adminRoute(async ({ req, actor }) => {
  const body = (await readJson(req, 1024 * 1024)) as { mergeFrom?: unknown; mergeInto?: unknown };
  if (typeof body.mergeFrom === "string" && typeof body.mergeInto === "string") {
    const result = await mergeCategories(actor, body.mergeFrom, body.mergeInto);
    invalidatePublicSite();
    return result;
  }
  const category = await createCategory(actor, body);
  invalidatePublicSite();
  return category;
});

export const PUT = adminRoute(async ({ req, actor }) => {
  const body = (await readJson(req)) as { order?: unknown };
  await reorderCategories(actor, Array.isArray(body.order) ? (body.order as string[]) : []);
  invalidatePublicSite();
  return { ok: true };
});
