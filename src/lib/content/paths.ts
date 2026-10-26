/** Canonical path construction — the only place URLs for content are built. */

export type PathableType = { slug: string; routing: "type" | "root" | string };

export function documentPath(type: PathableType, slug: string): string {
  return type.routing === "root" ? `/${slug}` : `/${type.slug}/${slug}`;
}

export function typeIndexPath(type: PathableType): string {
  return `/${type.slug}`;
}

export function categoryPath(slug: string): string {
  return `/${slug}`;
}

export function tagPath(slug: string): string {
  return `/tag/${slug}`;
}

/**
 * The {n} in a paginated listing URL (`…/page/{n}`): 2–9999 as plain digits.
 * Page 1 has no /page/ URL (it's the listing itself), and "02" or "1e3" never
 * alias a real page, so each page has exactly one URL.
 */
export function parsePageNumber(value: string | undefined): number | null {
  return value && /^[2-9]\d{0,3}$|^1\d{1,3}$/.test(value) ? Number(value) : null;
}

export function absoluteUrl(siteUrl: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${siteUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
