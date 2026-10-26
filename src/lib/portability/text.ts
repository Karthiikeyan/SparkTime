/**
 * Text helpers shared by the Markdown and HTML converters: entity decoding
 * and a small builder for inline content with marks.
 */
import type { BlockNode, Mark, MarkType } from "../content/blocks";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™",
  deg: "°", plusmn: "±", times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", dagger: "†", Dagger: "‡", permil: "‰",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", rArr: "⇒", lArr: "⇐", hearts: "♥", check: "✓",
  shy: "­", zwj: "‍", zwnj: "‌", iexcl: "¡", iquest: "¿", micro: "µ", infin: "∞", ne: "≠", le: "≤", ge: "≥",
  rupee: "₹", inr: "₹",
};

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/**
 * Collects inline nodes. Marks are a stack: open/close calls mirror nested
 * tags (`<strong><em>…</em></strong>`, `**_…_**`). Text always carries the
 * marks active when it was added.
 */
export class InlineBuilder {
  readonly nodes: BlockNode[] = [];
  private marks: Mark[] = [];

  withMark<T>(mark: Mark, fn: () => T): T {
    this.marks.push(mark);
    try {
      return fn();
    } finally {
      const i = this.marks.lastIndexOf(mark);
      if (i !== -1) this.marks.splice(i, 1);
    }
  }

  open(mark: Mark): void {
    this.marks.push(mark);
  }

  close(type: MarkType): void {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      if (this.marks[i]!.type === type) {
        this.marks.splice(i, 1);
        return;
      }
    }
  }

  text(value: string): void {
    if (!value) return;
    const marks = this.activeMarks();
    const last = this.nodes.at(-1);
    if (last?.type === "text" && sameMarks(last.marks, marks)) {
      last.text = (last.text ?? "") + value;
      return;
    }
    this.nodes.push(marks ? { type: "text", text: value, marks } : { type: "text", text: value });
  }

  hardBreak(): void {
    this.nodes.push({ type: "hardBreak" });
  }

  node(node: BlockNode): void {
    this.nodes.push(node);
  }

  isEmpty(): boolean {
    return this.nodes.every((n) => n.type === "text" && !(n.text ?? "").trim());
  }

  private activeMarks(): Mark[] | undefined {
    if (!this.marks.length) return undefined;
    // One mark per type; the innermost link wins.
    const byType = new Map<MarkType, Mark>();
    for (const mark of this.marks) byType.set(mark.type, mark);
    return [...byType.values()];
  }
}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  if (!a?.length && !b?.length) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((m, i) => m.type === b[i]!.type && m.attrs?.href === b[i]!.attrs?.href);
}

/** Trims leading/trailing whitespace of an inline run (collapsed HTML text, Markdown soft breaks). */
export function trimInline(nodes: BlockNode[]): BlockNode[] {
  const out = nodes.map((n) => ({ ...n }));
  while (out.length && out[0]!.type === "hardBreak") out.shift();
  while (out.length && out.at(-1)!.type === "hardBreak") out.pop();
  const first = out.find((n) => n.type === "text");
  if (first?.text) first.text = first.text.replace(/^\s+/, "");
  const last = [...out].reverse().find((n) => n.type === "text");
  if (last?.text) last.text = last.text.replace(/\s+$/, "");
  return out.filter((n) => n.type !== "text" || (n.text ?? "").length > 0);
}

export function paragraph(nodes: BlockNode[]): BlockNode | null {
  const content = trimInline(nodes);
  return content.length ? { type: "paragraph", content } : null;
}

export function plainParagraph(text: string): BlockNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

/** GitHub/Obsidian alert keywords → callout variants. */
export const ALERT_VARIANTS: Record<string, "note" | "tip" | "warning" | "important"> = {
  note: "note", info: "note", abstract: "note", summary: "note", tldr: "note", todo: "note", example: "note", quote: "note", question: "note",
  tip: "tip", hint: "tip", success: "tip", check: "tip", done: "tip",
  warning: "warning", caution: "warning", attention: "warning", failure: "warning", fail: "warning", missing: "warning", bug: "warning",
  important: "important", danger: "important", error: "important",
};
