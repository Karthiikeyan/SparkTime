/**
 * Semantic facts derived from a block document. Computed on write and stored
 * (plain text, word count, reading time) or computed at render time (TOC).
 */
import { slugify } from "../slug";
import { isUuid, walkDoc, type BlockNode, type Doc } from "./blocks";

const BLOCK_SEPARATOR = "\n\n";

function inlineText(node: BlockNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "docRef") return String(node.attrs?.label ?? "");
  return (node.content ?? []).map(inlineText).join("");
}

function blockText(node: BlockNode): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "detailsSummary":
    case "codeBlock":
      return inlineText(node);
    case "image":
    case "audio":
      return [node.attrs?.alt, node.attrs?.title, node.attrs?.caption].filter(Boolean).join(" ");
    case "gallery":
      return ((node.attrs?.images as Array<{ alt?: string; caption?: string }>) ?? [])
        .map((img) => [img.alt, img.caption].filter(Boolean).join(" "))
        .join(" ");
    case "youtube":
    case "embed":
      return [node.attrs?.title, node.attrs?.caption].filter(Boolean).join(" ");
    case "bookmark":
      return [node.attrs?.title, node.attrs?.description].filter(Boolean).join(" ");
    case "file":
      return String(node.attrs?.name ?? "");
    case "button":
      return String(node.attrs?.label ?? "");
    default:
      return (node.content ?? []).map(blockText).filter(Boolean).join(BLOCK_SEPARATOR);
  }
}

export function extractPlainText(doc: Doc): string {
  return doc.content
    .map(blockText)
    .filter(Boolean)
    .join(BLOCK_SEPARATOR)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasPlaceholderText(text: string): boolean {
  return /^\s*\[(?:TODO\b[^\]]*|ADD (?:SCREENSHOT|VIDEO|IMAGE)[^\]]*|INSERT CONTENT[^\]]*)\]/im.test(text);
}

export function hasPlaceholderContent(doc: Doc): boolean {
  const visit = (nodes: BlockNode[]): boolean => nodes.some((node) => {
    if (node.type === "codeBlock" || node.type === "blockquote") return false;
    if (["paragraph", "heading", "detailsSummary"].includes(node.type)) return hasPlaceholderText(inlineText(node));
    return visit(node.content ?? []);
  });
  return visit(doc.content);
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

/** ~230 wpm for prose, plus a little time for each image. */
export function estimateReadingMinutes(words: number, images = 0): number {
  if (words === 0 && images === 0) return 0;
  return Math.max(1, Math.round(words / 230 + images * (12 / 60)));
}

/** Heading rank within the piece: 1 renders as <h2> (the page title is the <h1>), 2 as <h3>, 3 as <h4>. */
export type Heading = { id: string; text: string; level: 1 | 2 | 3 };

/**
 * The editor offers Heading 1–3, and authors don't always start at 1 — a
 * body written with Heading 2 and 3 would otherwise jump from the page's
 * <h1> straight to <h3>, breaking the outline screen readers navigate by.
 * Levels are ranked by what the document actually uses: the top level in
 * use is a section (<h2>), the next a subsection. A document that already
 * starts at Heading 1 and uses every level is unchanged.
 */
export function headingRanker(doc: Doc): (level: unknown) => 1 | 2 | 3 {
  const used = new Set<number>();
  walkDoc(doc, (node) => {
    if (node.type === "heading") used.add(clampLevel(node.attrs?.level));
  });
  const order = [...used].sort((a, b) => a - b);
  return (level) => (Math.min(3, order.indexOf(clampLevel(level)) + 1) || 1) as 1 | 2 | 3;
}

function clampLevel(level: unknown): number {
  const n = Number(level ?? 2);
  return n === 1 || n === 3 ? n : 2;
}

/** Ids the page chrome already uses; a heading that slugifies to one takes the next free anchor. */
const PAGE_IDS = ["main", "sources-heading", "connections-heading", "continue-heading"];

/**
 * Headings that form the table of contents, with stable unique anchor ids.
 * The renderer uses the same function so ids always match.
 */
export function extractHeadings(doc: Doc): Heading[] {
  const seen = new Map<string, number>();
  const taken = new Set(PAGE_IDS);
  const out: Heading[] = [];
  const rank = headingRanker(doc);
  const visit = (nodes: BlockNode[] | undefined, depth: number) => {
    for (const node of nodes ?? []) {
      if (node.type === "heading") {
        const text = inlineText(node).trim();
        if (!text) continue;
        const base = slugify(text, "section");
        // "Summary", "Summary" → summary, summary-2 — and never an id already on the page.
        let n = seen.get(base) ?? 0;
        let id = n ? `${base}-${n + 1}` : base;
        while (taken.has(id)) id = `${base}-${++n + 1}`;
        seen.set(base, n + 1);
        taken.add(id);
        out.push({ id, text, level: rank(node.attrs?.level) });
      } else if (depth < 2 && (node.type === "columns" || node.type === "column")) {
        visit(node.content, depth + 1);
      }
    }
  };
  visit(doc.content, 0);
  return out;
}

export type SnapshotItem = { label: string; text: string };

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

/**
 * A glimpse of a sectioned page such as /now: each top-level heading with the
 * first thing written under it — a paragraph, or a list's first three items.
 * Headings with nothing written under them yet are skipped, and so are
 * callouts, where the studio's `[TODO]` prompts live.
 */
export function extractSnapshot(doc: Doc, limit = 3): SnapshotItem[] {
  const out: SnapshotItem[] = [];
  let label: string | null = null;
  for (const node of doc.content) {
    if (out.length >= limit) break;
    if (node.type === "heading") {
      label = inlineText(node).trim() || null;
      continue;
    }
    if (!label) continue;
    const raw =
      node.type === "paragraph"
        ? inlineText(node)
        : LISTS.has(node.type)
          ? (node.content ?? [])
              .slice(0, 3)
              .map((item) => blockText(item).split(BLOCK_SEPARATOR)[0]?.trim() ?? "")
              .filter(Boolean)
              .join(", ")
          : "";
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text || text.startsWith("[TODO]")) continue;
    out.push({ label, text });
    label = null;
  }
  return out;
}

