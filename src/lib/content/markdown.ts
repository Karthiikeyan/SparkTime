/**
 * Block document → Markdown (GitHub-flavoured). Used for data portability:
 * every export ships lossless JSON *and* human-readable Markdown so content
 * is never trapped in this application.
 */
import { youTubeWatchUrl } from "../embeds";
import type { BlockNode, Doc, Mark } from "./blocks";

export type MarkdownOptions = {
  /** Resolve a referenced document id to a title + URL (public or absolute). */
  resolveDocument?: (id: string) => { title: string; url: string } | null;
};

const CALLOUT_ALERT: Record<string, string> = { note: "NOTE", tip: "TIP", warning: "WARNING", important: "IMPORTANT" };

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>|])/g, "\\$1");
}

function wrapMarks(text: string, marks: Mark[] | undefined): string {
  if (!marks?.length) return escapeText(text);
  const isCode = marks.some((m) => m.type === "code");
  let out = isCode ? `\`${text.replace(/`/g, "ˋ")}\`` : escapeText(text);
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        out = `**${out}**`;
        break;
      case "italic":
        out = `_${out}_`;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "underline":
        out = `<u>${out}</u>`;
        break;
    }
  }
  const link = marks.find((m) => m.type === "link");
  if (link?.attrs?.href) out = `[${out}](${link.attrs.href.replace(/\)/g, "%29")})`;
  return out;
}

function inline(nodes: BlockNode[] | undefined, opts: MarkdownOptions): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "text") return wrapMarks(node.text ?? "", node.marks);
      if (node.type === "hardBreak") return "  \n";
      if (node.type === "docRef") {
        const label = String(node.attrs?.label ?? "");
        const ref = opts.resolveDocument?.(String(node.attrs?.documentId ?? ""));
        return ref ? `[${escapeText(label || ref.title)}](${ref.url})` : escapeText(label);
      }
      return "";
    })
    .join("");
}

function indent(text: string, prefix: string, firstPrefix = prefix): string {
  return text
    .split("\n")
    .map((line, i) => (line ? (i === 0 ? firstPrefix : prefix) + line : line))
    .join("\n");
}

function blocks(nodes: BlockNode[] | undefined, opts: MarkdownOptions): string {
  return (nodes ?? [])
    .map((n) => block(n, opts))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

function cellText(cell: BlockNode, opts: MarkdownOptions): string {
  // Pipes in text are already escaped by escapeText().
  return blocks(cell.content, opts).replace(/\n+/g, "<br>");
}

function block(node: BlockNode, opts: MarkdownOptions): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "paragraph":
      return inline(node.content, opts);
    case "heading":
      return `${"#".repeat(Number(a.level ?? 2))} ${inline(node.content, opts)}`;
    case "blockquote":
      return indent(blocks(node.content, opts), "> ");
    case "callout":
      return `> [!${CALLOUT_ALERT[String(a.variant)] ?? "NOTE"}]\n${indent(blocks(node.content, opts), "> ")}`;
    case "bulletList":
      return (node.content ?? []).map((li) => indent(blocks(li.content, opts), "  ", "- ")).join("\n");
    case "orderedList": {
      const start = Number(a.start ?? 1);
      return (node.content ?? []).map((li, i) => indent(blocks(li.content, opts), "   ", `${start + i}. `)).join("\n");
    }
    case "taskList":
      return (node.content ?? [])
        .map((li) => indent(blocks(li.content, opts), "  ", li.attrs?.checked ? "- [x] " : "- [ ] "))
        .join("\n");
    case "codeBlock": {
      const code = (node.content ?? []).map((t) => t.text ?? "").join("");
      const fence = code.includes("```") ? "````" : "```";
      return `${fence}${a.language ?? ""}\n${code}\n${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "image": {
      const caption = a.caption ? ` "${String(a.caption).replace(/"/g, "'")}"` : "";
      return `![${escapeText(String(a.alt ?? ""))}](${a.src}${caption})`;
    }
    case "gallery":
      return ((a.images as Array<{ src: string; alt: string }>) ?? []).map((img) => `![${escapeText(img.alt)}](${img.src})`).join("\n");
    case "youtube":
      return `[▶ ${escapeText(String(a.title || "Watch on YouTube"))}](${youTubeWatchUrl(String(a.videoId))})`;
    case "embed":
      return `[${escapeText(String(a.title || `${a.provider} embed`))}](${a.provider}:${a.embedId})`;
    case "audio":
      return `[🎧 ${escapeText(String(a.title || "Audio"))}](${a.src})`;
    case "file":
      return `[📎 ${escapeText(String(a.name))}](${a.src})`;
    case "bookmark": {
      const desc = a.description ? ` — ${escapeText(String(a.description))}` : "";
      return `[${escapeText(String(a.title || a.url))}](${a.url})${desc}`;
    }
    case "button":
      return `[${escapeText(String(a.label))}](${a.href})`;
    case "columns":
      return (node.content ?? []).map((col) => blocks(col.content, opts)).join("\n\n");
    case "details": {
      const summary = node.content?.find((c) => c.type === "detailsSummary");
      const body = node.content?.find((c) => c.type === "detailsContent");
      return `<details>\n<summary>${inline(summary?.content, opts)}</summary>\n\n${blocks(body?.content, opts)}\n\n</details>`;
    }
    case "table": {
      const rows = node.content ?? [];
      if (!rows.length) return "";
      const matrix = rows.map((row) => (row.content ?? []).map((cell) => cellText(cell, opts)));
      const width = Math.max(...matrix.map((r) => r.length));
      const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
      const [head, ...rest] = matrix.map(pad);
      return [`| ${head!.join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`, ...rest.map((r) => `| ${r.join(" | ")} |`)].join("\n");
    }
    case "relatedContent": {
      const items = ((a.documentIds as string[]) ?? [])
        .map((id) => opts.resolveDocument?.(id))
        .filter((r): r is { title: string; url: string } => Boolean(r));
      if (!items.length) return "";
      const title = a.title ? `**${escapeText(String(a.title))}**\n\n` : "";
      return title + items.map((r) => `- [${escapeText(r.title)}](${r.url})`).join("\n");
    }
    case "tool":
      return `<!-- interactive tool: ${a.kind} -->`;
    default:
      return blocks(node.content, opts);
  }
}

export function docToMarkdown(doc: Doc, opts: MarkdownOptions = {}): string {
  return blocks(doc.content, opts).trim() + "\n";
}

/** YAML front matter using JSON-compatible scalars (valid YAML 1.2). */
export function frontMatter(data: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}
