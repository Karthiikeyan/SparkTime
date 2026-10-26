import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE } from "@/lib/auth-cookies";
import { isAllowedAdmin } from "@/server/auth/allowlist";
import { exchangeCodeForIdentity, statesMatch } from "@/server/auth/github";
import { createSession, sessionCookieName, sessionCookieOptions } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { siteUrl } from "@/server/env";
import { consumeRateLimit, clientIp, hashIdentifier } from "@/server/services/rate-limit";

export const dynamic = "force-dynamic";

function fail(reason: string) {
  const res = NextResponse.redirect(`${siteUrl()}/admin/login?error=${encodeURIComponent(reason)}`);
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/github" });
  return res;
}

/**
 * OAuth callback. Order matters:
 *  1. rate limit, 2. state check (CSRF on login), 3. code → identity with PKCE,
 *  4. allowlist check BEFORE any user row or session is created.
 * Non-allowlisted GitHub accounts never get a session or a database record.
 */
export async function GET(request: NextRequest) {
  const limit = await consumeRateLimit(`login:${hashIdentifier(clientIp(request.headers))}`, 20, 900);
  if (!limit.allowed) return fail("rate-limited");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const [expectedState, verifier] = (request.cookies.get(OAUTH_COOKIE)?.value ?? "").split(".");
  if (!code || !verifier || !statesMatch(expectedState, state)) return fail("state");

  let identity;
  try {
    identity = await exchangeCodeForIdentity(code, verifier);
  } catch {
    return fail("github");
  }
  if (!isAllowedAdmin({ githubId: identity.githubId, login: identity.login })) return fail("not-allowed");

  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.githubId, identity.githubId)).limit(1);
  const userId = existing
    ? (await db.update(users).set({ githubLogin: identity.login, name: identity.name, avatarUrl: identity.avatarUrl, lastLoginAt: new Date() }).where(eq(users.id, existing.id)).returning({ id: users.id }))[0]!.id
    : (await db.insert(users).values({ githubId: identity.githubId, githubLogin: identity.login, name: identity.name, avatarUrl: identity.avatarUrl, lastLoginAt: new Date() }).returning({ id: users.id }))[0]!.id;

  const { token, expiresAt } = await createSession(userId, request.headers.get("user-agent"));
  const res = NextResponse.redirect(`${siteUrl()}/admin`);
  res.cookies.set(sessionCookieName(), token, sessionCookieOptions(expiresAt));
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/github" });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
