/**
 * Cookie names shared by proxy.ts (optimistic checks only) and the session
 * module. Kept free of server-only imports so the proxy can use it.
 */
export const SESSION_COOKIE_SECURE = "__Host-studio_session";
export const SESSION_COOKIE_PLAIN = "studio_session";
export const OAUTH_COOKIE = "studio_oauth";
