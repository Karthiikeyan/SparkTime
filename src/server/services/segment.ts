import "server-only";
import { cache } from "react";
import { isValidSlug } from "@/lib/slug";
import { listContentTypes, type ContentType } from "./content-types";
import { getCategoryBySlug, type Category } from "./taxonomy";
import { getRootPage, type PublicDocument } from "./public-content";

export type SegmentTarget =
  | { kind: "category"; category: Category }
  | { kind: "type"; type: ContentType }
  | { kind: "page"; doc: PublicDocument }
  | { kind: "none" };

/**
 * Resolve a top-level path segment. Categories, content types and root pages
 * share one namespace (enforced on write), so at most one of them matches.
 */
export const resolveSegment = cache(async (segment: string): Promise<SegmentTarget> => {
  if (!isValidSlug(segment)) return { kind: "none" };
  const category = await getCategoryBySlug(segment);
  if (category && !category.archivedAt) return { kind: "category", category };
  const type = (await listContentTypes()).find((t) => t.slug === segment && t.routing === "type" && !t.archivedAt);
  if (type) return { kind: "type", type };
  const doc = await getRootPage(segment);
  if (doc) return { kind: "page", doc };
  return { kind: "none" };
});
