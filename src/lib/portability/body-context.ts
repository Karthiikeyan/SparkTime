import type { Issue } from "./model";

/**
 * What the body converters need from their caller: how to turn link and
 * media destinations into stored values (placeholders resolved later by the
 * planner), and where to report what was transformed or dropped.
 */
export type BodyContext = {
  path: string;
  /** Link destination → href to store (placeholder or safe URL), or null to keep the text only. */
  link(href: string): string | null;
  /** Image/attachment destination → placeholder src, or null to drop it (already reported). */
  media(src: string): string | null;
  /** Obsidian `[[target|label]]` → href, or null. */
  wikiLink?(target: string): string | null;
  /** Obsidian `![[target]]` → an image placeholder, or a link for note transclusions. */
  wikiEmbed?(target: string): { kind: "image"; src: string | null } | { kind: "link"; href: string | null };
  issue(issue: Issue): void;
  stats: BodyStats;
};

export type BodyStats = {
  headingsLowered: number;
  imagesLifted: number;
  strippedTags: Set<string>;
  unsupported: Set<string>;
};

export function newStats(): BodyStats {
  return { headingsLowered: 0, imagesLifted: 0, strippedTags: new Set(), unsupported: new Set() };
}
