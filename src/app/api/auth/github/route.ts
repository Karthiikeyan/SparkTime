import { NextResponse } from "next/server";
import { OAUTH_COOKIE } from "@/lib/auth-cookies";
import { authorizationUrl, createOAuthState, isGitHubConfigured } from "@/server/auth/github";
import { isSecureOrigin, siteUrl } from "@/server/env";

export const dynamic = "force-dynamic";

/** Starts GitHub OAuth: state + PKCE verifier in a short-lived HttpOnly cookie. */
export async function GET() {
  if (!isGitHubConfigured()) return NextResponse.redirect(`${siteUrl()}/admin/login?error=not-configured`);
  const { state, verifier, challenge } = createOAuthState();
  const res = NextResponse.redirect(authorizationUrl(state, challenge));
  res.cookies.set(OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    secure: isSecureOrigin(),
    sameSite: "lax",
    path: "/api/auth/github",
    maxAge: 600,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
