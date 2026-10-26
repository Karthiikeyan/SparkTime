/**
 * Block document model (ProseMirror/Tiptap JSON) and its sanitizer.
 *
 * The editor emits JSON; the server NEVER stores it verbatim. Every write runs
 * through sanitizeDoc(), which rebuilds the document from an allowlist:
 *  - unknown node/mark types are removed (their text content is preserved),
 *  - every attribute is re-parsed from scratch (unknown attributes vanish),
 *  - every URL is re-validated (no javascript:, data:, credentials…),
 *  - structure is normalised (list items only inside lists, etc.),
 *  - size/depth limits bound the cost of rendering and indexing.
 * The renderer then maps each node to a fixed React component, so stored
 * content can never inject markup or script.
 */
import { buildEmbedSrc, parseYouTubeId, type EmbedProvider, YOUTUBE_ID_PATTERN } from "../embeds";
import { safeExternalUrl, safeHref } from "../url";

export type MarkType = "bold" | "italic" | "underline" | "strike" | "code" | "link";
export type Mark = { type: MarkType; attrs?: { href: string } };

export type BlockNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: BlockNode[];
  text?: string;
  marks?: Mark[];
};

export type Doc = { type: "doc"; content: BlockNode[] };

export const EMPTY_DOC: Doc = { type: "doc", content: [] };