export type DocReferences = {
  documentIds: string[];
  internalPaths: string[];
  mediaIds: string[];
};

/** Everything the body points at: mentioned documents, internal links, media. */
export function extractReferences(doc: Doc, siteOrigin?: string): DocReferences {
  const documentIds = new Set<string>();
  const internalPaths = new Set<string>();
  const mediaIds = new Set<string>();

  walkDoc(doc, (node) => {
    const attrs = node.attrs ?? {};
    switch (node.type) {
      case "docRef":
        if (isUuid(attrs.documentId)) documentIds.add(attrs.documentId);
        break;
      case "relatedContent":
        for (const id of (attrs.documentIds as unknown[]) ?? []) if (isUuid(id)) documentIds.add(id);
        break;
      case "image":
      case "audio":
      case "file":
        if (isUuid(attrs.mediaId)) mediaIds.add(attrs.mediaId);
        break;
      case "gallery":
        for (const img of (attrs.images as Array<{ mediaId?: unknown }>) ?? []) if (isUuid(img.mediaId)) mediaIds.add(img.mediaId);
        break;
      case "text":
        for (const mark of node.marks ?? []) {
          const href = mark.type === "link" ? mark.attrs?.href : undefined;
          if (!href) continue;
          if (href.startsWith("/") && !href.startsWith("//")) internalPaths.add(href.split(/[?#]/)[0]!);
          else if (siteOrigin && href.startsWith(siteOrigin + "/")) internalPaths.add(href.slice(siteOrigin.length).split(/[?#]/)[0]!);
        }
        break;
    }
  });

  return { documentIds: [...documentIds], internalPaths: [...internalPaths], mediaIds: [...mediaIds] };
}

export function countImages(doc: Doc): number {
  let images = 0;
  walkDoc(doc, (node) => {
    if (node.type === "image") images += 1;
    if (node.type === "gallery") images += ((node.attrs?.images as unknown[]) ?? []).length;
  });
  return images;
}

export type DerivedContent = {
  plainText: string;
  wordCount: number;
  readingMinutes: number;
};

export function deriveContent(doc: Doc): DerivedContent {
  const plainText = extractPlainText(doc);
  const wordCount = countWords(plainText);
  return { plainText, wordCount, readingMinutes: estimateReadingMinutes(wordCount, countImages(doc)) };
}

/** Short automatic excerpt when the author has not written one. */
export function autoExcerpt(plainText: string, max = 180): string {
  const firstPara = plainText.split(/\n{2,}/).find((p) => p.trim().length > 40) ?? plainText;
  const clean = firstPara.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trim()}…`;
}
