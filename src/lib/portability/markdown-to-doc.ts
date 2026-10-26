/**
 * Markdown / MDX → block document, on top of marked's lexer (GFM). Runs
 * anywhere (no DOM). Block-level HTML goes through html-to-doc; inline HTML
 * tags that map to marks (<u>, <b>, <a href>, <br>…) become marks.
 *
 * MDX is never evaluated: ESM statements are removed (and reported), JSX
 * component blocks are preserved verbatim as `mdx` code blocks, and MDX
 * comments are dropped.
 */
import { Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from "marked";
import type { BlockNode } from "../content/blocks";
import { parseYouTubeId } from "../embeds";
import type { BodyContext } from "./body-context";
import { alertCallout, htmlToBlocks, parseHtml } from "./html-to-doc";
import { decodeEntities, InlineBuilder, paragraph } from "./text";

type WikiToken = { type: "wikilink"; raw: string; embed: boolean; target: string; label: string | null };

const wikilink: TokenizerAndRendererExtension = {
  name: "wikilink",
  level: "inline",
  start(src: string) {
    const i = src.indexOf("[[");
    if (i === -1) return undefined;
    return i > 0 && src[i - 1] === "!" ? i - 1 : i;
  },
  tokenizer(src: string) {
    const m = /^(!?)\[\[([^[\]\n|]+?)(?:\|([^[\]\n]*))?\]\]/.exec(src);
    if (!m) return undefined;
    return { type: "wikilink", raw: m[0], embed: m[1] === "!", target: m[2]!.trim(), label: m[3]?.trim() || null } as unknown as Tokens.Generic;
  },
  renderer: () => "",
};

const markdown = new Marked({ gfm: true, breaks: false, extensions: [wikilink] });

// ---------------------------------------------------------------------------
// MDX pre-processing
// ---------------------------------------------------------------------------

export type MdxPreprocess = { source: string; esm: string[]; components: string[] };

/** Removes ESM and MDX comments; fences JSX component blocks. Code fences are left untouched. */
export function preprocessMdx(source: string): MdxPreprocess {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  const esm: string[] = [];
  const components = new Set<string>();
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (fenceMatch && fenceMatch[1]!.startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1]!;
      out.push(line);
      continue;
    }
    if (/^(import|export)\s/.test(line)) {
      // ESM can span lines until a line ends a statement.
      let statement = line;
      while (!/[;'"`)}\]]\s*$/.test(statement.split("\n").at(-1)!) && i + 1 < lines.length && lines[i + 1]!.trim() !== "") statement += "\n" + lines[++i];
      esm.push(statement);
      continue;
    }
    const jsx = /^\s*<([A-Z][\w.]*)\b/.exec(line);
    if (jsx) {
      const name = jsx[1]!;
      components.add(name);
      const block = [line];
      const selfClosing = /\/>\s*$/.test(line) && !line.includes(`</${name}`);
      if (!selfClosing && !line.includes(`</${name}>`)) {
        while (i + 1 < lines.length) {
          const next = lines[++i]!;
          block.push(next);
          if (next.includes(`</${name}>`)) break;
        }
      }
      out.push("```mdx", ...block, "```");
      continue;
    }
    out.push(line.replace(/\{\/\*[\s\S]*?\*\/\}/g, ""));
  }
  return { source: out.join("\n"), esm, components: [...components] };
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

type State = { ctx: BodyContext; lifted: BlockNode[]; anchors: boolean[] };

const INLINE_HTML_MARKS: Record<string, "bold" | "italic" | "underline" | "strike" | "code"> = {
  b: "bold", strong: "bold", i: "italic", em: "italic", u: "underline", ins: "underline", s: "strike", del: "strike", strike: "strike", code: "code", kbd: "code",
};
const IGNORED_INLINE_TAGS = new Set(["span", "sup", "sub", "mark", "small", "abbr", "cite", "q", "font", "time"]);

function inlineHtml(state: State, b: InlineBuilder, raw: string): void {
  const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>$/s.exec(raw.trim());
  if (!tag) {
    if (!/^<!--/.test(raw.trim())) b.text(decodeEntities(raw));
    return;
  }
  const closing = tag[1] === "/";
  const name = tag[2]!.toLowerCase();
  if (name === "br") return b.hardBreak();
  const mark = INLINE_HTML_MARKS[name];
  if (mark) return closing ? b.close(mark) : b.open({ type: mark });
  if (name === "a") {
    // Track which <a> opened a link, so an <a> without a usable href closes nothing.
    if (closing) {
      if (state.anchors.pop()) b.close("link");
      return;
    }
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[3] ?? "");
    const value = href ? decodeEntities(href[1] ?? href[2] ?? href[3] ?? "") : "";
    const stored = value ? state.ctx.link(value) : null;
    state.anchors.push(Boolean(stored));
    if (stored) b.open({ type: "link", attrs: { href: stored } });
    return;
  }
  if (name === "img" && !closing) {
    const blocks = htmlToBlocks(parseHtml(raw), state.ctx).blocks;
    state.lifted.push(...blocks.filter((n) => n.type === "image"));
    state.ctx.stats.imagesLifted += 1;
    return;
  }
  if (!IGNORED_INLINE_TAGS.has(name)) state.ctx.stats.strippedTags.add(/^[A-Z]/.test(tag[2]!) ? `<${tag[2]}> (MDX)` : name);
}

function inlineTokens(state: State, b: InlineBuilder, tokens: Token[] | undefined): void {
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens?.length) inlineTokens(state, b, t.tokens);
        else b.text(decodeEntities(t.text).replace(/\n/g, " "));
        break;
      }
      case "escape":
        b.text((token as Tokens.Escape).text);
        break;
      case "strong":
        b.withMark({ type: "bold" }, () => inlineTokens(state, b, (token as Tokens.Strong).tokens));
        break;
      case "em":
        b.withMark({ type: "italic" }, () => inlineTokens(state, b, (token as Tokens.Em).tokens));
        break;
      case "del":
        b.withMark({ type: "strike" }, () => inlineTokens(state, b, (token as Tokens.Del).tokens));
        break;
      case "codespan":
        b.withMark({ type: "code" }, () => b.text((token as Tokens.Codespan).text));
        break;
      case "br":
        b.hardBreak();
        break;
      case "link": {
        const link = token as Tokens.Link;
        const href = state.ctx.link(link.href);
        if (href) b.withMark({ type: "link", attrs: { href } }, () => inlineTokens(state, b, link.tokens));
        else inlineTokens(state, b, link.tokens);
        break;
      }
      case "image": {
        const image = token as Tokens.Image;
        const src = state.ctx.media(image.href);
        if (src) {
          state.lifted.push({ type: "image", attrs: { src, alt: decodeEntities(image.text), caption: image.title ? decodeEntities(image.title) : "" } });
          state.ctx.stats.imagesLifted += 1;
        }
        break;
      }
      case "html":
        inlineHtml(state, b, (token as Tokens.Tag).text);
        break;
      case "checkbox":
        break;
      case "wikilink": {
        const w = token as unknown as WikiToken;
        const label = w.label ?? w.target.replace(/#.*$/, "").split("/").pop() ?? w.target;
        if (w.embed && state.ctx.wikiEmbed) {
          const embed = state.ctx.wikiEmbed(w.target);
          if (embed.kind === "image") {
            if (embed.src) state.lifted.push({ type: "image", attrs: { src: embed.src, alt: w.label && !/^\d+(x\d+)?$/.test(w.label) ? w.label : "", caption: "" } });
            break;
          }
          if (embed.href) b.withMark({ type: "link", attrs: { href: embed.href } }, () => b.text(label));
          else b.text(label);
          break;
        }
        const href = state.ctx.wikiLink?.(w.target) ?? null;
        if (href) b.withMark({ type: "link", attrs: { href } }, () => b.text(label));
        else b.text(label);
        break;
      }
      default: {
        const generic = token as Tokens.Generic;
        if (generic.tokens) inlineTokens(state, b, generic.tokens);
        else if (typeof generic.text === "string") b.text(decodeEntities(generic.text));
      }
    }
  }
}

