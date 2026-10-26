import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { isSafeInternalPath, normalizePath } from "@/lib/url";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb, type Db } from "../db/client";
import { redirects, type RedirectRow } from "../db/schema";
import { invalid, notFound } from "../errors";
import { recordAudit } from "./audit";

/**
 * Redirect rules. Invariants (enforced on every write):
 *  - both paths are same-site paths — no open redirects to other origins;
 *  - no self-redirects and no chains: when A→B is added, anything that
 *    pointed at A is repointed to B, and any rule *from* B is removed
 *    (B now exists as real content);
 *  - prefix rules only rewrite the leading segment(s).
 */

export type RedirectInput = {
  fromPath: string;
  toPath: string;
  matchType?: "exact" | "prefix";
  statusCode?: 301 | 302 | 307 | 308;
  source?: "slug-change" | "type-change" | "manual" | "import";
};

function validatePaths(input: RedirectInput): { from: string; to: string } {
  if (!isSafeInternalPath(input.fromPath) || !isSafeInternalPath(input.toPath)) {
    throw invalid("Redirects must use site paths that start with a single “/”.");
  }
  const from = normalizePath(input.fromPath);
  const to = normalizePath(input.toPath);
  if (from === "/" ) throw invalid("The home page cannot be redirected.");
  if (from === to) throw invalid("A redirect cannot point to itself.");
  if (/^\/(admin|api|_next)(\/|$)/.test(from) || /^\/(admin|api|_next)(\/|$)/.test(to)) throw invalid("System paths cannot be redirected.");
  return { from, to };
}

/** Insert or replace a rule, keeping the redirect graph flat and loop-free. */
export async function upsertRedirect(db: Db, input: RedirectInput): Promise<void> {
  const { from, to } = validatePaths(input);
  const matchType = input.matchType ?? "exact";

  // The destination is live content now; it must not itself redirect.
  await db.delete(redirects).where(eq(redirects.fromPath, to));
  // Flatten chains: X→from becomes X→to.
  await db.update(redirects).set({ toPath: to }).where(and(eq(redirects.toPath, from), eq(redirects.matchType, matchType)));
  // A rule pointing back at itself after flattening is a loop — drop it.
  await db.delete(redirects).where(sql`${redirects.fromPath} = ${redirects.toPath}`);

  await db
    .insert(redirects)
    .values({ fromPath: from, toPath: to, matchType, statusCode: input.statusCode ?? 308, source: input.source ?? "manual" })
    .onConflictDoUpdate({ target: redirects.fromPath, set: { toPath: to, matchType, statusCode: input.statusCode ?? 308, source: input.source ?? "manual" } });
}

/** When content is (re)created at a path, any redirect *from* that path is obsolete. */
export async function clearRedirectFrom(db: Db, path: string): Promise<void> {
  await db.delete(redirects).where(eq(redirects.fromPath, normalizePath(path)));
}

export type ResolvedRedirect = { location: string; permanent: boolean };

/**
 * Resolve a request path. Exact rules win over prefix rules; the longest
 * prefix wins. The resulting location is re-validated as internal.
 */
export async function resolveRedirect(path: string): Promise<ResolvedRedirect | null> {
  if (!isSafeInternalPath(path)) return null;
  const normalized = normalizePath(path);
  const db = getDb();
  const [exact] = await db.select().from(redirects).where(and(eq(redirects.fromPath, normalized), eq(redirects.matchType, "exact"))).limit(1);
  let rule: RedirectRow | undefined = exact;
  let location: string | null = exact ? exact.toPath : null;

  if (!rule) {
    const prefixes = normalized
      .split("/")
      .filter(Boolean)
      .map((_, i, parts) => "/" + parts.slice(0, i + 1).join("/"));
    if (prefixes.length) {
      const candidates = await db
        .select()
        .from(redirects)
        .where(and(eq(redirects.matchType, "prefix"), inArray(redirects.fromPath, prefixes)));
      candidates.sort((a, b) => b.fromPath.length - a.fromPath.length);
      rule = candidates[0];
      if (rule) location = rule.toPath + normalized.slice(rule.fromPath.length);
    }
  }

  if (!rule || !location || !isSafeInternalPath(location) || normalizePath(location) === normalized) return null;
  // Fire-and-forget hit counter; never block the redirect on it.
  void db
    .update(redirects)
    .set({ hits: sql`${redirects.hits} + 1`, lastHitAt: new Date() })
    .where(eq(redirects.id, rule.id))
    .catch(() => undefined);
  return { location, permanent: rule.statusCode === 301 || rule.statusCode === 308 };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function listRedirects(actor: Actor): Promise<RedirectRow[]> {
  assertAdmin(actor);
  return getDb().select().from(redirects).orderBy(desc(redirects.createdAt)).limit(1000);
}

export async function createRedirect(actor: Actor, input: RedirectInput): Promise<void> {
  assertAdmin(actor);
  const db = getDb();
  await db.transaction((tx) => upsertRedirect(tx, { ...input, source: "manual" }));
  await recordAudit(actor, "redirect.create", "redirect", null, `${input.fromPath} → ${input.toPath}`);
}

export async function deleteRedirect(actor: Actor, id: string): Promise<void> {
  assertAdmin(actor);
  const deleted = await getDb().delete(redirects).where(eq(redirects.id, id)).returning({ id: redirects.id });
  if (!deleted.length) throw notFound("Redirect");
  await recordAudit(actor, "redirect.delete", "redirect", id);
}
