import { slugify } from "../slug";
import type { BlockNode, Doc } from "./blocks";
import { headingRanker, extractPlainText } from "./derive";

const textOf = (nodes: BlockNode[]) => extractPlainText({ type: "doc", content: nodes } as Doc).trim();

export type PageSection = { id: string; heading: string; nodes: BlockNode[] };

/** A document split at its top heading level: the text before the first heading, and each section after it. */
export function splitSections(doc: Doc): { intro: BlockNode[]; sections: PageSection[] } {
  const rank = headingRanker(doc);
  const intro: BlockNode[] = [];
  const sections: PageSection[] = [];
  for (const node of doc.content) {
    if (node.type === "heading" && rank(node.attrs?.level) === 1) {
      const heading = textOf([node]);
      sections.push({ id: slugify(heading, "section"), heading, nodes: [] });
    } else if (sections.length) sections[sections.length - 1]!.nodes.push(node);
    else intro.push(node);
  }
  return { intro, sections };
}

/** A section's text as items when it is nothing but one bulleted or numbered list; otherwise null. */
export function listOnly(nodes: BlockNode[]): { ordered: boolean; items: string[] } | null {
  const [only, ...rest] = nodes;
  if (!only || rest.length || (only.type !== "bulletList" && only.type !== "orderedList")) return null;
  const items = (only.content ?? []).map((item) => textOf([item]).replace(/\s+/g, " ")).filter(Boolean);
  return items.length ? { ordered: only.type === "orderedList", items } : null;
}

const STAT = /^(\d[\d,.]*\s?(?:[KkMm]\b)?\+?)\s+(.{2,60})$/;

/** "1,200+ registered learners" → { value: "1,200+", label: "registered learners" }; null unless every item reads that way. */
export function asStats(items: string[]): Array<{ value: string; label: string }> | null {
  if (items.length < 3) return null;
  const stats = items.map((i) => STAT.exec(i));
  return stats.every(Boolean) ? stats.map((m) => ({ value: m![1]!.trim(), label: m![2]!.trim() })) : null;
}

/** "Learn: Recorded courses in Tamil." → title and text; an item with no separator is all title. */
export function titleAndText(item: string): { title: string; text: string } {
  const m = /^(.{2,60}?)\s*(?::|—|–| - )\s+(.+)$/.exec(item);
  return m ? { title: m[1]!, text: m[2]! } : { title: item, text: "" };
}
