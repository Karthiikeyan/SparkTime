/**
 * Deterministic paste handling for content copied from AI tools, docs and
 * the web. No AI API involved.
 *
 * Decision order for a paste:
 *   1. files (images/PDFs)          → upload
 *   2. semantic HTML                → sanitise with DOMPurify, let the schema parse it
 *   3. Markdown-looking plain text  → marked → sanitise → schema parse
 *   4. plain text                   → default ProseMirror behaviour
 * HTML that is really syntax-highlighted source (VS Code, IDEs) is treated as
 * its plain-text Markdown, not as styled spans.
 *
 * The pure functions here are unit-tested; DOM-dependent helpers only run in
 * the browser at paste time.
 */
import { marked } from "marked";

const SEMANTIC_TAGS = /<(h[1-6]|ul|ol|li|p|blockquote|pre|table|thead|tbody|tr|td|th|strong|b|em|i|a\s[^>]*href|img|code|hr|details|figure)\b/i;

/** Scores plain text for Markdown structure. */
export function markdownScore(text: string): number {
  if (!text || text.length > 400_000) return 0;
  const lines = text.split(/\r?\n/);
  let score = 0;
  let fences = 0;
  for (const line of lines) {
    if (/^#{1,6}\s+\S/.test(line)) score += 3;
    else if (/^```/.test(line)) fences += 1;
    else if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(line)) score += 2;
    else if (/^\s*([-*+]|\d{1,3}[.)])\s+\S/.test(line)) score += 1;
    else if (/^>\s?/.test(line)) score += 1;
    else if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) score += 3;
    else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) score += 1;
  }
  if (fences >= 2) score += 3;
  if (/\*\*[^*\n]+\*\*/.test(text)) score += 1;
  if (/\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)/.test(text)) score += 2;
  if (/`[^`\n]+`/.test(text)) score += 1;
  return score;
}

export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const score = markdownScore(text);
  return score >= 3 || (score >= 2 && lines >= 2);
}

/** True when HTML carries real document structure worth keeping. */
export function isSemanticHtml(html: string): boolean {
  return SEMANTIC_TAGS.test(html);
}

/** Syntax-highlighted source copied from an editor: only div/span/br with inline styles. */
export function isCodeEditorHtml(html: string): boolean {
  if (/data-vscode|vscode-/i.test(html)) return true;
  const withoutAllowed = html.replace(/<\/?(div|span|br|meta|html|body|head|style)[^>]*>/gi, "");
  return !/<[a-z]/i.test(withoutAllowed) && /font-family:[^;"]*(mono|consolas|courier|menlo)/i.test(html);
}

export type PasteStrategy = "files" | "html" | "markdown" | "text";

export function choosePasteStrategy(input: { hasFiles: boolean; html: string; text: string }): PasteStrategy {
  if (input.hasFiles && !input.text.trim()) return "files";
  if (input.html && isSemanticHtml(input.html) && !isCodeEditorHtml(input.html)) {
    // Some apps put Markdown source in text/plain and a trivial HTML wrapper in text/html.
    if (!/<(h[1-6]|ul|ol|table|pre|blockquote)\b/i.test(input.html) && looksLikeMarkdown(input.text)) return "markdown";
    return "html";
  }
  if (input.hasFiles) return "files";
  if (looksLikeMarkdown(input.text)) return "markdown";
  return "text";
}

/**
 * LinkedIn renders each hashtag with a visually hidden "hashtag" label before
 * the "#", and copying a post carries that label along: "hashtag#LifeLessons".
 * The label is never meant to be read on the page, so drop it.
 */
export function stripHiddenHashtagLabels(text: string): string {
  return text.replace(/\bhashtag#(?=[\p{L}\p{N}_])/gu, "#");
}

/** Markdown → HTML (GFM: tables, task lists, strikethrough). Output is sanitised by the caller. */
export function markdownToHtml(markdown: string): string {
  return marked.parse(stripHiddenHashtagLabels(markdown.replace(/\r\n/g, "\n")), { gfm: true, breaks: false, async: false }) as string;
}

// ---------------------------------------------------------------------------
// Browser-only helpers
// ---------------------------------------------------------------------------

const ALERT = /^\s*\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*/i;

/**
 * Maps generic HTML onto our schema's parse rules: GitHub task lists → task
 * items, GitHub alerts → callouts, and removes images that aren't hosted in
 * our media library (they'd be blocked by CSP anyway; paste them as files).
 */
export function adaptHtmlToSchema(html: string, isOwnMedia: (src: string) => boolean): { html: string; droppedImages: number } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let droppedImages = 0;

  // Screen-reader-only labels ("hashtag", "opens in a new tab") are invisible
  // on the source page; pasted, they'd become visible text.
  doc.querySelectorAll(".visually-hidden, .sr-only, .screen-reader-text, .a11y-text").forEach((el) => el.remove());
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  texts.forEach((node, i) => {
    const value = node.nodeValue ?? "";
    // The label may share a text node with the tag ("hashtag#Growth") or sit in its own element.
    if (value.includes("hashtag#")) node.nodeValue = stripHiddenHashtagLabels(value);
    else if (value.trim().toLowerCase() === "hashtag" && texts[i + 1]?.nodeValue?.startsWith("#")) node.nodeValue = "";
  });

  doc.querySelectorAll("li").forEach((li) => {
    const box = li.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]");
    if (!box) return;
    li.setAttribute("data-type", "taskItem");
    li.setAttribute("data-checked", box.hasAttribute("checked") ? "true" : "false");
    box.remove();
    li.parentElement?.setAttribute("data-type", "taskList");
  });

  doc.querySelectorAll("blockquote").forEach((bq) => {
    const first = bq.querySelector("p");
    const match = first?.textContent ? ALERT.exec(first.textContent) : null;
    if (!first || !match) return;
    const variant = { NOTE: "note", TIP: "tip", WARNING: "warning", CAUTION: "warning", IMPORTANT: "important" }[match[1]!.toUpperCase()] ?? "note";
    first.innerHTML = first.innerHTML.replace(/\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(<br\s*\/?>)?/i, "");
    if (!first.textContent?.trim()) first.remove();
    const aside = doc.createElement("aside");
    aside.setAttribute("data-callout", variant);
    aside.innerHTML = bq.innerHTML;
    bq.replaceWith(aside);
  });

  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (!isOwnMedia(src)) {
      droppedImages += 1;
      img.remove();
    }
  });

  return { html: doc.body.innerHTML, droppedImages };
}

let purifier: typeof import("dompurify").default | null = null;

/** Load DOMPurify ahead of time (ProseMirror's paste transform is synchronous). */
export async function loadPurifier(): Promise<void> {
  if (!purifier) purifier = (await import("dompurify")).default;
}

/**
 * Allowlist sanitiser for pasted HTML (defence in depth before the schema
 * parser). If DOMPurify hasn't loaded yet, falls back to plain text — never
 * to unsanitised HTML.
 */
export function sanitizePastedHtml(html: string): string {
  if (!purifier) {
    const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
    return text
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
      .join("");
  }
  return purifier.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "strike", "del", "code", "pre", "blockquote",
      "ul", "ol", "li", "a", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "hr", "details", "summary", "aside", "div", "span", "input", "figure", "figcaption",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "colspan", "rowspan", "start", "data-type", "data-checked", "data-callout", "class", "checked", "type"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/(?!\/)|#)/i,
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "svg", "math", "link", "meta"],
    KEEP_CONTENT: true,
  });
}
