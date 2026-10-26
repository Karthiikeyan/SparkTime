/**
 * Public paths that were retired and permanently redirect elsewhere. One list
 * feeds both next.config.ts (the 308 redirects) and the menu resolver, so a menu
 * saved before a path was retired links straight to its replacement instead of
 * sending every page view through a redirect.
 */
export const RETIRED_PATHS: ReadonlyArray<{ from: string; to: string }> = [
  { from: "/explore", to: "/library" },
  { from: "/graph", to: "/topics" },
  // One Library: the Writing stream and the article index are the Library, and Speaking is part of About.
  { from: "/blog", to: "/library" },
  { from: "/article", to: "/library" },
  { from: "/speaking", to: "/about#speaking" },
];

/** Retired listings whose numbered pages (/{from}/page/{n}) continue at {to}/page/{n}. */
export const RETIRED_PAGED_PATHS: ReadonlyArray<{ from: string; to: string }> = [
  { from: "/blog", to: "/library" },
  { from: "/article", to: "/library" },
];

/** "/explore" → "/library"; "/explore?x#y" keeps its query and fragment. Anything else is returned unchanged. */
export function replacementFor(href: string): string {
  const cut = href.search(/[?#]/);
  const path = (cut === -1 ? href : href.slice(0, cut)).replace(/\/+$/, "") || "/";
  const hit = RETIRED_PATHS.find((r) => r.from === path);
  return hit ? hit.to + (cut === -1 ? "" : href.slice(cut)) : href;
}