function inlineBlock(state: State, tokens: Token[] | undefined): { content: BlockNode[] | null; lifted: BlockNode[] } {
  const b = new InlineBuilder();
  inlineTokens(state, b, tokens);
  const lifted = state.lifted.splice(0);
  return { content: paragraph(b.nodes)?.content ?? null, lifted };
}

function paragraphBlocks(state: State, tokens: Token[] | undefined): BlockNode[] {
  // A paragraph that is only a YouTube link becomes a player.
  if (tokens?.length === 1 && tokens[0]!.type === "link") {
    const videoId = parseYouTubeId((tokens[0] as Tokens.Link).href);
    const text = (tokens[0] as Tokens.Link).text;
    if (videoId) return [{ type: "youtube", attrs: { videoId, title: text && !/^https?:/.test(text) ? text : "" } }];
  }
  const { content, lifted } = inlineBlock(state, tokens);
  return [...(content ? [{ type: "paragraph", content }] : []), ...lifted];
}

function listItemBlocks(state: State, item: Tokens.ListItem): BlockNode[] {
  return blockTokens(state, item.tokens.filter((t) => t.type !== "checkbox"));
}

function calloutFromBlockquote(state: State, token: Tokens.Blockquote): BlockNode {
  const inner = blockTokens(state, token.tokens);
  const marker = /^\[!([A-Za-z]+)\][+-]?[ \t]*([^\n]*)/.exec(token.text.trimStart());
  const callout = alertCallout(inner);
  if (!callout || !marker) return callout ?? { type: "blockquote", content: inner };
  const title = marker[2]!.trim();
  if (!title) return callout;
  // Obsidian callout titles: "> [!tip] Title" — keep the title as a bold first line.
  const first = callout.content?.[0];
  const firstText = first?.type === "paragraph" ? first.content?.[0] : undefined;
  if (firstText?.type === "text" && (firstText.text ?? "").startsWith(title)) {
    firstText.text = (firstText.text ?? "").slice(title.length).replace(/^\s+/, "");
    if (!firstText.text) first!.content!.shift();
    if (!first!.content!.length) callout.content!.shift();
  }
  callout.content = [{ type: "paragraph", content: [{ type: "text", text: title, marks: [{ type: "bold" }] }] }, ...(callout.content ?? [])];
  return callout;
}

