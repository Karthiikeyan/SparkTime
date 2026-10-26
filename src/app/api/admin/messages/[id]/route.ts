import { adminRoute, readJson } from "@/server/http/route";
import { deleteMessage, updateMessage } from "@/server/services/contact";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const PATCH = adminRoute<Params>(async ({ req, actor, params }) => {
  const body = (await readJson(req)) as { read?: unknown; archived?: unknown };
  await updateMessage(actor, params.id, {
    read: typeof body.read === "boolean" ? body.read : undefined,
    archived: typeof body.archived === "boolean" ? body.archived : undefined,
  });
  return { ok: true };
});

export const DELETE = adminRoute<Params>(async ({ actor, params }) => {
  await deleteMessage(actor, params.id);
  return { ok: true };
});
