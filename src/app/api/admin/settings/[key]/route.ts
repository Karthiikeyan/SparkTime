import { isSettingsKey } from "@/lib/settings";
import { notFound } from "@/server/errors";
import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { updateSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";

export const PUT = adminRoute<{ key: string }>(async ({ req, actor, params }) => {
  if (!isSettingsKey(params.key)) throw notFound("Settings group");
  const value = await updateSettings(actor, params.key, await readJson(req));
  invalidatePublicSite();
  return value;
});
