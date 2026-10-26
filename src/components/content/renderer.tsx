import { FileDown, Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { safeMediaSrc, walkDoc, type BlockNode, type CalloutVariant, type Doc, type Mark, type ToolKind } from "@/lib/content/blocks";
import { extractHeadings, headingRanker } from "@/lib/content/derive";
import { formatBytes, type MediaAsset } from "@/lib/media";
import { hostnameOf, safeExternalUrl, safeHref } from "@/lib/url";
import { highlightCode, type HighlightedCode } from "@/server/content/highlight";
import type { Card } from "@/server/services/public-content";
import { Callout } from "@/components/ui/callout";
import { CodeBlock } from "@/components/ui/code-block";
import { CardLink } from "./cards";
import { EmbedFrame } from "./islands/embed-frame";
import { FiTool } from "./islands/fi-tools";
import { YouTubePlayer } from "./islands/youtube-player";
import { MediaImage } from "./media-image";

/**
 * Server-side renderer: allowlisted node → fixed React component. There is
 * no dangerouslySetInnerHTML anywhere in this tree; text is escaped by React
 * and every URL is re-validated at render time (defence in depth on top of
 * the write-time sanitizer).
 */

export type RenderContext = {
  refs: Map<string, Card>;
  media: Map<string, MediaAsset>;
};

type State = {
  ctx: RenderContext;
  headingIds: string[];
  headingCursor: number;
  /** The document's heading levels ranked by use (derive.ts), shared with the outline so the two always agree. */
  headingRank: (level: unknown) => 1 | 2 | 3;
  code: HighlightedCode[];
  codeCursor: number;
  firstImage: boolean;
};

const CALLOUTS: Record<CalloutVariant, { label: string; tone: "note" | "warn"; icon: "info" | "tip" | "warning" }> = {
  note: { label: "Note", tone: "note", icon: "info" },
  tip: { label: "Tip", tone: "note", icon: "tip" },
  warning: { label: "Warning", tone: "warn", icon: "warning" },
  important: { label: "Important", tone: "warn", icon: "warning" },
};

function renderText(node: BlockNode, key: number): React.ReactNode {
  let out: React.ReactNode = node.text ?? "";
  const marks: Mark[] = node.marks ?? [];
  for (const mark of [...marks].reverse()) {
    switch (mark.type) {
      case "code":
        out = <code key={key}>{out}</code>;
        break;
      case "bold":
        out = <strong key={key}>{out}</strong>;
        break;
      case "italic":
        out = <em key={key}>{out}</em>;
        break;
      case "underline":
        out = <u key={key}>{out}</u>;
        break;
      case "strike":
        out = <s key={key}>{out}</s>;
        break;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        if (!href) break;
        out = href.startsWith("/") ? (
          <Link key={key} href={href}>
            {out}
          </Link>
        ) : (
          <a key={key} href={href} rel={href.startsWith("mailto:") ? undefined : "noopener noreferrer"}>
            {out}
          </a>
        );
        break;
      }
    }
  }
  return <Fragment key={key}>{out}</Fragment>;
}

function renderInline(nodes: BlockNode[] | undefined, state: State): React.ReactNode {
  return (nodes ?? []).map((node, i) => {
    if (node.type === "text") return renderText(node, i);
    if (node.type === "hardBreak") return <br key={i} />;
    if (node.type === "docRef") {
      const card = state.ctx.refs.get(String(node.attrs?.documentId ?? ""));
      const label = String(node.attrs?.label || card?.title || "");
      return card ? (
        <Link key={i} href={card.path} className="doc-ref font-medium" title={`${card.type.name}: ${card.title}`}>
          {label}
        </Link>
      ) : (
        <span key={i}>{label}</span>
      );
    }
    return null;
  });
}

function nodeText(node: BlockNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(nodeText).join("");
}

function renderBlocks(nodes: BlockNode[] | undefined, state: State, inToc: boolean): React.ReactNode {
  return (nodes ?? []).map((node, i) => <Fragment key={i}>{renderBlock(node, state, inToc)}</Fragment>);
}

