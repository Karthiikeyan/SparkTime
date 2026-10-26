import { adminRoute, readJson } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { deleteCategory, setCategoryArchived, updateCategory } from "@/server/services/taxonomy";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const PATCH = adminRoute<Params>(async ({ req, actor, params }) => {
  const body = (await readJson(req, 1024 * 1024)) as { archived?: unknown };
  const result =
    typeof body.archived === "boolean" && Object.keys(body).length === 1
      ? await setCategoryArchived(actor, params.id, body.archived).then(() => ({ ok: true }))
      : await updateCategory(actor, params.id, body);
  invalidatePublicSite();
  return result;
});

export const DELETE = adminRoute<Params>(async ({ actor, params }) => {
  await deleteCategory(actor, params.id);
  invalidatePublicSite();
  return { ok: true };
});
