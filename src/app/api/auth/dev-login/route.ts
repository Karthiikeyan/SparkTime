import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { DEV_ADMIN_GITHUB_ID, isDevLoginEnabled } from "@/server/auth/allowlist";
import { createSession, sessionCookieName, sessionCookieOptions } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { siteUrl } from "@/server/env";
import { assertSameOrigin, errorResponse } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * LOCAL DEVELOPMENT ONLY: sign in without a GitHub OAuth app.
 * Enabled only when NODE_ENV=development AND AUTH_DEV_LOGIN=true. In any
 * other environment this returns 404, and sessions of the dev user are
 * rejected by the guard even if one somehow existed.
 */
export async function POST(request: NextRequest) {
  if (!isDevLoginEnabled()) return new NextResponse("Not found", { status: 404 });
  try {
    assertSameOrigin(request);
    const db = getDb();
    const [existing] = await db.select().from(users).where(eq(users.githubId, DEV_ADMIN_GITHUB_ID)).limit(1);
    const userId = existing?.id ?? (await db.insert(users).values({ githubId: DEV_ADMIN_GITHUB_ID, githubLogin: "dev-admin", name: "Local admin" }).returning({ id: users.id }))[0]!.id;
    const { token, expiresAt } = await createSession(userId, request.headers.get("user-agent"));
    const res = NextResponse.redirect(`${siteUrl()}/admin`, 303);
    res.cookies.set(sessionCookieName(), token, sessionCookieOptions(expiresAt));
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
