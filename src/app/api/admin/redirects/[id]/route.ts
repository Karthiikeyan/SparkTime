import { adminRoute } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { deleteRedirect } from "@/server/services/redirects";

export const dynamic = "force-dynamic";

export const DELETE = adminRoute<{ id: string }>(async ({ actor, params }) => {
  await deleteRedirect(actor, params.id);
  invalidatePublicSite();
  return { ok: true };
});
