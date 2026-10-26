import type { NextRequest } from "next/server";
import { actorFromSession } from "@/server/auth/guard";
import { sessionCookieName, validateSessionToken } from "@/server/auth/session";
import { json } from "@/server/http/route";
import { listContentTypes } from "@/server/services/content-types";

export const dynamic = "force-dynamic";

/**
 * Lets the static public site learn, client-side, whether the visitor is the
 * admin (to show "create"/"edit" actions in ⌘K) without making public pages
 * dynamic. Reveals nothing to anyone else.
 */
export async function GET(request: NextRequest) {
  const actor = actorFromSession(await validateSessionToken(request.cookies.get(sessionCookieName())?.value));
  if (!actor) return json({ admin: false, quickCreate: [] });
  const types = (await listContentTypes()).filter((t) => t.showInQuickCreate && !t.archivedAt);
  return json({ admin: true, login: actor.login, quickCreate: types.map((t) => ({ id: t.id, name: t.name })) });
}
