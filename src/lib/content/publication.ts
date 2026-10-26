/**
 * The publishing vocabulary every Studio screen shares: the editor, both
 * importers and bulk operations describe a document's result with these
 * words, computed here from the stored facts (status, visibility, robots,
 * the type's indexable flag). Pure; mirrors services/visibility.ts and
 * lib/seo/robots.ts, which remain the rules public reads enforce.
 *
 * docs/content-publishing-redesign.md §1–2.
 */
import { documentRobots } from "../seo/robots";
import type { DocumentStatus, RobotsIndex, Visibility } from "./model";

/** What an import can make of an item. Drafts are stored public, so publishing one later makes it live. */
export const PUBLICATIONS = ["draft", "published", "unlisted"] as const;
export type Publication = (typeof PUBLICATIONS)[number];

export const PUBLICATION_INFO: Record<Publication, { label: string; help: string }> = {
  draft: { label: "Draft", help: "Saved in the Studio. Nothing appears on the site until you publish." },
  published: { label: "Published", help: "Live, and listed across the site: lists, search, feeds and the sitemap." },
  unlisted: { label: "Unlisted", help: "Live at its address for anyone with the link, but kept out of lists, search and feeds." },
};

export function isPublication(value: unknown): value is Publication {
  return typeof value === "string" && (PUBLICATIONS as readonly string[]).includes(value);
}

/** The stored status and visibility a publication choice produces. */
export function publicationFields(p: Publication): { status: "draft" | "published"; visibility: Visibility } {
  return p === "draft" ? { status: "draft", visibility: "public" } : { status: "published", visibility: p === "unlisted" ? "unlisted" : "public" };
}

/** What an import does about search engines. Automatic never lets a file opt a page into the index. */
export const INDEXINGS = ["auto", "index", "noindex"] as const;
export type Indexing = (typeof INDEXINGS)[number];

export const INDEXING_INFO: Record<Indexing, { label: string; help: string }> = {
  auto: { label: "Automatic", help: "The format's default. A file can keep a page out of search engines, never put one in." },
  index: { label: "Index", help: "Search engines may index it once it's live, even where the format's default says no." },
  noindex: { label: "Noindex", help: "Kept out of search engines, even when live." },
};

export function isIndexing(value: unknown): value is Indexing {
  return typeof value === "string" && (INDEXINGS as readonly string[]).includes(value);
}

export type OutcomeFacts = { status: string; visibility: string; robotsIndex: string; typeIndexable: boolean };

export type Outcome = {
  /** Draft, Published, Unlisted, Private, Archived (or Trashed). */
  label: string;
  /** Served at its URL. */
  live: boolean;
  /** In lists, search, feeds and the sitemap. */
  listed: boolean;
  /** Search engines may index it. */
  indexed: boolean;
  /** One plain sentence: what a reader and a search engine get. */
  summary: string;
  /** For something not live yet: would search engines index it once published as it stands? */
  indexedWhenLive: boolean;
};

/** The result of the stored facts, in the words the Studio uses everywhere. */
export function publicationOutcome(d: OutcomeFacts): Outcome {
  const whenLive = documentRobots({ status: "published", visibility: d.visibility, robotsIndex: d.robotsIndex, typeIndexable: d.typeIndexable }).index;
  return { ...baseOutcome(d), indexedWhenLive: whenLive };
}

function baseOutcome(d: OutcomeFacts): Omit<Outcome, "indexedWhenLive"> {
  const robots = documentRobots({ status: d.status, visibility: d.visibility, robotsIndex: d.robotsIndex, typeIndexable: d.typeIndexable });
  const indexWord = robots.index ? "indexed by search engines" : "not indexed";
  if (d.status === "trashed") return { label: "Trashed", live: false, listed: false, indexed: false, summary: "In the Trash: not on the site." };
  if (d.status === "archived") {
    const live = d.visibility !== "private";
    return { label: "Archived", live, listed: false, indexed: false, summary: live ? "Reachable at its address with an archived notice; not listed, not indexed." : "Archived and private: not on the site." };
  }
  if (d.status !== "published") return { label: d.status === "idea" ? "Idea" : d.status === "scheduled" ? "Scheduled" : "Draft", live: false, listed: false, indexed: false, summary: "Not on the site." };
  if (d.visibility === "private") return { label: "Private", live: false, listed: false, indexed: false, summary: "Published but private: only you can see it." };
  if (d.visibility === "unlisted") return { label: "Unlisted", live: true, listed: false, indexed: robots.index, summary: `Live for anyone with the link; not listed; ${indexWord}.` };
  return { label: "Published", live: true, listed: true, indexed: robots.index, summary: `Live and listed across the site; ${indexWord}.` };
}

/** What clicking Publish would do to a document that isn't live yet (or, when published, to its staged changes). */
export function publishPreview(d: Omit<OutcomeFacts, "status">): Outcome {
  return publicationOutcome({ ...d, status: "published" });
}

/** The label of a robots setting's "default" for a document: what the type and visibility decide. */
export function defaultIndexingLabel(visibility: string, typeIndexable: boolean): string {
  return visibility === "public" && typeIndexable ? "index" : "noindex";
}

export type { DocumentStatus, RobotsIndex };
