import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { createRedirect, listRedirects } from "@/server/services/redirects";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async ({ actor }) => ({ items: await listRedirects(actor) }));

export const POST = adminRoute(async ({ req, actor }) => {
  const body = (await readJson(req)) as { fromPath?: unknown; toPath?: unknown; permanent?: unknown };
  await createRedirect(actor, {
    fromPath: String(body.fromPath ?? ""),
    toPath: String(body.toPath ?? ""),
    statusCode: body.permanent === false ? 307 : 308,
  });
  invalidatePublicSite();
  return { ok: true };
});