function renderBlock(node: BlockNode, state: State, inToc: boolean): React.ReactNode {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "paragraph":
      if (!node.content?.length) return null;
      return <p>{renderInline(node.content, state)}</p>;

    case "heading":
      return renderHeading(node, state, inToc);

    case "blockquote":
      return <blockquote>{renderBlocks(node.content, state, false)}</blockquote>;

    case "callout": {
      const variant = CALLOUTS[(a.variant as CalloutVariant) ?? "note"] ?? CALLOUTS.note;
      return (
        <Callout tone={variant.tone} icon={variant.icon} label={variant.label}>
          {renderBlocks(node.content, state, false)}
        </Callout>
      );
    }

    case "bulletList":
      return <ul>{node.content?.map((li, i) => <li key={i}>{renderListItem(li, state)}</li>)}</ul>;
    case "orderedList":
      return (
        <ol start={Number(a.start ?? 1)}>
          {node.content?.map((li, i) => (
            <li key={i}>{renderListItem(li, state)}</li>
          ))}
        </ol>
      );
    case "taskList":
      return (
        <ul className="task-list">
          {node.content?.map((li, i) => {
            const checked = li.attrs?.checked === true;
            return (
              <li key={i} className="flex items-start gap-3">
                <input type="checkbox" checked={checked} disabled readOnly className="mt-[0.45em] size-4 shrink-0 accent-[var(--accent)]" aria-label={checked ? "Completed" : "Not completed"} />
                <div className={checked ? "text-muted line-through decoration-line-strong" : ""}>{renderListItem(li, state)}</div>
              </li>
            );
          })}
        </ul>
      );

    case "codeBlock": {
      const highlighted = state.code[state.codeCursor++];
      const raw = (node.content ?? []).map((t) => t.text ?? "").join("");
      return <CodeBlock label={highlighted?.label ?? null} raw={raw} lines={highlighted?.lines ?? raw.split("\n").map((l) => [{ content: l, style: {} as Record<string, string> }])} />;
    }

    case "horizontalRule":
      return <hr />;

    case "image": {
      const asset = typeof a.mediaId === "string" ? state.ctx.media.get(a.mediaId) : undefined;
      const src = asset?.url ?? safeMediaSrc(a.src);
      if (!src) return null;
      const size = a.size === "wide" ? "block-wide" : a.size === "full" ? "block-full" : "";
      const priority = state.firstImage;
      state.firstImage = false;
      const caption = String(a.caption ?? "");
      const alt = String(a.alt ?? asset?.alt ?? "");
      return (
        <figure className={size}>
          {asset ? (
            <MediaImage asset={asset} alt={alt} priority={priority} sizes={size === "block-full" ? "100vw" : size === "block-wide" ? "(min-width: 1024px) 928px, 100vw" : "(min-width: 768px) 640px, 100vw"} className="rounded-md" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- validated media URL without variants
            <img src={src} alt={alt} loading="lazy" decoding="async" width={Number(a.width) || undefined} height={Number(a.height) || undefined} className="h-auto w-full rounded-md" />
          )}
          {caption && <figcaption>{caption}</figcaption>}
        </figure>
      );
    }

    case "gallery": {
      const images = (a.images as Array<{ mediaId: string | null; src: string; alt: string; caption: string; width: number | null; height: number | null }>) ?? [];
      const cols = Number(a.columns ?? 3);
      return (
        <figure className="block-wide">
          <div className={`grid gap-3 ${cols === 2 ? "sm:grid-cols-2" : cols === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}>
            {images.map((img, i) => {
              const asset = img.mediaId ? state.ctx.media.get(img.mediaId) : undefined;
              const src = asset?.url ?? safeMediaSrc(img.src);
              if (!src) return null;
              return (
                <div key={i} className="relative aspect-square overflow-hidden rounded-sm bg-surface-2">
                  {asset ? (
                    <MediaImage asset={asset} alt={img.alt} fill sizes="(min-width: 768px) 300px, 50vw" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- validated media URL without variants
                    <img src={src} alt={img.alt} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
                  )}
                </div>
              );
            })}
          </div>
          {a.caption ? <figcaption>{String(a.caption)}</figcaption> : null}
        </figure>
      );
    }

    case "youtube":
      return (
        <figure className="block-wide not-prose">
          <YouTubePlayer videoId={String(a.videoId)} start={Number(a.start ?? 0)} title={String(a.title ?? "")} />
          {a.caption ? <figcaption className="mt-2 text-center text-sm text-subtle">{String(a.caption)}</figcaption> : null}
        </figure>
      );

    case "embed":
      return (
        <figure className="block-wide not-prose">
          <EmbedFrame provider={a.provider as "vimeo"} embedId={String(a.embedId)} title={String(a.title ?? "")} />
          {a.caption ? <figcaption className="mt-2 text-center text-sm text-subtle">{String(a.caption)}</figcaption> : null}
        </figure>
      );

    case "audio": {
      const asset = typeof a.mediaId === "string" ? state.ctx.media.get(a.mediaId) : undefined;
      const src = asset?.url ?? safeMediaSrc(a.src);
      if (!src) return null;
      return (
        <figure className="not-prose rounded-md border border-line bg-surface p-4">
          {a.title ? <p className="mb-2 font-medium">{String(a.title)}</p> : null}
          <audio controls preload="none" src={src} className="w-full">
            <a href={src}>Download audio</a>
          </audio>
          {a.caption ? <figcaption className="mt-2 text-sm text-subtle">{String(a.caption)}</figcaption> : null}
        </figure>
      );
    }

    case "file": {
      const asset = typeof a.mediaId === "string" ? state.ctx.media.get(a.mediaId) : undefined;
      const src = asset?.url ?? safeMediaSrc(a.src);
      if (!src) return null;
      const isPdf = String(a.mimeType ?? asset?.mimeType ?? "").includes("pdf");
      const size = Number(a.size ?? asset?.sizeBytes ?? 0);
      return (
        <a href={src} className="not-prose group flex items-center gap-4 rounded-md border border-line bg-surface p-4 no-underline transition-colors hover:border-accent" rel="noopener">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-muted group-hover:text-accent">
            <FileDown size={20} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-sans font-medium">{String(a.name ?? "Download")}</span>
            <span className="block font-mono text-xs uppercase tracking-wider text-subtle">
              {isPdf ? "PDF" : "File"}
              {size ? ` · ${formatBytes(size)}` : ""}
            </span>
          </span>
        </a>
      );
    }

    case "bookmark": {
      const url = safeExternalUrl(a.url);
      if (!url) return null;
      return (
        <a href={url} rel="noopener noreferrer" className="not-prose group block rounded-md border border-line bg-surface p-4 no-underline transition-colors hover:border-accent sm:p-5">
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-subtle">
            <LinkIcon size={12} aria-hidden="true" /> {String(a.siteName || hostnameOf(url))}
          </span>
          <span className="mt-1.5 block font-sans font-semibold leading-snug text-ink group-hover:text-accent">{String(a.title || url)}</span>
          {a.description ? <span className="mt-1 line-clamp-2 block font-sans text-sm text-muted">{String(a.description)}</span> : null}
        </a>
      );
    }

    case "columns": {
      const cols = node.content ?? [];
      return (
        <div className="columns-block block-wide" data-cols={cols.length} data-layout={String(a.layout ?? "equal")}>
          {cols.map((col, i) => (
            <div key={i}>{renderBlocks(col.content, state, inToc)}</div>
          ))}
        </div>
      );
    }

    case "details": {
      const summary = node.content?.find((c) => c.type === "detailsSummary");
      const body = node.content?.find((c) => c.type === "detailsContent");
      return (
        <details>
          <summary>{renderInline(summary?.content, state) || "Details"}</summary>
          <div>{renderBlocks(body?.content, state, false)}</div>
        </details>
      );
    }

    case "table": {
      const rows = node.content ?? [];
      const headerRow = rows[0]?.content?.every((c) => c.type === "tableHeader") ? rows[0] : null;
      const bodyRows = headerRow ? rows.slice(1) : rows;
      const cell = (c: BlockNode, i: number, header: boolean) => {
        const props = { colSpan: Number(c.attrs?.colspan ?? 1) > 1 ? Number(c.attrs?.colspan) : undefined, rowSpan: Number(c.attrs?.rowspan ?? 1) > 1 ? Number(c.attrs?.rowspan) : undefined };
        const content = renderBlocks(c.content, state, false);
        return header || c.type === "tableHeader" ? (
          <th key={i} scope={header ? "col" : "row"} {...props}>
            {content}
          </th>
        ) : (
          <td key={i} {...props}>
            {content}
          </td>
        );
      };
      return (
        <div className="table-wrap block-wide" role="region" aria-label="Table" tabIndex={0}>
          <table>
            {headerRow && (
              <thead>
                <tr>{headerRow.content?.map((c, i) => cell(c, i, true))}</tr>
              </thead>
            )}
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri}>{row.content?.map((c, i) => cell(c, i, false))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "button": {
      const href = safeHref(a.href);
      if (!href) return null;
      const cls = a.variant === "secondary" ? "btn btn-ghost" : "btn btn-accent";
      return (
        <p className="not-prose">
          {href.startsWith("/") ? (
            <Link href={href} className={cls}>
              {String(a.label)}
            </Link>
          ) : (
            <a href={href} className={cls} rel="noopener noreferrer">
              {String(a.label)}
            </a>
          )}
        </p>
      );
    }

    case "relatedContent": {
      const cards = ((a.documentIds as string[]) ?? []).map((id) => state.ctx.refs.get(id)).filter((c): c is Card => Boolean(c));
      if (!cards.length) return null;
      return (
        <aside className="not-prose rounded-md border border-line bg-surface px-5 py-3 font-sans" aria-label={String(a.title || "Related")}>
          <p className="eyebrow pt-2">{String(a.title || "Related")}</p>
          <div className="divide-y divide-line">
            {cards.map((card) => (
              <CardLink key={card.id} card={card} />
            ))}
          </div>
        </aside>
      );
    }

    case "tool":
      return <FiTool kind={a.kind as ToolKind} />;

    default:
      return null;
  }
}

function renderHeading(node: BlockNode, state: State, inToc: boolean, text?: string): React.ReactNode {
  const level = state.headingRank(node.attrs?.level);
  const Tag = (level === 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
  const plain = nodeText(node).trim();
  if (!plain) return null;
  // The id is taken even when the title is shown without its "Exercise 1:" prefix, so ids stay in step with the outline.
  const id = inToc ? state.headingIds[state.headingCursor++] : undefined;
  const content = text ?? renderInline(node.content, state);
  if (!id) return <Tag>{content}</Tag>;
  // The permalink is a sibling of the heading, not a child, so the heading's
  // accessible name (what screen-reader heading lists announce) is just its text.
  return (
    <div className="heading-block" data-level={Tag}>
      <Tag id={id}>{content}</Tag>{" "}
      <a href={`#${id}`} className="heading-anchor" aria-label={`Link to section: ${plain}`}>
        #
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exercises: under a heading such as "Exercises", each task and the solution
// that follows it become one card; the solution opens inside the card.
// ---------------------------------------------------------------------------

const EXERCISES_HEADING = /^(?:exercises?|practice(?: exercises| problems)?|check yourself|try it yourself)\b/i;
const SOLUTION_SUMMARY = /^(?:show |view )?(?:the )?(?:worked )?(?:solution|answer)s?\b/i;
const EXERCISE_PREFIX = /^(exercise|problem|task|question)\s*(\d+)\s*[:.)–—-]?\s*/i;

function renderSolution(node: BlockNode, state: State): React.ReactNode {
  const summary = node.content?.find((c) => c.type === "detailsSummary");
  const body = node.content?.find((c) => c.type === "detailsContent");
  const named = SOLUTION_SUMMARY.test(nodeText(summary ?? { type: "detailsSummary" }).trim());
  return (
    <details>
      <summary>
        {named ? (
          <>
            <span className="solution-show">Show solution</span>
            <span className="solution-hide">Hide solution</span>
          </>
        ) : (
          renderInline(summary?.content, state) || "Show solution"
        )}
      </summary>
      <div>{renderBlocks(body?.content, state, false)}</div>
    </details>
  );
}

function renderExercises(section: BlockNode[], state: State): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let buffer: BlockNode[] = [];
  let counter = 0;
  const key = () => `ex-${out.length}`;
  for (const node of section) {
    if (node.type !== "details") {
      buffer.push(node);
      continue;
    }
    counter += 1;
    const [first, ...rest] = buffer;
    // A task that names itself ("Exercise 2: Group by") keeps its own name; otherwise the card is numbered here.
    const head = first?.type === "heading" && state.headingRank(first.attrs?.level) === 2 ? first : null;
    const named = head ? nodeText(head).trim().match(EXERCISE_PREFIX) : null;
    const selfNumbered = !head && first?.type === "paragraph" && EXERCISE_PREFIX.test(nodeText(first).trim());
    out.push(
      <div key={key()} className="exercise">
        {!selfNumbered && <p className="exercise-label">{named ? `${named[1]!.replace(/^./, (c) => c.toUpperCase())} ${named[2]}` : `Exercise ${counter}`}</p>}
        {head ? renderHeading(head, state, true, named ? nodeText(head).trim().replace(EXERCISE_PREFIX, "") || undefined : undefined) : first ? renderBlock(first, state, true) : null}
        {rest.map((n, i) => (
          <Fragment key={i}>{renderBlock(n, state, true)}</Fragment>
        ))}
        {renderSolution(node, state)}
      </div>,
    );
    buffer = [];
  }
  // Blocks after the last solution are not a task of their own.
  for (const node of buffer) out.push(<Fragment key={key()}>{renderBlock(node, state, true)}</Fragment>);
  return out;
}

/** The document's top level: every block in order, with an "Exercises" section set as cards. */
function renderTopLevel(nodes: BlockNode[], state: State): React.ReactNode {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i]!;
    out.push(<Fragment key={`b-${i}`}>{renderBlock(node, state, true)}</Fragment>);
    i += 1;
    if (node.type === "heading" && state.headingRank(node.attrs?.level) === 1 && EXERCISES_HEADING.test(nodeText(node).trim())) {
      let end = i;
      while (end < nodes.length && !(nodes[end]!.type === "heading" && state.headingRank(nodes[end]!.attrs?.level) === 1)) end += 1;
      if (nodes.slice(i, end).some((n) => n.type === "details")) out.push(...renderExercises(nodes.slice(i, end), state));
      else for (const n of nodes.slice(i, end)) out.push(<Fragment key={`b-${out.length}`}>{renderBlock(n, state, true)}</Fragment>);
      i = end;
    }
  }
  return out;
}

