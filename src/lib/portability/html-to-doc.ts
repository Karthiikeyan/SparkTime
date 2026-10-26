/**
 * HTML → block document, without a DOM.
 *
 * A tolerant tokenizer and tree builder handle the HTML that real exports
 * produce (Notion, blog engines, READMEs); the tree is then mapped onto the
 * block allowlist. The output is JSON for sanitizeDoc(), never HTML, so a
 * parsing mistake can cost fidelity but cannot inject markup. Script-like
 * elements are dropped together with their content.
 */
import type { BlockNode, Mark } from "../content/blocks";
import { parseYouTubeId } from "../embeds";
import type { BodyContext } from "./body-context";
import { ALERT_VARIANTS, decodeEntities, InlineBuilder, paragraph } from "./text";

// ---------------------------------------------------------------------------
// Tokenizer + tree
// ---------------------------------------------------------------------------

export type HtmlElement = { tag: string; attrs: Record<string, string>; children: HtmlNode[] };
export type HtmlNode = HtmlElement | string;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Elements whose content is never text for a reader (or is dangerous). */
const DROP_WITH_CONTENT = new Set(["script", "style", "noscript", "template", "textarea", "select", "button", "svg", "math", "object", "canvas", "video", "audio"]);
/** Parsed (for <title> and <meta>) but never converted into blocks. */
const METADATA_ONLY = new Set(["head", "meta", "link", "base"]);
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "details", "div", "dl", "dd", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "ul", "tbody", "thead", "tfoot", "tr", "td", "th", "center",
]);

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(source)) && count++ < 50) {
    const name = m[1]!.toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Builds a forgiving element tree. Unknown structure degrades to nested text, never to an exception. */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const top = () => stack[stack.length - 1]!;
  const closeTo = (tag: string): boolean => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i]!.tag === tag) {
        stack.length = i;
        return true;
      }
    }
    return false;
  };
  const implicitlyClose = (tag: string) => {
    const current = top().tag;
    if (current === "p" && BLOCK_TAGS.has(tag)) stack.pop();
    if (tag === "li") closeWithin("li", ["ul", "ol"]);
    if (tag === "dt" || tag === "dd") closeWithin(["dt", "dd"], ["dl"]);
    if (tag === "tr") closeWithin("tr", ["table", "tbody", "thead", "tfoot"]);
    if (tag === "td" || tag === "th") closeWithin(["td", "th"], ["tr", "table"]);
    if (tag === "tbody" || tag === "thead" || tag === "tfoot") closeWithin(["tbody", "thead", "tfoot", "tr", "td", "th"], ["table"]);
  };
  const closeWithin = (tags: string | string[], boundaries: string[]) => {
    const wanted = Array.isArray(tags) ? tags : [tags];
    for (let i = stack.length - 1; i > 0; i--) {
      const t = stack[i]!.tag;
      if (boundaries.includes(t)) return;
      if (wanted.includes(t)) {
        stack.length = i;
        return;
      }
    }
  };

  let pos = 0;
  const length = html.length;
  while (pos < length) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) {
      top().children.push(html.slice(pos));
      break;
    }
    if (lt > pos) top().children.push(html.slice(pos, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      pos = end === -1 ? length : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt);
      pos = end === -1 ? length : end + 1;
      continue;
    }
    const close = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(html.slice(lt, lt + 80));
    if (close) {
      closeTo(close[1]!.toLowerCase());
      pos = lt + close[0].length;
      continue;
    }
    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/.exec(html.slice(lt, lt + 4000));
    if (!open) {
      // A stray "<" is text.
      top().children.push("<");
      pos = lt + 1;
      continue;
    }
    const tag = open[1]!.toLowerCase();
    const attrs = parseAttributes(open[2] ?? "");
    pos = lt + open[0].length;
    if (DROP_WITH_CONTENT.has(tag) || tag === "title" || tag === "iframe") {
      const end = html.toLowerCase().indexOf(`</${tag}`, pos);
      const inner = end === -1 ? html.slice(pos) : html.slice(pos, end);
      if (tag === "title") root.attrs.title = decodeEntities(inner).trim();
      if (tag === "iframe") top().children.push({ tag, attrs, children: [] });
      if (end === -1) break;
      const gt = html.indexOf(">", end);
      pos = gt === -1 ? length : gt + 1;
      continue;
    }
    if (tag === "meta" && attrs.name?.toLowerCase() === "description" && attrs.content) root.attrs.description = attrs.content;
    implicitlyClose(tag);
    const element: HtmlElement = { tag, attrs, children: [] };
    top().children.push(element);
    if (!VOID.has(tag) && open[3] !== "/") stack.push(element);
    if (stack.length > 200) stack.length = 200; // pathological nesting
  }
  return root;
}

