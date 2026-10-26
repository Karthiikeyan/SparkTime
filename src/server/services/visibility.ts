import "server-only";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { DocumentStatus, RobotsIndex, Visibility } from "@/lib/content/model";
import { documents } from "../db/schema";

/**
 * THE visibility rules. Every public read path composes these predicates;
 * nothing else decides whether a document may be shown.
 *
 *   accessible  — may be served at its URL:
 *                 status ∈ {published, archived} AND visibility ∈ {public, unlisted}
 *   listed      — may appear in discovery (lists, search, related, sitemap,
 *                 RSS, graph, backlinks): status = published AND visibility = public
 *   indexable   — listed (or explicitly opted-in unlisted), type indexable,
 *                 not robots=noindex
 *
 * Private documents and every non-published status (idea, draft, scheduled)
 * are never accessible outside the authenticated admin.
 */

type VisibilityFacts = { status: string; visibility: string; robotsIndex?: string };

export function isAccessible(doc: VisibilityFacts): boolean {
  return (doc.status === "published" || doc.status === "archived") && (doc.visibility === "public" || doc.visibility === "unlisted");
}

export function isListed(doc: VisibilityFacts): boolean {
  return doc.status === "published" && doc.visibility === "public";
}

export function isIndexable(doc: VisibilityFacts, typeIndexable: boolean): boolean {
  if (doc.status !== "published") return false;
  if (doc.robotsIndex === "noindex") return false;
  if (doc.visibility === "public") return typeIndexable || doc.robotsIndex === "index";
  if (doc.visibility === "unlisted") return doc.robotsIndex === "index";
  return false;
}

/** Discovery predicate as SQL (listed). */
export function listedSql(): SQL {
  return and(eq(documents.status, "published"), eq(documents.visibility, "public"))!;
}

/** Direct-URL predicate as SQL (accessible). */
export function accessibleSql(): SQL {
  return and(inArray(documents.status, ["published", "archived"]), inArray(documents.visibility, ["public", "unlisted"]))!;
}

/** Sitemap predicate (indexable, before the per-type flag which callers join). */
export function sitemapCandidateSql(): SQL {
  return and(
    eq(documents.status, "published"),
    or(eq(documents.visibility, "public"), and(eq(documents.visibility, "unlisted"), eq(documents.robotsIndex, "index"))),
  )!;
}

export type { DocumentStatus, RobotsIndex, Visibility };
