import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { createTag, listTags, mergeTags, taxonomyUsage } from "@/server/services/taxonomy";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async ({ actor }) => ({ items: await listTags(), usage: (await taxonomyUsage(actor)).tags }));

export const POST = adminRoute(async ({ req, actor }) => {
  const body = (await readJson(req)) as { mergeFrom?: unknown; mergeInto?: unknown };
  if (typeof body.mergeFrom === "string" && typeof body.mergeInto === "string") {
    await mergeTags(actor, body.mergeFrom, body.mergeInto);
    invalidatePublicSite();
    return { ok: true };
  }
  const tag = await createTag(actor, body);
  return tag;
});