function renderListItem(li: BlockNode, state: State): React.ReactNode {
  // A single-paragraph item renders inline (tight list); richer items keep their blocks.
  if (li.content?.length === 1 && li.content[0]!.type === "paragraph") return renderInline(li.content[0]!.content, state);
  return renderBlocks(li.content, state, false);
}

/** Pre-computes everything async (syntax highlighting) before the synchronous render. */
async function prepare(doc: Doc, ctx: RenderContext): Promise<State> {
  const codeNodes: BlockNode[] = [];
  walkDoc(doc, (node) => {
    if (node.type === "codeBlock") codeNodes.push(node);
  });
  const code = await Promise.all(codeNodes.map((n) => highlightCode((n.content ?? []).map((t) => t.text ?? "").join(""), (n.attrs?.language as string) ?? null)));
  return { ctx, headingIds: extractHeadings(doc).map((h) => h.id), headingCursor: 0, headingRank: headingRanker(doc), code, codeCursor: 0, firstImage: true };
}

export async function DocContent({ doc, context, serif = false, className = "" }: { doc: Doc; context: RenderContext; serif?: boolean; className?: string }) {
  if (!doc.content.length) return null;
  const state = await prepare(doc, context);
  // Code blocks are counted in document order (walkDoc is depth-first pre-order, like the render).
  return <div className={`prose ${serif ? "prose-serif" : ""} ${className}`}>{renderTopLevel(doc.content, state)}</div>;
}
