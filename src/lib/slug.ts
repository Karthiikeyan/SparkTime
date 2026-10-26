/**
 * Slug rules shared by every addressable entity (documents, content types,
 * categories, tags). One definition keeps URL validation identical on the
 * client, the API boundary and the service layer.
 */

export const MAX_SLUG_LENGTH = 96;

/** Lowercase ASCII words joined by single hyphens. No dots, slashes or encodings. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value);
}

export function slugify(input: string, fallback = "untitled"): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/**
 * Top-level paths owned by the application itself. Categories, content types
 * and root pages share the root URL namespace, so none of them may claim these.
 */
export const RESERVED_ROOT_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "preview",
  "explore",
  "library",
  "topics",
  // Everything outside the featured topics (app/(site)/notes).
  "notes",
  // Site sections (lib/content/sections.ts).
  "blog",
  "work",
  "speaking",
  "search",
  "tag",
  "tags",
  "graph",
  "og",
  "feed",
  "rss",
  "media",
  "login",
  "logout",
  "auth",
  "static",
  "assets",
  "public",
  "index",
  "home",
  "icon",
  "apple-icon",
  "opengraph-image",
  "twitter-image",
  "manifest",
  "sitemap",
  "robots",
  "favicon",
  "well-known",
  "404",
  "500",
]);

/**
 * System pages have bespoke routes (e.g. /about renders the journey) but their
 * editable body comes from a Page document with the same slug. Only documents
 * of a root-routed type may use these slugs.
 */
export const SYSTEM_PAGE_SLUGS: ReadonlySet<string> = new Set(["about", "now", "uses", "start-here", "sparktribe", "contact"]);

export function isReservedRootSlug(slug: string): boolean {
  return RESERVED_ROOT_SLUGS.has(slug) || SYSTEM_PAGE_SLUGS.has(slug);
}