export function textContent(node: HtmlNode): string {
  if (typeof node === "string") return decodeEntities(node);
  if (node.tag === "br") return "\n";
  return node.children.map(textContent).join("");
}

function classList(el: HtmlElement): string[] {
  return (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
}

export function findElement(root: HtmlElement, predicate: (el: HtmlElement) => boolean): HtmlElement | null {
  for (const child of root.children) {
    if (typeof child === "string") continue;
    if (predicate(child)) return child;
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

export function removeElement(root: HtmlElement, target: HtmlElement): boolean {
  const i = root.children.indexOf(target);
  if (i !== -1) {
    root.children.splice(i, 1);
    return true;
  }
  return root.children.some((c) => typeof c !== "string" && removeElement(c, target));
}

// ---------------------------------------------------------------------------
// Tree → blocks
// ---------------------------------------------------------------------------

const INLINE_PASSTHROUGH = new Set(["span", "font", "small", "big", "sup", "sub", "mark", "abbr", "cite", "q", "time", "dfn", "var", "label", "ins", "bdi", "bdo", "data", "nobr", "wbr"]);
const MARK_TAGS: Record<string, Mark["type"]> = { strong: "bold", b: "bold", em: "italic", i: "italic", u: "underline", s: "strike", strike: "strike", del: "strike", code: "code", kbd: "code", samp: "code", tt: "code" };

type Converter = { ctx: BodyContext; lifted: BlockNode[] };

function isBlockElement(node: HtmlNode): boolean {
  return typeof node !== "string" && (BLOCK_TAGS.has(node.tag) || node.tag === "img" || node.tag === "iframe" || node.tag === "#root");
}

function collapse(text: string): string {
  return text.replace(/[ \t\r\n\f]+/g, " ");
}

function imageBlock(conv: Converter, el: HtmlElement, caption = ""): BlockNode | null {
  const src = el.attrs.src ? conv.ctx.media(el.attrs.src) : null;
  if (!src) return null;
  return { type: "image", attrs: { src, alt: el.attrs.alt ?? "", caption: caption || el.attrs.title || "" } };
}

function inlineInto(conv: Converter, b: InlineBuilder, node: HtmlNode, pre = false): void {
  if (typeof node === "string") {
    const text = decodeEntities(node);
    b.text(pre ? text : collapse(text));
    return;
  }
  const tag = node.tag;
  if (tag === "br") return b.hardBreak();
  if (tag === "img") {
    const img = imageBlock(conv, node);
    if (img) {
      conv.lifted.push(img);
      conv.ctx.stats.imagesLifted += 1;
    }
    return;
  }
  if (tag === "input") return; // task checkboxes are handled at list level
  if (tag === "iframe") {
    const block = iframeBlock(conv, node);
    if (block) conv.lifted.push(block);
    return;
  }
  const markType = MARK_TAGS[tag];
  if (markType) {
    b.withMark({ type: markType }, () => node.children.forEach((c) => inlineInto(conv, b, c, pre)));
    return;
  }
  if (tag === "a") {
    const href = node.attrs.href ? conv.ctx.link(node.attrs.href) : null;
    if (href) b.withMark({ type: "link", attrs: { href } }, () => node.children.forEach((c) => inlineInto(conv, b, c, pre)));
    else node.children.forEach((c) => inlineInto(conv, b, c, pre));
    return;
  }
  if (!INLINE_PASSTHROUGH.has(tag) && !BLOCK_TAGS.has(tag)) conv.ctx.stats.strippedTags.add(tag);
  node.children.forEach((c) => inlineInto(conv, b, c, pre));
}

function inlineContent(conv: Converter, nodes: HtmlNode[]): BlockNode[] {
  const b = new InlineBuilder();
  nodes.forEach((n) => inlineInto(conv, b, n));
  return b.nodes;
}

function iframeBlock(conv: Converter, el: HtmlElement): BlockNode | null {
  const videoId = parseYouTubeId(el.attrs.src ?? "");
  if (videoId) return { type: "youtube", attrs: { videoId, title: el.attrs.title ?? "" } };
  conv.ctx.stats.unsupported.add("embedded frame (iframe)");
  const href = el.attrs.src ? conv.ctx.link(el.attrs.src) : null;
  return href ? { type: "paragraph", content: [{ type: "text", text: el.attrs.title || "Embedded content", marks: [{ type: "link", attrs: { href } }] }] } : null;
}

function headingLevel(conv: Converter, tag: string): number {
  const n = Number(tag.slice(1));
  if (n > 3) conv.ctx.stats.headingsLowered += 1;
  return Math.min(3, Math.max(1, n));
}

function listBlock(conv: Converter, el: HtmlElement): BlockNode | null {
  const items = el.children.filter((c): c is HtmlElement => typeof c !== "string" && c.tag === "li");
  if (!items.length) return null;
  const isTask = items.every((li) => li.children.some((c) => typeof c !== "string" && c.tag === "input" && c.attrs.type === "checkbox") || /\bchecklist\b|to-do-list/.test(el.attrs.class ?? ""));
  if (isTask) {
    return {
      type: "taskList",
      content: items.map((li) => {
        const box = findElement(li, (c) => c.tag === "input" && c.attrs.type === "checkbox");
        const checked = box ? "checked" in box.attrs : /checkbox-on|checked/.test(JSON.stringify(li.attrs));
        return { type: "taskItem", attrs: { checked }, content: blocksOf(conv, li.children) };
      }),
    };
  }
  if (el.tag === "ol") {
    const start = Number(el.attrs.start);
    return { type: "orderedList", attrs: { start: Number.isFinite(start) && start > 0 ? start : 1 }, content: items.map((li) => ({ type: "listItem", content: blocksOf(conv, li.children) })) };
  }
  return { type: "bulletList", content: items.map((li) => ({ type: "listItem", content: blocksOf(conv, li.children) })) };
}

function tableBlock(conv: Converter, el: HtmlElement): BlockNode | null {
  const rows: HtmlElement[] = [];
  const collect = (node: HtmlElement) => {
    for (const child of node.children) {
      if (typeof child === "string") continue;
      if (child.tag === "tr") rows.push(child);
      else if (child.tag === "thead" || child.tag === "tbody" || child.tag === "tfoot") collect(child);
    }
  };
  collect(el);
  if (!rows.length) return null;
  return {
    type: "table",
    content: rows.map((row) => ({
      type: "tableRow",
      content: row.children
        .filter((c): c is HtmlElement => typeof c !== "string" && (c.tag === "td" || c.tag === "th"))
        .map((cell) => ({
          type: cell.tag === "th" ? "tableHeader" : "tableCell",
          attrs: { colspan: Number(cell.attrs.colspan) || 1, rowspan: Number(cell.attrs.rowspan) || 1 },
          content: blocksOf(conv, cell.children),
        })),
    })),
  };
}

/** A blockquote whose first line is a GitHub/Obsidian alert marker ("[!NOTE] Title") becomes a callout. */
export function alertCallout(blocks: BlockNode[]): BlockNode | null {
  const first = blocks[0];
  const firstText = first?.type === "paragraph" ? first.content?.[0] : undefined;
  const match = firstText?.type === "text" ? /^\s*\[!([A-Za-z]+)\][+-]?\s*/.exec(firstText.text ?? "") : null;
  const variant = match ? ALERT_VARIANTS[match[1]!.toLowerCase()] : undefined;
  if (!first || !firstText || !match || !variant) return null;
  firstText.text = (firstText.text ?? "").slice(match[0].length);
  const rest = first.content!.filter((n) => n.type !== "text" || (n.text ?? "").length > 0);
  // Drop a leading hard break left by "[!NOTE]\n".
  while (rest[0]?.type === "hardBreak") rest.shift();
  const content = rest.length ? [{ ...first, content: rest }, ...blocks.slice(1)] : blocks.slice(1);
  return { type: "callout", attrs: { variant }, content: content.length ? content : [{ type: "paragraph" }] };
}

/** Converts a mixed list of nodes into blocks, grouping runs of inline content into paragraphs. */
export function blocksOf(conv: Converter, nodes: HtmlNode[]): BlockNode[] {
  const out: BlockNode[] = [];
  let run: HtmlNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const p = paragraph(inlineContent(conv, run));
    if (p) out.push(p);
    // Images and frames found inside the run follow the paragraph they were in.
    out.push(...conv.lifted.splice(0));
    run = [];
  };
  for (const node of nodes) {
    if (typeof node !== "string" && METADATA_ONLY.has(node.tag)) continue;
    if (!isBlockElement(node)) {
      run.push(node);
      continue;
    }
    flush();
    out.push(...blockOf(conv, node as HtmlElement));
  }
  flush();
  return out;
}

function blockOf(conv: Converter, el: HtmlElement): BlockNode[] {
  const tag = el.tag;
  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const content = paragraph(inlineContent(conv, el.children))?.content;
      const lifted = conv.lifted.splice(0);
      return content ? [{ type: "heading", attrs: { level: headingLevel(conv, tag) }, content }, ...lifted] : lifted;
    }
    case "p": {
      const p = paragraph(inlineContent(conv, el.children));
      const lifted = conv.lifted.splice(0);
      return p ? [p, ...lifted] : lifted;
    }
    case "ul":
    case "ol": {
      const list = listBlock(conv, el);
      return list ? [list] : [];
    }
    case "pre": {
      const code = findElement(el, (c) => c.tag === "code");
      const lang = [...classList(code ?? el)].map((c) => /^(?:language|lang)-([a-z0-9+#.-]+)$/i.exec(c)?.[1]).find(Boolean) ?? null;
      const text = textContent(el).replace(/\n$/, "");
      return text ? [{ type: "codeBlock", attrs: { language: lang?.toLowerCase() ?? null }, content: [{ type: "text", text }] }] : [];
    }
    case "blockquote": {
      const inner = blocksOf(conv, el.children);
      return [alertCallout(inner) ?? { type: "blockquote", content: inner }];
    }
    case "aside": {
      const inner = blocksOf(conv, el.children);
      const variant = ALERT_VARIANTS[(el.attrs["data-callout"] ?? "").toLowerCase()];
      return [variant ? { type: "callout", attrs: { variant }, content: inner } : { type: "callout", attrs: { variant: "note" }, content: inner }];
    }
    case "hr":
      return [{ type: "horizontalRule" }];
    case "img": {
      const img = imageBlock(conv, el);
      return img ? [img] : [];
    }
    case "iframe": {
      const block = iframeBlock(conv, el);
      return block ? [block] : [];
    }
    case "figure": {
      const img = findElement(el, (c) => c.tag === "img");
      const caption = findElement(el, (c) => c.tag === "figcaption");
      if (img) {
        const block = imageBlock(conv, img, caption ? collapse(textContent(caption)).trim() : "");
        if (block) return [block];
      }
      return blocksOf(conv, el.children);
    }
    case "table": {
      const table = tableBlock(conv, el);
      return table ? [table] : [];
    }
    case "details": {
      const summaryEl = el.children.find((c): c is HtmlElement => typeof c !== "string" && c.tag === "summary");
      const rest = el.children.filter((c) => c !== summaryEl);
      return [
        {
          type: "details",
          content: [
            { type: "detailsSummary", content: summaryEl ? paragraph(inlineContent(conv, summaryEl.children))?.content : undefined },
            { type: "detailsContent", content: blocksOf(conv, rest) },
          ],
        },
      ];
    }
    case "dl": {
      // Definition lists have no block of their own: term in bold, definition as a paragraph.
      conv.ctx.stats.unsupported.add("definition list (converted to paragraphs)");
      const out: BlockNode[] = [];
      for (const child of el.children) {
        if (typeof child === "string") continue;
        const inline = inlineContent(conv, child.children);
        if (child.tag === "dt") out.push({ type: "paragraph", content: inline.map((n) => (n.type === "text" ? { ...n, marks: [...(n.marks ?? []), { type: "bold" as const }] } : n)) });
        else out.push(...blocksOf(conv, child.children));
      }
      return out;
    }
    case "summary":
    case "li":
    case "dt":
    case "dd":
    case "tr":
    case "td":
    case "th":
    case "thead":
    case "tbody":
    case "tfoot":
    case "figcaption":
      return blocksOf(conv, el.children);
    default:
      // div, section, article, main, header, footer, nav, center, #root …
      return blocksOf(conv, el.children);
  }
}

export type HtmlConversion = { blocks: BlockNode[]; title: string | null; description: string | null };

/** Converts an HTML fragment or document. `root` lets callers pre-process the tree (Notion headers). */
export function htmlToBlocks(htmlOrRoot: string | HtmlElement, ctx: BodyContext): HtmlConversion {
  const root = typeof htmlOrRoot === "string" ? parseHtml(htmlOrRoot) : htmlOrRoot;
  const body = findElement(root, (el) => el.tag === "body") ?? root;
  const conv: Converter = { ctx, lifted: [] };
  const blocks = blocksOf(conv, body.children);
  return { blocks, title: root.attrs.title || null, description: root.attrs.description || null };
}