export const LIMITS = {
  maxDepth: 14,
  maxNodes: 25_000,
  maxTextPerNode: 40_000,
  maxTotalText: 1_000_000,
  maxGalleryImages: 24,
  maxRelatedDocs: 12,
  maxTableCells: 800,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// ---------------------------------------------------------------------------
// Attribute parsers
// ---------------------------------------------------------------------------

type Attrs = Record<string, unknown>;

/** C0 control characters except tab, newline and carriage return, plus DEL. */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").slice(0, max);
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function optionalInt(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = int(value, min, max, Number.NaN);
  return Number.isNaN(n) ? null : n;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Media sources: our own /media/ paths or an https URL (R2 public domain). */
export function safeMediaSrc(value: unknown): string | null {
  const href = safeHref(value, { allowHash: false, allowMailto: false });
  if (!href) return null;
  if (href.startsWith("/")) return href.startsWith("/media/") ? href : null;
  return href.startsWith("https://") ? href : null;
}

const CALLOUT_VARIANTS = ["note", "tip", "warning", "important"] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];
const MEDIA_SIZES = ["content", "wide", "full"] as const;
const COLUMN_LAYOUTS = ["equal", "wide-left", "wide-right"] as const;
const BUTTON_VARIANTS = ["primary", "secondary"] as const;
const EMBED_PROVIDERS: readonly EmbedProvider[] = ["vimeo", "codepen", "spotify", "loom"];
export const TOOL_KINDS = ["fire-number", "compound-growth", "savings-rate"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];
const CODE_LANGUAGE = /^[a-z0-9+#.-]{1,24}$/;

type GalleryImage = { mediaId: string | null; src: string; alt: string; caption: string; width: number | null; height: number | null };

function galleryImage(raw: unknown): GalleryImage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Attrs;
  const src = safeMediaSrc(r.src);
  if (!src) return null;
  return {
    mediaId: isUuid(r.mediaId) ? r.mediaId : null,
    src,
    alt: str(r.alt, 500),
    caption: str(r.caption, 1000),
    width: optionalInt(r.width, 1, 20000),
    height: optionalInt(r.height, 1, 20000),
  };
}

// ---------------------------------------------------------------------------
// Node specifications
// ---------------------------------------------------------------------------

type ChildRule = "blocks" | "inline" | "code" | "none" | readonly string[];

type NodeSpec = {
  kind: "block" | "inline" | "structural";
  children: ChildRule;
  /** Returns sanitized attrs, or null to drop the node entirely. */
  attrs?: (raw: Attrs) => Attrs | null;
  /** Default children when a container ends up empty. */
  fill?: () => BlockNode[];
};

const para = (): BlockNode[] => [{ type: "paragraph" }];

export const NODE_SPECS: Record<string, NodeSpec> = {
  paragraph: { kind: "block", children: "inline" },
  heading: { kind: "block", children: "inline", attrs: (a) => ({ level: int(a.level, 1, 3, 2) }) },
  blockquote: { kind: "block", children: "blocks", fill: para },
  callout: {
    kind: "block",
    children: "blocks",
    fill: para,
    attrs: (a) => ({ variant: oneOf(a.variant, CALLOUT_VARIANTS, "note") }),
  },
  bulletList: { kind: "block", children: ["listItem"] },
  orderedList: { kind: "block", children: ["listItem"], attrs: (a) => ({ start: int(a.start, 1, 100000, 1) }) },
  listItem: { kind: "structural", children: "blocks", fill: para },
  taskList: { kind: "block", children: ["taskItem"] },
  taskItem: { kind: "structural", children: "blocks", fill: para, attrs: (a) => ({ checked: a.checked === true }) },
  codeBlock: {
    kind: "block",
    children: "code",
    attrs: (a) => {
      const language = typeof a.language === "string" ? a.language.toLowerCase() : "";
      return { language: CODE_LANGUAGE.test(language) ? language : null };
    },
  },
  horizontalRule: { kind: "block", children: "none" },
  image: {
    kind: "block",
    children: "none",
    attrs: (a) => {
      const src = safeMediaSrc(a.src);
      if (!src) return null;
      return {
        mediaId: isUuid(a.mediaId) ? a.mediaId : null,
        src,
        alt: str(a.alt, 500),
        caption: str(a.caption, 1000),
        width: optionalInt(a.width, 1, 20000),
        height: optionalInt(a.height, 1, 20000),
        size: oneOf(a.size, MEDIA_SIZES, "content"),
      };
    },
  },
  gallery: {
    kind: "block",
    children: "none",
    attrs: (a) => {
      const images = (Array.isArray(a.images) ? a.images : [])
        .slice(0, LIMITS.maxGalleryImages)
        .map(galleryImage)
        .filter((img): img is GalleryImage => img !== null);
      if (images.length === 0) return null;
      return { images, columns: int(a.columns, 2, 4, 3), caption: str(a.caption, 1000) };
    },
  },
  youtube: {
    kind: "block",
    children: "none",
    attrs: (a) => {
      const videoId = typeof a.videoId === "string" && YOUTUBE_ID_PATTERN.test(a.videoId) ? a.videoId : parseYouTubeId(a.src);
      if (!videoId) return null;
      return { videoId, start: int(a.start, 0, 86400, 0), title: str(a.title, 300), caption: str(a.caption, 1000) };
    },
  },
  embed: {
    kind: "block",
    children: "none",
    attrs: (a) => {
      const provider = oneOf<EmbedProvider | "">(a.provider, [...EMBED_PROVIDERS, ""], "");
      const embedId = str(a.embedId, 120);
      if (!provider || !buildEmbedSrc({ provider, id: embedId })) return null;
      return { provider, embedId, title: str(a.title, 300), caption: str(a.caption, 1000) };
    },
  },
  audio: {
    kind: "block",
    children: "none",
    attrs: (a) => {
      const src = safeMediaSrc(a.src);
      if (!src) return null;
      return { src, mediaId: isUuid(a.mediaId) ? a.mediaId : null, title: str(a.title, 300), caption: str(a.caption, 1000) };
    },
  },
  file: {
    kind: "block",
    children: "none",
    attrs: (a) => {
      const src = safeMediaSrc(a.src);
      if (!src) return null;
      return {
        src,
        mediaId: isUuid(a.mediaId) ? a.mediaId : null,
        name: str(a.name, 255) || "Download",
        size: optionalInt(a.size, 0, 2_000_000_000),
        mimeType: str(a.mimeType, 100),
      };
    },
  },
  bookmark: {
    kind: "block",
    children: "none",
    attrs: (a) => {
      const url = safeExternalUrl(a.url);
      if (!url) return null;
      return { url, title: str(a.title, 300), description: str(a.description, 600), siteName: str(a.siteName, 120) };
    },
  },
  columns: { kind: "block", children: ["column"], attrs: (a) => ({ layout: oneOf(a.layout, COLUMN_LAYOUTS, "equal") }) },
  column: { kind: "structural", children: "blocks", fill: para },
  details: {
    kind: "block",
    children: ["detailsSummary", "detailsContent"],
  },
  detailsSummary: { kind: "structural", children: "inline" },
  detailsContent: { kind: "structural", children: "blocks", fill: para },
  table: { kind: "block", children: ["tableRow"] },
  tableRow: { kind: "structural", children: ["tableHeader", "tableCell"] },
  tableHeader: { kind: "structural", children: "blocks", fill: para, attrs: cellAttrs },
  tableCell: { kind: "structural", children: "blocks", fill: para, attrs: cellAttrs },
  button: {
    kind: "block",
    children: "none",
    attrs: (a) => {
      const href = safeHref(a.href);
      if (!href) return null;
      return { label: str(a.label, 80) || "Learn more", href, variant: oneOf(a.variant, BUTTON_VARIANTS, "primary") };
    },
  },
  relatedContent: {
    kind: "block",
    children: "none",
    attrs: (a) => {
      const ids = (Array.isArray(a.documentIds) ? a.documentIds : []).filter(isUuid);
      const documentIds = [...new Set(ids)].slice(0, LIMITS.maxRelatedDocs);
      return { documentIds, title: str(a.title, 120) };
    },
  },
  tool: { kind: "block", children: "none", attrs: (a) => (TOOL_KINDS.includes(a.kind as ToolKind) ? { kind: a.kind } : null) },

  // Inline
  text: { kind: "inline", children: "none" },
  hardBreak: { kind: "inline", children: "none" },
  docRef: {
    kind: "inline",
    children: "none",
    attrs: (a) => (isUuid(a.documentId) ? { documentId: a.documentId, label: str(a.label, 200) } : null),
  },
};

function cellAttrs(a: Attrs): Attrs {
  const colwidth = Array.isArray(a.colwidth)
    ? a.colwidth.slice(0, 20).map((w) => optionalInt(w, 20, 2000))
    : null;
  return { colspan: int(a.colspan, 1, 20, 1), rowspan: int(a.rowspan, 1, 50, 1), colwidth };
}

export const BLOCK_TYPES = Object.entries(NODE_SPECS)
  .filter(([, spec]) => spec.kind === "block")
  .map(([type]) => type);

const MARK_ORDER: MarkType[] = ["link", "bold", "italic", "underline", "strike", "code"];

function sanitizeMarks(raw: unknown): Mark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Map<MarkType, Mark>();
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const type = (m as { type?: unknown }).type;
    if (typeof type !== "string" || !(MARK_ORDER as string[]).includes(type) || seen.has(type as MarkType)) continue;
    if (type === "link") {
      const href = safeHref(((m as { attrs?: Attrs }).attrs ?? {}).href);
      if (href) seen.set("link", { type: "link", attrs: { href } });
      continue;
    }
    seen.set(type as MarkType, { type: type as MarkType });
  }
  const marks = MARK_ORDER.filter((t) => seen.has(t)).map((t) => seen.get(t)!);
  return marks.length ? marks : undefined;
}

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

