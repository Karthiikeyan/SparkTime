import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { AdminActor } from "./actor";
import { DEV_ADMIN_GITHUB_ID, isAllowedAdmin, isDevLoginEnabled } from "./allowlist";
import { sessionCookieName, validateSessionToken, type ValidatedSession } from "./session";

/** Session → admin actor, re-checking the allowlist on EVERY request. */
export function actorFromSession(session: ValidatedSession | null): AdminActor | null {
  if (!session) return null;
  const { user } = session;
  const allowed = user.githubId === DEV_ADMIN_GITHUB_ID ? isDevLoginEnabled() : isAllowedAdmin({ githubId: user.githubId, login: user.githubLogin });
  return allowed ? { kind: "admin", userId: user.id, login: user.githubLogin } : null;
}

/**
 * For Server Components and layouts. Memoised per request, so the studio
 * layout and page share one session lookup instead of querying twice.
 */
export const getAdminActor = cache(async (): Promise<AdminActor | null> => {
  const store = await cookies();
  const session = await validateSessionToken(store.get(sessionCookieName())?.value);
  return actorFromSession(session);
});

/** Admin pages call this at the top — independent of the proxy's optimistic check. */
export async function requireAdminPage(): Promise<AdminActor> {
  const actor = await getAdminActor();
  if (!actor) redirect("/admin/login");
  return actor;
}