function blockTokens(state: State, tokens: Token[]): BlockNode[] {
  const out: BlockNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "heading": {
        const h = token as Tokens.Heading;
        if (h.depth > 3) state.ctx.stats.headingsLowered += 1;
        const { content, lifted } = inlineBlock(state, h.tokens);
        if (content) out.push({ type: "heading", attrs: { level: Math.min(3, h.depth) }, content });
        out.push(...lifted);
        break;
      }
      case "paragraph":
        out.push(...paragraphBlocks(state, (token as Tokens.Paragraph).tokens));
        break;
      case "text": {
        // Tight list items carry "text" blocks.
        const t = token as Tokens.Text;
        out.push(...paragraphBlocks(state, t.tokens ?? [{ type: "text", raw: t.raw, text: t.text } as Tokens.Text]));
        break;
      }
      case "blockquote":
        out.push(calloutFromBlockquote(state, token as Tokens.Blockquote));
        break;
      case "list": {
        const list = token as Tokens.List;
        if (list.items.length && list.items.every((it) => it.task)) {
          out.push({ type: "taskList", content: list.items.map((it) => ({ type: "taskItem", attrs: { checked: it.checked === true }, content: listItemBlocks(state, it) })) });
        } else if (list.ordered) {
          const start = typeof list.start === "number" ? list.start : 1;
          out.push({ type: "orderedList", attrs: { start }, content: list.items.map((it) => ({ type: "listItem", content: listItemBlocks(state, it) })) });
        } else {
          out.push({ type: "bulletList", content: list.items.map((it) => ({ type: "listItem", content: listItemBlocks(state, it) })) });
        }
        break;
      }
      case "code": {
        const code = token as Tokens.Code;
        const language = (code.lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() || null;
        out.push({ type: "codeBlock", attrs: { language }, content: code.text ? [{ type: "text", text: code.text }] : undefined });
        break;
      }
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "table": {
        const table = token as Tokens.Table;
        const cell = (c: Tokens.TableCell, type: "tableHeader" | "tableCell"): BlockNode => {
          const { content, lifted } = inlineBlock(state, c.tokens);
          return { type, content: [...(content ? [{ type: "paragraph", content }] : [{ type: "paragraph" }]), ...lifted] };
        };
        out.push({
          type: "table",
          content: [
            { type: "tableRow", content: table.header.map((c) => cell(c, "tableHeader")) },
            ...table.rows.map((row) => ({ type: "tableRow", content: row.map((c) => cell(c, "tableCell")) })),
          ],
        });
        break;
      }
      case "html": {
        const html = token as Tokens.HTML;
        const open = /^\s*<details\b[^>]*>/i.exec(html.text);
        if (open && !/<\/details>/i.test(html.text)) {
          // <details> spanning Markdown: collect tokens up to the matching </details>.
          const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(html.text);
          const inner: Token[] = [];
          let depth = 1;
          let j = i + 1;
          for (; j < tokens.length; j++) {
            const t = tokens[j]!;
            if (t.type === "html") {
              const text = (t as Tokens.HTML).text;
              depth += (text.match(/<details\b/gi) ?? []).length;
              depth -= (text.match(/<\/details>/gi) ?? []).length;
              if (depth <= 0) break;
            }
            inner.push(t);
          }
          i = j;
          const summaryContent = summary ? paragraph(htmlInline(state, summary[1]!))?.content : undefined;
          out.push({ type: "details", content: [{ type: "detailsSummary", content: summaryContent }, { type: "detailsContent", content: blockTokens(state, inner) }] });
          break;
        }
        out.push(...htmlToBlocks(html.text, state.ctx).blocks);
        break;
      }
      default: {
        const generic = token as Tokens.Generic;
        if (generic.tokens) out.push(...paragraphBlocks(state, generic.tokens));
        else if (generic.text) out.push({ type: "paragraph", content: [{ type: "text", text: String(generic.text) }] });
      }
    }
  }
  return out;
}

function htmlInline(state: State, html: string): BlockNode[] {
  const blocks = htmlToBlocks(`<p>${html}</p>`, state.ctx).blocks;
  return blocks[0]?.type === "paragraph" ? (blocks[0].content ?? []) : [];
}

export function markdownToBlocks(source: string, ctx: BodyContext): BlockNode[] {
  const tokens = markdown.lexer(source.replace(/\r\n?/g, "\n"));
  return blockTokens({ ctx, lifted: [], anchors: [] }, tokens);
}
