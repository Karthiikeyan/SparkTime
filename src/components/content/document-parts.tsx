import { ArrowLeft, ArrowRight, ArrowUpRight, Archive, Download, ExternalLink, GitFork, Presentation, Star } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatDate, formatDateOnly } from "@/lib/dates";
import { intentLabel } from "@/lib/content/intent";
import { RELATION_KINDS, type FieldDefinition } from "@/lib/content/model";
import { labelFor, valueByRole, type Properties, type PropertyValue } from "@/lib/content/properties";
import { categoryPath, tagPath } from "@/lib/content/paths";
import type { MediaAsset } from "@/lib/media";
import { hostnameOf, safeHref } from "@/lib/url";
import type { Card, Connection, PublicDocument, SeriesPosition } from "@/server/services/public-content";
import type { Recommendation } from "@/server/services/recommendations";
import { AuthorAvatar } from "@/components/ui/author-card";
import { Breadcrumbs as UiBreadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { CardLink, Thumb } from "./cards";
import { Headline, SectionRule } from "./editorial";
import { MediaImage } from "./media-image";

export type { Crumb };

/** Breadcrumbs with the spacing the older templates expect; see components/ui/breadcrumbs.tsx. */
export function Breadcrumbs(props: { items: Crumb[]; currentLast?: boolean }) {
  return <UiBreadcrumbs {...props} className="mb-6" />;
}

/**
 * Where a piece sits for a reader — Library › its topic, or Projects for a
 * project — matching the BreadcrumbList in its structured data. The title is
 * the h1 right below; "Home" is the wordmark. Standalone pages have no trail.
 */
export function docCrumbs(doc: PublicDocument, section: { label: string; href: string } | null): Crumb[] {
  if (doc.fullType.routing !== "type") return [];
  if (doc.type.template === "project" && section) return [{ label: "Projects", href: section.href }];
  const topic = doc.categories[0];
  return [{ label: "Library", href: "/library" }, ...(topic ? [{ label: topic.name, href: categoryPath(topic.slug) }] : [])];
}

/**
 * Who wrote it, and how long it takes to read. Publication and update dates
 * are deliberately not shown: pieces are kept current rather than dated, so a
 * reader judges them by what they say. The dates stay machine-readable
 * (JSON-LD, Open Graph, sitemap, RSS) — docs/content-publishing-redesign.md §5.
 */
export function Byline({ doc, authorName }: { doc: PublicDocument; authorName: string }) {
  const reading = doc.readingMinutes > 1 && ["editorial", "minimal", "story"].includes(doc.type.template);
  return (
    <div className="flex items-center gap-3 text-sm">
      <AuthorAvatar size={40} className="size-10" />
      <div className="min-w-0">
        <p className="text-muted">
          By{" "}
          <Link href="/about" rel="author" className="font-medium text-ink hover:underline">
            {authorName}
          </Link>
        </p>
        {reading && <p className="meta">{doc.readingMinutes} min read</p>}
      </div>
    </div>
  );
}

export function ArchivedNotice() {
  return (
    <div role="status" className="mb-8 flex items-start gap-3 rounded-md border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
      <Archive size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>This is archived. It’s kept for reference and may be out of date.</p>
    </div>
  );
}

/**
 * The line above a title: the topic, and the form only when it changes what
 * the reader gets ("Project", "Talk") — an article is simply something to read.
 */
export function TypeEyebrow({ doc }: { doc: PublicDocument }) {
  const primary = doc.categories[0];
  const intent = intentLabel(doc.type);
  if (!primary && !intent) return null;
  return (
    <p className="kicker flex flex-wrap items-center gap-2">
      {intent && <span>{intent}</span>}
      {intent && primary && <span aria-hidden="true">·</span>}
      {primary && (
        <Link href={categoryPath(primary.slug)} className="hover:underline hover:underline-offset-4">
          {primary.name}
        </Link>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

/**
 * Roles rendered by templates in dedicated places, not in the facts list.
 * Every template gives each of them a home (AudienceBar, ActionLinks,
 * SourceLine, ReviewedItem, Takeaways, Sources, the player, the transcript),
 * so a value entered in the studio is never silently dropped.
 */
const SPECIAL_ROLES = new Set(["takeaways", "sources", "transcript", "prerequisites", "coverImage", "videoUrl", "primaryUrl", "repositoryUrl", "slidesUrl", "audience", "difficulty", "duration"]);

/** Roles that describe a reviewed item; ReviewedItem shows them together. */
export const REVIEW_ROLES = ["itemName", "itemAuthor", "rating", "isbn"] as const;

/** Free-form paragraphs (a hypothesis, a turning point) read badly in a grid of short facts. */
function isPassage(field: FieldDefinition): boolean {
  return field.type === "long_text" && !SPECIAL_ROLES.has(field.role ?? "");
}

function Stars({ value }: { value: number }) {
  const full = Math.round(Math.max(0, Math.min(5, value)));
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${value} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={14} className={i < full ? "fill-accent text-accent" : "text-line-strong"} aria-hidden="true" />
      ))}
      <span className="ml-1 font-mono text-xs text-subtle">{value}/5</span>
    </span>
  );
}

/** The string items of a list value (multi-select, relations); anything else is ignored. */
function stringList(value: PropertyValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function PropertyValueView({ field, value, refs, media }: { field: FieldDefinition; value: PropertyValue; refs: Map<string, Card>; media: Map<string, MediaAsset> }) {
  if (value === null || value === undefined || value === "") return null;
  switch (field.type) {
    // Rendered by the interview template itself, never as a fact.
    case "interview_guide":
      return null;
    case "number":
      return field.role === "rating" ? <Stars value={Number(value)} /> : <span className="font-mono">{String(value)}</span>;
    case "boolean":
      return <span>{value ? "Yes" : "No"}</span>;
    case "url": {
      const href = safeHref(value);
      if (!href) return null;
      return (
        <a href={href} rel="noopener noreferrer" className="link-quiet inline-flex items-center gap-1 break-all">
          {href.startsWith("/") ? href : hostnameOf(href)} <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      );
    }
    case "email":
      return <a href={`mailto:${String(value)}`} className="link-quiet">{String(value)}</a>;
    case "date":
      return <time dateTime={String(value)}>{formatDateOnly(String(value), "long")}</time>;
    case "datetime":
      return <time dateTime={String(value)}>{formatDate(String(value), "dateTime")}</time>;
    case "select":
      return <span>{labelFor(field.options.choices, String(value))}</span>;
    case "multi_select":
      return (
        <span className="flex flex-wrap gap-1.5">
          {stringList(value).map((v) => (
            <span key={v} className="rounded-xs border border-line px-1.5 py-0.5 font-mono text-[11px]">
              {labelFor(field.options.choices, v)}
            </span>
          ))}
        </span>
      );
    case "file": {
      const asset = typeof value === "string" ? media.get(value) : undefined;
      return asset ? (
        <a href={asset.url} className="link-quiet inline-flex items-center gap-1">
          <Download size={12} aria-hidden="true" /> {asset.originalName || "Download"}
        </a>
      ) : null;
    }
    case "relation": {
      const ids = Array.isArray(value) ? stringList(value) : [String(value)];
      const cards = ids.map((id) => refs.get(id)).filter((c): c is Card => Boolean(c));
      if (!cards.length) return null;
      return (
        <span className="flex flex-col gap-1">
          {cards.map((c) => (
            <Link key={c.id} href={c.path} className="link-quiet">
              {c.title}
            </Link>
          ))}
        </span>
      );
    }
    case "long_text":
      return <span className="whitespace-pre-line">{String(value)}</span>;
    case "image":
      return null;
    default:
      return <span>{String(value)}</span>;
  }
}

/** Short facts as a grid. `omitRoles`: facts the template already shows elsewhere (e.g. a talk's event line). */
export function FactsList({
  doc,
  refs,
  media,
  className,
  omitRoles = [],
}: {
  doc: PublicDocument;
  refs: Map<string, Card>;
  media: Map<string, MediaAsset>;
  className?: string;
  omitRoles?: readonly string[];
}) {
  const facts = doc.fullType.fields.filter(
    (f) => f.showInFacts && !SPECIAL_ROLES.has(f.role ?? "") && !omitRoles.includes(f.role ?? "") && !isPassage(f) && f.type !== "image" && f.type !== "interview_guide" && doc.properties[f.key] !== undefined,
  );
  const rendered = facts.map((f) => ({ field: f, node: <PropertyValueView field={f} value={doc.properties[f.key] ?? null} refs={refs} media={media} /> }));
  if (!rendered.length) return null;
  return (
    <dl className={cn("grid gap-x-6 gap-y-4 text-sm", className)}>
      {rendered.map(({ field, node }) => (
        <div key={field.key} className="min-w-0">
          <dt className="eyebrow">{field.label}</dt>
          <dd className="mt-1 text-ink">{node}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Long-text properties without a special role (a hypothesis, a result, a turning point), as readable prose. */
export function Passages({ doc, className }: { doc: PublicDocument; className?: string }) {
  const items = doc.fullType.fields.flatMap((f) => {
    const value = doc.properties[f.key];
    return f.showInFacts && isPassage(f) && typeof value === "string" && value.trim() ? [{ field: f, value }] : [];
  });
  if (!items.length) return null;
  return (
    <dl className={cn("space-y-5", className)}>
      {items.map(({ field, value }) => (
        <div key={field.key}>
          <dt className="eyebrow">{field.label}</dt>
          <dd className="mt-1.5 whitespace-pre-line text-[1.0625rem] leading-relaxed text-ink text-pretty">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function lines(value: PropertyValue | undefined): string[] {
  return typeof value === "string"
    ? value
        .split("\n")
        .map((l) => l.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean)
    : [];
}

export function Takeaways({ doc, label = "Key takeaways" }: { doc: PublicDocument; label?: string }) {
  const items = lines(valueByRole(doc.fullType.fields, doc.properties, "takeaways"));
  if (!items.length) return null;
  const field = doc.fullType.fields.find((f) => f.role === "takeaways");
  return (
    <aside aria-label={field?.label || label} className="rounded-md border border-line bg-surface p-5 sm:p-6">
      <p className="eyebrow text-accent">{field?.label || label}</p>
      <ul className="mt-3 space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-[0.975rem] leading-relaxed">
            <span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Who it's for and what it takes: audience, level, length and prerequisites on one quiet line. */
export function AudienceBar({ doc }: { doc: PublicDocument }) {
  const f = doc.fullType.fields;
  const audience = valueByRole(f, doc.properties, "audience");
  const difficultyField = f.find((x) => x.role === "difficulty");
  const difficulty = difficultyField ? doc.properties[difficultyField.key] : undefined;
  const duration = valueByRole(f, doc.properties, "duration");
  const length = typeof duration === "number" || (typeof duration === "string" && duration) ? String(duration) : "";
  const prereqs = lines(valueByRole(f, doc.properties, "prerequisites"));
  if (!audience && !difficulty && !length && !prereqs.length) return null;
  return (
    <div className="flex flex-col gap-3 border-y border-line py-4 text-sm sm:flex-row sm:flex-wrap sm:gap-x-8">
      {typeof audience === "string" && audience && (
        <p>
          <span className="eyebrow mr-2">For</span>
          {audience}
        </p>
      )}
      {typeof difficulty === "string" && difficulty && (
        <p>
          <span className="eyebrow mr-2">Level</span>
          {labelFor(difficultyField?.options.choices, difficulty)}
        </p>
      )}
      {length && (
        <p>
          <span className="eyebrow mr-2">Length</span>
          {length}
        </p>
      )}
      {prereqs.length > 0 && (
        <p>
          <span className="eyebrow mr-2">Before you start</span>
          {prereqs.join(" · ")}
        </p>
      )}
    </div>
  );
}

export function Sources({ doc }: { doc: PublicDocument }) {
  const items = lines(valueByRole(doc.fullType.fields, doc.properties, "sources"));
  if (!items.length) return null;
  return (
    <section aria-labelledby="sources-heading" className="mt-12 border-t border-line pt-6">
      <h2 id="sources-heading" className="eyebrow">
        Sources & further reading
      </h2>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted marker:text-subtle">
        {items.map((item, i) => {
          const url = item.match(/https?:\/\/\S+/)?.[0];
          const href = url ? safeHref(url) : null;
          const text = url ? item.replace(url, "").replace(/[\s—–:-]+$/, "").trim() : item;
          return (
            <li key={i}>
              {href ? (
                <a href={href} rel="noopener noreferrer" className="link-quiet break-words">
                  {text || hostnameOf(href)}
                </a>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function ActionLinks({ doc, media }: { doc: PublicDocument; media: Map<string, MediaAsset> }) {
  const f = doc.fullType.fields;
  const primaryField = f.find((x) => x.role === "primaryUrl");
  const primary = safeHref(valueByRole(f, doc.properties, "primaryUrl"));
  const repo = safeHref(valueByRole(f, doc.properties, "repositoryUrl"));
  const slidesValue = valueByRole(f, doc.properties, "slidesUrl");
  const slidesField = f.find((x) => x.role === "slidesUrl");
  const slides = slidesField?.type === "file" && typeof slidesValue === "string" ? media.get(slidesValue)?.url ?? null : safeHref(slidesValue);
  if (!primary && !repo && !slides) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {primary && (
        <a href={primary} className="btn btn-accent" rel="noopener noreferrer">
          {primaryField?.label || "Visit"} <ExternalLink size={15} aria-hidden="true" />
        </a>
      )}
      {repo && (
        <a href={repo} className="btn btn-ghost" rel="noopener noreferrer">
          <GitFork size={15} aria-hidden="true" /> Source code
        </a>
      )}
      {slides && (
        <a href={slides} className="btn btn-ghost" rel="noopener noreferrer">
          <Presentation size={15} aria-hidden="true" /> Slides
        </a>
      )}
    </div>
  );
}

/** A note's origin ("Source: boringtechnology.club ↗") — a quiet line, not a call-to-action button. */
export function SourceLine({ doc }: { doc: PublicDocument }) {
  const field = doc.fullType.fields.find((x) => x.role === "primaryUrl");
  const href = field ? safeHref(doc.properties[field.key]) : null;
  if (!field || !href) return null;
  return (
    <p className="text-sm text-muted">
      <span className="eyebrow mr-2">{field.label}</span>
      <a href={href} rel="noopener noreferrer" className="link-quiet inline-flex items-center gap-1 break-all">
        {href.startsWith("/") ? href : hostnameOf(href)} <ArrowUpRight size={12} aria-hidden="true" />
      </a>
    </p>
  );
}

/**
 * The thing being reviewed, the way a reader looks for it on a shelf: cover,
 * title, author, rating and where to get it — kept small so the review, not
 * the book's artwork, leads the page.
 */
export function ReviewedItem({ doc, media }: { doc: PublicDocument; media: Map<string, MediaAsset> }) {
  const name = propertyString(doc, "itemName");
  if (!name) return null;
  const f = doc.fullType.fields;
  const author = propertyString(doc, "itemAuthor");
  const isbn = propertyString(doc, "isbn");
  const rating = valueByRole(f, doc.properties, "rating");
  const coverId = propertyString(doc, "coverImage");
  const cover = coverId ? media.get(coverId) : undefined;
  const linkField = f.find((x) => x.role === "primaryUrl");
  const href = safeHref(valueByRole(f, doc.properties, "primaryUrl"));
  return (
    <aside aria-label={`About ${name}`} className="flex gap-5 rounded-md border border-line bg-surface p-5 sm:gap-6 sm:p-6">
      {cover && (
        <div className="w-20 shrink-0 sm:w-28">
          <MediaImage asset={cover} alt={cover.alt || `Cover of ${name}`} sizes="112px" className="rounded-xs border border-line" />
        </div>
      )}
      <div className="min-w-0">
        <p className="eyebrow">{author || isbn ? "The book" : "Reviewed"}</p>
        <p className="mt-1.5 font-serif text-2xl leading-tight text-balance">{name}</p>
        {author && <p className="mt-1 text-muted">by {author}</p>}
        {typeof rating === "number" && (
          <p className="mt-3">
            <Stars value={rating} />
          </p>
        )}
        {isbn && <p className="mt-2 font-mono text-xs text-subtle">ISBN {isbn}</p>}
        {href && (
          <a href={href} className="btn btn-ghost mt-4" rel="noopener noreferrer">
            {linkField?.label || "Get it"} <ExternalLink size={15} aria-hidden="true" />
          </a>
        )}
      </div>
    </aside>
  );
}

/** "3 of 7 in DSA, step by step" — orientation for readers who land mid-series from search. */
export function SeriesLine({ series, className }: { series: SeriesPosition | null; className?: string }) {
  if (!series) return null;
  return <PlaceLine position={series.position} total={series.total} title={series.collection.title} href={series.collection.path} className={className} />;
}

/** "2 of 5 in Journey" — where a piece sits in an ordered whole, linking to that whole. */
export function PlaceLine({ position, total, title, href, className }: { position: number; total: number; title: string; href: string; className?: string }) {
  return (
    <p className={cn("text-sm text-muted", className)}>
      <span className="font-mono text-xs text-subtle">
        {position} of {total}
      </span>{" "}
      in{" "}
      <Link href={href} className="link-quiet font-medium">
        {title}
      </Link>
    </p>
  );
}

/** Previous/next in the collection's own order, with the reader's place marked on the series ribbon. */
export function SeriesNav({ series }: { series: SeriesPosition }) {
  const { collection, position, total, previous, next } = series;
  return (
    <nav aria-label={`${collection.title}: part ${position} of ${total}`} className="border-y-2 border-rule py-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="kicker">
            Part {position} of {total}
          </p>
          <Link href={collection.path} className="t-story story-link mt-1 block">
            {collection.title}
          </Link>
        </div>
        <span className="flex flex-wrap items-end gap-[3px]" aria-hidden="true">
          {Array.from({ length: Math.min(total, 60) }, (_, i) => (
            <span key={i} className={cn("w-[3px] rounded-[1px]", i + 1 === position ? "h-4 bg-accent" : i + 1 < position ? "h-3 bg-ink/60" : "h-3 bg-line-strong")} />
          ))}
        </span>
      </div>
      <AdjacentLinks previous={previous} next={next} className="mt-5 border-t border-line pt-4" />
    </nav>
  );
}

/** "Filed under": the topics as a sentence of links, tags after them. */
export function TaxonomyChips({ doc }: { doc: PublicDocument }) {
  if (!doc.categories.length && !doc.tags.length) return null;
  const links = [
    ...doc.categories.map((c) => ({ key: c.id, label: c.name, href: categoryPath(c.slug) })),
    ...doc.tags.map((t) => ({ key: t.id, label: `#${t.name}`, href: tagPath(t.slug) })),
  ];
  return (
    <p className="text-sm text-muted">
      <span className="kicker mr-2">Filed under</span>
      {links.map((link, i) => (
        <span key={link.key}>
          {i > 0 && <span className="text-line-strong"> · </span>}
          <Link href={link.href} className="text-ink hover:underline hover:underline-offset-4">
            {link.label}
          </Link>
        </span>
      ))}
    </p>
  );
}

/** Explicit relationships, grouped by kind — the knowledge graph made readable. */
export function Connections({ outgoing, incoming, collections }: { outgoing: Connection[]; incoming: Connection[]; collections: Card[] }) {
  if (!outgoing.length && !incoming.length && !collections.length) return null;
  const groups = new Map<string, Connection[]>();
  for (const c of outgoing) {
    const label = RELATION_KINDS[c.kind].label;
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  for (const c of incoming) {
    const label = RELATION_KINDS[c.kind].inverse;
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  return (
    <section aria-labelledby="connections-heading" className="border-t border-line pt-6">
      <h2 id="connections-heading" className="text-lg font-semibold tracking-tight">
        Connected
      </h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {[...groups.entries()].map(([label, items]) => (
          <div key={label}>
            <p className="eyebrow">{label}</p>
            <div className="mt-1 divide-y divide-line">
              {items.map((c) => (
                <div key={c.card.id}>
                  <CardLink card={c.card} />
                  {c.note && <p className="-mt-1 pb-2 pl-10 text-sm italic text-muted">{c.note}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {collections.length > 0 && (
          <div>
            <p className="eyebrow">Part of</p>
            <div className="mt-1 divide-y divide-line">
              {collections.map((c) => (
                <CardLink key={c.id} card={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The page's answer to "what next?" — named for where the reader is ("Read next" in Writing), with a way back to that section. */
/**
 * Why a recommendation is here, in a reader's words — the strongest reason
 * only. The fallbacks ("Worth exploring") say nothing, so they get no label.
 */
export function reasonLabel(reasons: string[]): string | undefined {
  const [first] = reasons;
  if (!first) return undefined;
  if (first === "Connected") return "Related";
  if (first === "Same collection") return "Same reading path";
  if (first === "Same topic") return "Same topic";
  if (/shared tag/.test(first)) return "Similar";
  if (first === "More like this") return "More like this";
  return undefined;
}

export function ContinueExploring({
  items,
  heading = "Read next",
  more = { label: "The whole library", href: "/library" },
}: {
  items: Recommendation[];
  heading?: string;
  more?: { label: string; href: string };
}) {
  if (!items.length) return null;
  const visual = items.every((item) => item.image || item.videoId);
  return (
    <section aria-labelledby="continue-heading">
      <SectionRule id="continue-heading" title={heading} href={more.href} linkLabel={more.label} />
      <ul className="mt-8 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const reason = reasonLabel(item.reasons);
          return (
            <li key={item.id} className="group relative">
              {visual && (
                <Link href={item.path} tabIndex={-1} aria-hidden="true" className="block">
                  <Thumb card={item} sizes="(min-width: 1024px) 360px, (min-width: 640px) 45vw, 100vw" className="frame mb-4 aspect-[3/2] w-full" />
                </Link>
              )}
              <Headline card={item} />
              {reason && <p className="meta mt-2 italic">{reason}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A quiet closing band for the natural next step: an organiser on a talk, a student on a career piece. */
export function NextStep({ eyebrow, title, children, action }: { eyebrow: string; title: string; children?: React.ReactNode; action: React.ReactNode }) {
  return (
    <aside aria-label={eyebrow} className="flex flex-col gap-4 rounded-md bg-bg-tint px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <p className="mt-1 font-serif text-xl text-balance">{title}</p>
        {children}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">{action}</div>
    </aside>
  );
}

export function PrevNext({ previous, next, noun }: { previous: Card | null; next: Card | null; noun: string }) {
  if (!previous && !next) return null;
  return (
    <nav aria-label={`More ${noun}`}>
      <AdjacentLinks previous={previous} next={next} className="border-t border-line pt-6" />
    </nav>
  );
}

function AdjacentLinks({ previous, next, className }: { previous: Card | null; next: Card | null; className?: string }) {
  if (!previous && !next) return null;
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {previous ? (
        <Link href={previous.path} className="group rounded-sm py-2">
          <span className="eyebrow inline-flex items-center gap-1.5">
            <ArrowLeft size={12} aria-hidden="true" /> Previous
          </span>
          <span className="mt-1 block font-medium group-hover:text-accent">{previous.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.path} className="group rounded-sm py-2 text-right sm:col-start-2">
          <span className="eyebrow inline-flex items-center gap-1.5">
            Next <ArrowRight size={12} aria-hidden="true" />
          </span>
          <span className="mt-1 block font-medium group-hover:text-accent">{next.title}</span>
        </Link>
      )}
    </div>
  );
}

export function propertyString(doc: PublicDocument, role: string): string | null {
  const v = valueByRole(doc.fullType.fields, doc.properties as Properties, role);
  return typeof v === "string" && v ? v : null;
}
