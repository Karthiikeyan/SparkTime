import { NextResponse, type NextRequest } from "next/server";
import { invalidateSessionToken, sessionCookieName, sessionCookieOptions } from "@/server/auth/session";
import { siteUrl } from "@/server/env";
import { assertSameOrigin, errorResponse } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST only (never GET) so a cross-site link can't log the owner out. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await invalidateSessionToken(request.cookies.get(sessionCookieName())?.value);
    const res = NextResponse.redirect(`${siteUrl()}/`, 303);
    // Expire with the attributes the cookie was set with: browsers ignore a
    // __Host- cookie update that lacks Secure and Path=/.
    res.cookies.set(sessionCookieName(), "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
