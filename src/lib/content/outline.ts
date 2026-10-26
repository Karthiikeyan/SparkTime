/**
 * The reading outline: a long page's sections with their subsections nested
 * beneath, derived from the document's own headings — there is nothing for
 * the author to maintain. The page title owns the page's <h1>, so the editor's
 * "Heading 1" renders as <h2> (a section), "Heading 2" as <h3> (a subsection)
 * and "Heading 3" as <h4>, which the outline leaves out as noise.
 */
import type { Heading } from "./derive";

export type OutlineEntry = { id: string; text: string; children: OutlineEntry[] };

/** Reading chrome adapts to length: short pieces get just the words. */
export const OUTLINE_MIN_WORDS = 600;
export const OUTLINE_MIN_ENTRIES = 3;
export const PROGRESS_MIN_WORDS = 1200;

/** Sections (<h2>) with their subsections (<h3>); a subsection before the first section stands on its own. */
export function buildOutline(headings: Heading[]): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  let section: OutlineEntry | null = null;
  for (const heading of headings) {
    if (heading.level === 3) continue;
    const entry: OutlineEntry = { id: heading.id, text: heading.text, children: [] };
    if (heading.level === 2 && section) {
      section.children.push(entry);
    } else {
      outline.push(entry);
      if (heading.level === 1) section = entry;
    }
  }
  return outline;
}

/** The outline for a page, or null when the page is too short to need one. */
export function readingOutline(headings: Heading[], wordCount: number): OutlineEntry[] | null {
  const outline = buildOutline(headings);
  return outlineIds(outline).length >= OUTLINE_MIN_ENTRIES && wordCount >= OUTLINE_MIN_WORDS ? outline : null;
}

/** Every entry's anchor, in reading order. */
export function outlineIds(outline: OutlineEntry[]): string[] {
  return outline.flatMap((entry) => [entry.id, ...entry.children.map((child) => child.id)]);
}

/**
 * Which heading is being read, given each heading's distance from the top of
 * the viewport (in document order); -1 before the first. The current section
 * is the last heading at or above the reading line. At the very end of the
 * page, closing sections too short to ever reach the line still get their
 * turn: the last heading on screen wins.
 */
export function activeHeadingIndex(tops: readonly number[], view: { line: number; height: number; atEnd: boolean }): number {
  let active = -1;
  tops.forEach((top, i) => {
    if (top <= view.line || (view.atEnd && top < view.height)) active = i;
  });
  return active;
}
