import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { AdminActor } from "../auth/actor";
import { actorFromSession } from "../auth/guard";
import { sessionCookieName, sessionCookieOptions, validateSessionToken } from "../auth/session";
import { siteUrl } from "../env";
import { invalid, isServiceError, ServiceError } from "../errors";

/**
 * HTTP boundary helpers. Every admin API handler is wrapped by adminRoute(),
 * which enforces — independently of proxy.ts — same-origin mutations (CSRF),
 * a valid database session and the owner allowlist.
 */

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function errorResponse(error: unknown): NextResponse {
  if (isServiceError(error)) return json({ error: error.message, code: error.code, details: error.details }, error.status);
  // Unknown failures: log server-side, return nothing internal to the client.
  console.error("[api] unexpected error", error);
  return json({ error: "Something went wrong. Please try again.", code: "internal" }, 500);
}

/**
 * Cross-site request forgery guard for state-changing requests: the browser's
 * Origin (and Fetch Metadata when present) must be this site. Combined with
 * SameSite=Lax cookies and JSON-only bodies this blocks forged submissions.
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  const allowed = new Set([new URL(siteUrl()).origin, req.nextUrl.origin]);
  if (!origin || !allowed.has(origin)) throw new ServiceError("forbidden", "Cross-origin request blocked.");
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") throw new ServiceError("forbidden", "Cross-site request blocked.");
}

export async function readJson(req: NextRequest, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new ServiceError("unsupported_media", "Expected a JSON body.");
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new ServiceError("too_large", "Request body is too large.");
  const text = await req.text();
  if (text.length > maxBytes) throw new ServiceError("too_large", "Request body is too large.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw invalid("Malformed JSON.");
  }
}

type RouteContext<P> = { params: Promise<P> };
type AdminHandler<P> = (ctx: { req: NextRequest; actor: AdminActor; params: P }) => Promise<unknown>;

export function adminRoute<P = Record<string, never>>(handler: AdminHandler<P>) {
  return async (req: NextRequest, context: RouteContext<P>): Promise<NextResponse> => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      const session = await validateSessionToken(req.cookies.get(sessionCookieName())?.value);
      const actor = actorFromSession(session);
      if (!actor || !session) return json({ error: "Please sign in again.", code: "unauthorized" }, 401);
      const params = (await context.params) ?? ({} as P);
      const result = await handler({ req, actor, params });
      const res = result instanceof NextResponse ? result : json(result ?? { ok: true });
      res.headers.set("Cache-Control", "no-store");
      if (session.refreshed) res.cookies.set(sessionCookieName(), req.cookies.get(sessionCookieName())!.value, sessionCookieOptions(session.expiresAt));
      return res;
    } catch (error) {
      return errorResponse(error);
    }
  };
}

type PublicHandler<P> = (ctx: { req: NextRequest; params: P }) => Promise<unknown>;

export function publicRoute<P = Record<string, never>>(handler: PublicHandler<P>, options: { mutation?: boolean } = {}) {
  return async (req: NextRequest, context: RouteContext<P>): Promise<NextResponse> => {
    try {
      if (options.mutation) assertSameOrigin(req);
      const params = (await context.params) ?? ({} as P);
      const result = await handler({ req, params });
      return result instanceof NextResponse ? result : json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
