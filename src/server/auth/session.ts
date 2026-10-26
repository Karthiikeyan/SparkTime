import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { SESSION_COOKIE_PLAIN, SESSION_COOKIE_SECURE } from "@/lib/auth-cookies";
import { getDb } from "../db/client";
import { sessions, users, type UserRow } from "../db/schema";
import { isSecureOrigin } from "../env";

/**
 * Database sessions (revocable, unlike stateless JWTs).
 *  - The cookie holds 32 random bytes; the DB stores only their SHA-256, so a
 *    database leak does not yield usable session tokens.
 *  - 30-day lifetime, extended when less than half remains (sliding).
 *  - Cookie: HttpOnly, SameSite=Lax, Secure + __Host- prefix on https.
 */

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionCookieName(): string {
  return isSecureOrigin() ? SESSION_COOKIE_SECURE : SESSION_COOKIE_PLAIN;
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: isSecureOrigin(),
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: string, userAgent: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb()
    .insert(sessions)
    .values({ id: hashToken(token), userId, expiresAt, userAgent: userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

export type ValidatedSession = { user: UserRow; sessionId: string; expiresAt: Date; refreshed: boolean };

export async function validateSessionToken(token: string | undefined | null): Promise<ValidatedSession | null> {
  if (!token || token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const id = hashToken(token);
  const db = getDb();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;
  const now = Date.now();
  if (row.session.expiresAt.getTime() <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  let expiresAt = row.session.expiresAt;
  let refreshed = false;
  if (expiresAt.getTime() - now < SESSION_TTL_MS / 2) {
    expiresAt = new Date(now + SESSION_TTL_MS);
    refreshed = true;
    await db.update(sessions).set({ expiresAt, lastSeenAt: new Date() }).where(eq(sessions.id, id));
  }
  return { user: row.user, sessionId: id, expiresAt, refreshed };
}

export async function invalidateSessionToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function invalidateAllSessions(userId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}

export async function pruneExpiredSessions(): Promise<void> {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
