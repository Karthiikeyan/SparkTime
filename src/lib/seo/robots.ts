/**
 * Robots decision for a document page. Pure so every combination can be
 * tested. Mirrors src/server/services/visibility.ts#isIndexable, plus
 * archived → noindex and "canonical points elsewhere" → noindex.
 */
export type RobotsInput = {
  status: string;
  visibility: string;
  robotsIndex: string;
  typeIndexable: boolean;
  canonicalElsewhere?: boolean;
};

export function documentRobots(d: RobotsInput): { index: boolean; follow: boolean } {
  if (d.status !== "published") return { index: false, follow: true };
  if (d.robotsIndex === "noindex" || d.canonicalElsewhere) return { index: false, follow: true };
  if (d.visibility === "public") return { index: d.typeIndexable || d.robotsIndex === "index", follow: true };
  if (d.visibility === "unlisted") return { index: d.robotsIndex === "index", follow: true };
  return { index: false, follow: false };
}

/** Taxonomy pages: 'auto' indexes only when there is enough content to be useful. */
export function taxonomyRobots(mode: string, listedCount: number, threshold: number): { index: boolean; follow: boolean } {
  if (mode === "noindex") return { index: false, follow: true };
  if (mode === "index") return { index: listedCount > 0, follow: true };
  return { index: listedCount >= threshold, follow: true };
}
