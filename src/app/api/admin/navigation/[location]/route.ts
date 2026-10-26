import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { replaceNavigation, type NavLocation } from "@/server/services/navigation";

export const dynamic = "force-dynamic";

export const PUT = adminRoute<{ location: string }>(async ({ req, actor, params }) => {
  const body = (await readJson(req)) as { items?: unknown };
  await replaceNavigation(actor, params.location as NavLocation, body.items);
  invalidatePublicSite();
  return { ok: true };
});