export class ContentTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentTooLargeError";
  }
}

type Budget = { nodes: number; text: number; cells: number };

function childTypesAllowed(rule: ChildRule, type: string): boolean {
  if (rule === "none") return false;
  if (rule === "code") return type === "text";
  const spec = NODE_SPECS[type];
  if (!spec) return false;
  if (rule === "inline") return spec.kind === "inline";
  if (rule === "blocks") return spec.kind === "block";
  return rule.includes(type);
}

function sanitizeChildren(rawChildren: unknown, rule: ChildRule, parentType: string, depth: number, budget: Budget): BlockNode[] {
  if (!Array.isArray(rawChildren) || rule === "none") return [];
  const out: BlockNode[] = [];
  for (const raw of rawChildren) {
    for (const node of sanitizeNode(raw, rule, parentType, depth + 1, budget)) out.push(node);
  }
  return rule === "blocks" ? wrapStrayInline(out) : out;
}

/** Consecutive inline nodes inside a block container are wrapped into a paragraph. */
function wrapStrayInline(nodes: BlockNode[]): BlockNode[] {
  const out: BlockNode[] = [];
  let pending: BlockNode[] = [];
  const flush = () => {
    if (pending.length) out.push({ type: "paragraph", content: pending });
    pending = [];
  };
  for (const node of nodes) {
    if (NODE_SPECS[node.type]?.kind === "inline") pending.push(node);
    else {
      flush();
      out.push(node);
    }
  }
  flush();
  return out;
}

function collectText(raw: unknown, depth = 0): string {
  if (!raw || typeof raw !== "object" || depth > LIMITS.maxDepth) return "";
  const r = raw as { text?: unknown; content?: unknown };
  if (typeof r.text === "string") return r.text;
  if (!Array.isArray(r.content)) return "";
  return r.content.map((c) => collectText(c, depth + 1)).join(" ");
}

