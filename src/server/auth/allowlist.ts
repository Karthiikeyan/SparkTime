import "server-only";
import { env } from "../env";

/**
 * The single decision point for "is this GitHub identity the site owner?".
 *
 * GitHub usernames can be renamed — and a freed username can be claimed by
 * someone else — so the immutable numeric account id (ADMIN_GITHUB_ID) is
 * authoritative when configured. The login is a fallback for first setup.
 * With neither configured, nobody is an admin.
 */
export function isAllowedAdmin(identity: { githubId: number; login: string }): boolean {
  const { ADMIN_GITHUB_ID, ADMIN_GITHUB_LOGIN } = env();
  if (ADMIN_GITHUB_ID) {
    return /^\d+$/.test(ADMIN_GITHUB_ID) && identity.githubId === Number(ADMIN_GITHUB_ID);
  }
  if (ADMIN_GITHUB_LOGIN) {
    return identity.login.toLowerCase() === ADMIN_GITHUB_LOGIN.toLowerCase();
  }
  return false;
}

/** The development-only login bypass. Hard-disabled in production builds. */
export function isDevLoginEnabled(): boolean {
  return process.env.NODE_ENV === "development" && env().AUTH_DEV_LOGIN === "true";
}

/** Sentinel GitHub id for the local development admin (never a real account). */
export const DEV_ADMIN_GITHUB_ID = -1;
