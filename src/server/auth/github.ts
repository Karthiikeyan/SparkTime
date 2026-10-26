import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env, siteUrl } from "../env";

/**
 * Minimal GitHub OAuth (web application flow) with `state` and PKCE (S256).
 * We only need the account's id and login to check the allowlist, so no
 * scopes are requested beyond the default public profile.
 */

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

export function isGitHubConfigured(): boolean {
  const e = env();
  return Boolean(e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET);
}

export function callbackUrl(): string {
  return `${siteUrl()}/api/auth/github/callback`;
}

export function createOAuthState(): { state: string; verifier: string; challenge: string } {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

export function authorizationUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: env().GITHUB_CLIENT_ID ?? "",
    redirect_uri: callbackUrl(),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    allow_signup: "false",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export function statesMatch(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type GitHubIdentity = { githubId: number; login: string; name: string | null; avatarUrl: string | null };

export async function exchangeCodeForIdentity(code: string, verifier: string): Promise<GitHubIdentity> {
  const e = env();
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: e.GITHUB_CLIENT_ID,
      client_secret: e.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(),
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error("GitHub token exchange failed.");
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) throw new Error("GitHub did not return an access token.");

  const userRes = await fetch(USER_URL, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "karthikeyan-a-studio" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userRes.ok) throw new Error("Could not read the GitHub profile.");
  const user = (await userRes.json()) as { id?: unknown; login?: unknown; name?: unknown; avatar_url?: unknown };
  if (typeof user.id !== "number" || typeof user.login !== "string") throw new Error("Unexpected GitHub profile response.");
  return {
    githubId: user.id,
    login: user.login,
    name: typeof user.name === "string" ? user.name.slice(0, 120) : null,
    avatarUrl: typeof user.avatar_url === "string" && user.avatar_url.startsWith("https://") ? user.avatar_url : null,
  };
}