function sanitizeNode(raw: unknown, parentRule: ChildRule, parentType: string, depth: number, budget: Budget): BlockNode[] {
  if (!raw || typeof raw !== "object") return [];
  if (depth > LIMITS.maxDepth) return [];
  budget.nodes += 1;
  if (budget.nodes > LIMITS.maxNodes) throw new ContentTooLargeError("Document has too many blocks.");

  const r = raw as { type?: unknown; attrs?: unknown; content?: unknown; text?: unknown; marks?: unknown };
  const type = typeof r.type === "string" ? r.type : "";
  const spec = NODE_SPECS[type];

  // Unknown node: keep its readable text, drop the wrapper.
  if (!spec) {
    const text = collectText(raw).trim();
    if (!text) return [];
    return parentRule === "inline" || parentRule === "code"
      ? [{ type: "text", text: text.slice(0, LIMITS.maxTextPerNode) }]
      : parentRule === "blocks"
        ? [{ type: "paragraph", content: [{ type: "text", text: text.slice(0, LIMITS.maxTextPerNode) }] }]
        : [];
  }

  if (type === "text") {
    if (typeof r.text !== "string" || r.text.length === 0) return [];
    const text = str(r.text, LIMITS.maxTextPerNode);
    if (!text) return [];
    budget.text += text.length;
    if (budget.text > LIMITS.maxTotalText) throw new ContentTooLargeError("Document text is too long.");
    if (parentRule === "code") return [{ type: "text", text }];
    if (!childTypesAllowed(parentRule, "text")) {
      return parentRule === "blocks" ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [];
    }
    const marks = sanitizeMarks(r.marks);
    return [marks ? { type: "text", text, marks } : { type: "text", text }];
  }

  // Node in the wrong place: lift its children into the parent instead.
  if (!childTypesAllowed(parentRule, type)) {
    if (spec.kind === "inline" && parentRule === "blocks") {
      // handled by wrapStrayInline — allow through below
    } else if (parentRule === "inline" || parentRule === "code") {
      const text = collectText(raw).trim();
      return text ? [{ type: "text", text: text.slice(0, LIMITS.maxTextPerNode) }] : [];
    } else {
      if (Array.isArray(r.content)) {
        const liftedRule: ChildRule = typeof parentRule === "string" ? parentRule : "blocks";
        return sanitizeChildren(r.content, liftedRule, parentType, depth, budget);
      }
      return [];
    }
  }

  let attrs: Attrs | undefined;
  if (spec.attrs) {
    const parsed = spec.attrs(r.attrs && typeof r.attrs === "object" ? (r.attrs as Attrs) : {});
    if (parsed === null) return [];
    attrs = parsed;
  }

  if (type === "tableHeader" || type === "tableCell") {
    budget.cells += 1;
    if (budget.cells > LIMITS.maxTableCells) throw new ContentTooLargeError("Table is too large.");
  }

  let content = sanitizeChildren(r.content, spec.children, type, depth, budget);

  // Columns cannot nest inside a column (layout inside layout collapses on mobile).
  if (type === "column") {
    content = content.flatMap((child) => (child.type === "columns" ? (child.content ?? []).flatMap((col) => col.content ?? []) : [child]));
  }

  const node: BlockNode = { type };
  if (attrs) node.attrs = attrs;

  // Structural normalisation.
  switch (type) {
    case "bulletList":
    case "orderedList":
    case "taskList":
    case "table":
    case "tableRow":
      if (content.length === 0) return [];
      break;
    case "columns": {
      if (content.length === 0) return [];
      if (content.length === 1) return content[0]!.content ?? [];
      content = content.slice(0, 3);
      break;
    }
    case "details": {
      const summary = content.find((c) => c.type === "detailsSummary") ?? { type: "detailsSummary" };
      const body = content.find((c) => c.type === "detailsContent") ?? { type: "detailsContent", content: para() };
      content = [summary, body];
      break;
    }
    default:
      if (content.length === 0 && spec.fill) content = spec.fill();
  }

  if (spec.children !== "none" && content.length > 0) node.content = content;
  return [node];
}

/**
 * Parse untrusted editor JSON into a safe Doc. Throws ContentTooLargeError
 * when limits are exceeded; everything else is repaired rather than rejected.
 */
export function sanitizeDoc(input: unknown): Doc {
  if (!input || typeof input !== "object" || (input as { type?: unknown }).type !== "doc") {
    return { type: "doc", content: [] };
  }
  const budget: Budget = { nodes: 0, text: 0, cells: 0 };
  const content = sanitizeChildren((input as { content?: unknown }).content, "blocks", "doc", 0, budget);
  return { type: "doc", content };
}

export function isDocEmpty(doc: Doc): boolean {
  return doc.content.every((n) => n.type === "paragraph" && !(n.content && n.content.length));
}

/** Walks every node depth-first. */
export function walkDoc(doc: Doc | BlockNode, visit: (node: BlockNode, parent: BlockNode | null) => void): void {
  const stack: Array<{ node: BlockNode; parent: BlockNode | null }> = [];
  const root = doc as BlockNode;
  for (let i = (root.content?.length ?? 0) - 1; i >= 0; i--) stack.push({ node: root.content![i]!, parent: root });
  while (stack.length) {
    const { node, parent } = stack.pop()!;
    visit(node, parent);
    if (node.content) {
      for (let i = node.content.length - 1; i >= 0; i--) stack.push({ node: node.content[i]!, parent: node });
    }
  }
}

/** Build a simple doc from plain paragraphs (used for quick-captured ideas). */
export function docFromText(text: string): Doc {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p.slice(0, LIMITS.maxTextPerNode) }] })),
  };
}
