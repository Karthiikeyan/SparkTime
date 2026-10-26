import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_PLAIN, SESSION_COOKIE_SECURE } from "@/lib/auth-cookies";
import { THEME_SCRIPT } from "@/lib/theme-script";

/**
 * Layer 1 of 3 for admin protection — an OPTIMISTIC check only. Requests
 * without a session cookie are turned away early; the authoritative checks
 * (database session + owner allowlist) run in the admin layout/pages and in
 * every /api/admin handler. Never rely on this file alone.
 *
 * Admin pages also get a strict, nonce-based CSP ('strict-dynamic'), since
 * they are rendered per request anyway. The one static inline script (theme)
 * is allowed by hash.
 */

const THEME_HASH = `'sha256-${createHash("sha256").update(THEME_SCRIPT).digest("base64")}'`;

function adminCsp(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  const media = process.env.R2_PUBLIC_URL ? (() => { try { return new URL(process.env.R2_PUBLIC_URL!).origin; } catch { return ""; } })() : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${THEME_HASH} 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // ProseMirror and React set inline style attributes; styles cannot execute script.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://i.ytimg.com${media ? ` ${media}` : ""}`,
    `media-src 'self' blob:${media ? ` ${media}` : ""}`,
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE_SECURE) || request.cookies.has(SESSION_COOKIE_PLAIN);

  if (pathname.startsWith("/api/admin")) {
    if (!hasSession) return NextResponse.json({ error: "Please sign in.", code: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.next();
  }

  const isLogin = pathname === "/admin/login";
  if ((pathname.startsWith("/admin") || pathname.startsWith("/preview")) && !isLogin && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/admin")) {
    const nonce = randomBytes(16).toString("base64");
    const csp = adminCsp(nonce);
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/preview/:path*"],
};
