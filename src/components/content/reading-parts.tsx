import Link from "next/link";
import { AuthorAvatar } from "@/components/ui/author-card";
import { Band } from "@/components/ui/band";
import { CopyButton } from "@/components/content/islands/copy-button";
import { Pill, topicTone, type PillTone } from "@/components/ui/pill";
import { SECTION_LINK } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";
import { kindLabel } from "@/lib/content/kind";
import { RELATION_KINDS } from "@/lib/content/model";
import { categoryPath } from "@/lib/content/paths";
import { labelFor, valueByRole } from "@/lib/content/properties";
import type { Connection, PublicDocument } from "@/server/services/public-content";
import type { Recommendation } from "@/server/services/recommendations";

const LEVEL_TONE: Record<string, PillTone> = { beginner: "neutral", intermediate: "warn", advanced: "warn" };

/** The difficulty field's value and its label ("intermediate" → "Intermediate"). */
function level(doc: PublicDocument): { value: string; label: string } | null {
  const field = doc.fullType.fields.find((f) => f.role === "difficulty");
  const value = field ? doc.properties[field.key] : undefined;
  return typeof value === "string" && value ? { value, label: labelFor(field?.options.choices, value) } : null;
}

export function LevelPill({ doc }: { doc: PublicDocument }) {
  const l = level(doc);
  return l ? <Pill tone={LEVEL_TONE[l.value] ?? "neutral"}>{l.label}</Pill> : null;
}

/**
 * Under the title: who wrote it, how long it takes and its topic. Never a date:
 * pieces are not dated on the site (docs/content-publishing-redesign.md). A standalone guide also shows who it is for and its level
 * here; a lesson carries those in "At a glance".
 */
export function ReadingMeta({ doc, authorName, standalone }: { doc: PublicDocument; authorName: string; standalone: boolean }) {
  const audience = valueByRole(doc.fullType.fields, doc.properties, "audience");
  const topic = doc.categories[0];
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-line pb-6 text-sm text-muted sm:mt-6 sm:gap-x-[18px] sm:pb-7">
      <Link href="/about" rel="author" className="inline-flex min-h-11 items-center gap-2.5 font-medium text-ink">
        <AuthorAvatar size={32} className="size-7 sm:size-8" />
        <span>
          <span className="sr-only">By </span>
          <span className="hidden sm:inline">By </span>
          {authorName}
        </span>
      </Link>
      {doc.readingMinutes > 0 && <span>{doc.readingMinutes} min read</span>}
      {standalone && <LevelPill doc={doc} />}
      {standalone && typeof audience === "string" && audience && <span className="hidden sm:inline">For {audience.replace(/^for\s+/i, "")}</span>}
      {!standalone && topic && (
        <Link href={categoryPath(topic.slug)} className="hidden sm:inline-flex">
          <Pill tone={topicTone(topic.slug)}>{topic.name}</Pill>
        </Link>
      )}
    </div>
  );
}

/** Who it's for, its level, what to read first. Each cell is left out when the lesson has nothing for it. */
export function AtAGlance({ doc }: { doc: PublicDocument }) {
  const fields = doc.fullType.fields;
  const audience = valueByRole(fields, doc.properties, "audience");
  const prerequisites = valueByRole(fields, doc.properties, "prerequisites");
  const l = level(doc);
  const cells: Array<{ label: string; body: React.ReactNode }> = [
    ...(typeof audience === "string" && audience.trim() ? [{ label: "For", body: <p className="whitespace-pre-line">{audience}</p> }] : []),
    ...(l ? [{ label: "Level", body: <LevelPill doc={doc} /> }] : []),
    ...(typeof prerequisites === "string" && prerequisites.trim() ? [{ label: "Before you start", body: <p className="whitespace-pre-line">{prerequisites.replace(/^\s*[-*•]\s*/gm, "")}</p> }] : []),
  ];
  if (!cells.length) return null;
  return (
    <section aria-label="At a glance" className="mt-6 grid overflow-hidden rounded-lg border border-line bg-surface sm:mt-7 sm:grid-cols-[repeat(auto-fit,minmax(11.875rem,1fr))]">
      {cells.map((cell, i) => (
        <div key={cell.label} className={cn("px-5 py-4 sm:py-[18px]", i > 0 && "border-t border-line sm:border-l sm:border-t-0")}>
          <h2 className="caps text-xs text-muted">{cell.label}</h2>
          <div className="mt-1.5 text-[0.9375rem] leading-normal">{cell.body}</div>
        </div>
      ))}
    </section>
  );
}

/** A short list of the points that matter, in a muted box. Left out when there are none. */
export function KeyTakeaways({ doc, label = "Key takeaways" }: { doc: PublicDocument; label?: string }) {
  const raw = valueByRole(doc.fullType.fields, doc.properties, "takeaways");
  const items = typeof raw === "string" ? raw.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean) : [];
  if (!items.length) return null;
  const field = doc.fullType.fields.find((f) => f.role === "takeaways");
  const name = field?.label || label;
  return (
    <section aria-label={name} className="mt-5 rounded-lg bg-surface-2 px-5 py-5 sm:px-7 sm:py-6">
      <h2 className="text-[0.9375rem] font-bold tracking-[0.01em]">{name}</h2>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[0.9375rem] leading-normal text-ink-2 marker:text-muted sm:text-base">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function LinkRows({ cards }: { cards: Array<{ id: string; path: string; title: string }> }) {
  return (
    <ul className="text-[0.9375rem]">
      {cards.map((c) => (
        <li key={c.id}>
          <Link href={c.path} className="flex min-h-11 items-center border-b border-line py-2 text-ink hover:text-accent-ink hover:underline hover:underline-offset-4">
            {c.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The first few links of a group, and the rest behind "Show all N →" (a native disclosure). */
function Collapsible({ cards, shown = 3 }: { cards: Array<{ id: string; path: string; title: string }>; shown?: number }) {
  if (cards.length <= shown) return <LinkRows cards={cards} />;
  return (
    <>
      <LinkRows cards={cards.slice(0, shown)} />
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center text-[0.9375rem] font-semibold text-accent-ink hover:underline hover:underline-offset-4 group-open:hidden [&::-webkit-details-marker]:hidden">
          Show all {cards.length} →
        </summary>
        <LinkRows cards={cards.slice(shown)} />
      </details>
    </>
  );
}

/**
 * How this page connects to others. A lesson's are its "Connected lessons";
 * other pages list "Linked from N guides" (what points here) and the
 * relations they declare, a few at a time.
 */
export function ConnectedReading({ outgoing, incoming, lesson, collections }: { outgoing: Connection[]; incoming: Connection[]; lesson: boolean; collections: Array<{ id: string; path: string; title: string }> }) {
  const groups = new Map<string, Connection[]>();
  for (const c of outgoing) groups.set(RELATION_KINDS[c.kind].label, [...(groups.get(RELATION_KINDS[c.kind].label) ?? []), c]);
  const linkedFrom = incoming.filter((c) => c.kind === "references" || c.kind === "related");
  for (const c of incoming.filter((c) => !linkedFrom.includes(c))) groups.set(RELATION_KINDS[c.kind].inverse, [...(groups.get(RELATION_KINDS[c.kind].inverse) ?? []), c]);
  if (collections.length) groups.set("Part of", collections.map((c) => ({ kind: "part_of" as const, direction: "outgoing" as const, note: "", card: c as Connection["card"] })));
  if (!groups.size && !linkedFrom.length) return null;
  return (
    <section aria-labelledby="connected-heading" className="space-y-8">
      {groups.size > 0 && (
        <div>
          <h2 id="connected-heading" className="font-serif text-[1.5rem] font-medium sm:text-[1.75rem]">
            {lesson ? "Connected lessons" : "Connected reading"}
          </h2>
          <div className="mt-3 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {[...groups.entries()].map(([label, items]) => (
              <div key={label}>
                <p className="caps mb-1 text-muted">{label}</p>
                <Collapsible cards={items.map((c) => c.card)} />
              </div>
            ))}
          </div>
        </div>
      )}
      {linkedFrom.length > 0 && (
        <div>
          <h2 id={groups.size ? undefined : "connected-heading"} className="font-serif text-[1.5rem] font-medium sm:text-[1.75rem]">
            Linked from {linkedFrom.length} {linkedFrom.length === 1 ? "guide" : "guides"}
          </h2>
          <p className="mt-1.5 text-[0.9375rem] text-muted">Other pages in the library that point here.</p>
          <div className="mt-2">
            <Collapsible cards={linkedFrom.map((c) => c.card)} />
          </div>
        </div>
      )}
    </section>
  );
}

/** "Keep reading": three pieces to go on with, in the muted band. A phone gets a plain list. */
export function KeepReading({ items, more }: { items: Recommendation[]; more: { label: string; href: string } }) {
  if (!items.length) return null;
  return (
    <Band labelledBy="keep-reading" className="mt-16 sm:mt-20">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 sm:mb-6">
        <h2 id="keep-reading" className="font-serif text-[1.625rem] font-medium tracking-[-0.02em] sm:text-4xl">
          Keep reading
        </h2>
        <Link href={more.href} className={cn(SECTION_LINK, "inline-flex")}>
          {more.label} →
        </Link>
      </div>
      <ul className="grid gap-x-5 sm:grid-cols-2 sm:gap-y-5 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className="group relative flex flex-col border-b border-line-strong py-3.5 sm:rounded-lg sm:border sm:border-line sm:bg-surface sm:p-6">
            <p className="order-2 text-[0.8125rem] text-muted sm:order-1 sm:font-semibold">{[kindLabel(item.type), item.primaryCategory?.name].filter(Boolean).join(" · ")}</p>
            <h3 className="order-1 font-serif text-[1.1875rem] font-medium leading-tight sm:order-2 sm:mt-2.5 sm:text-[1.4375rem]">
              <Link href={item.path} className="story-link after:absolute after:inset-0">
                {item.title}
              </Link>
            </h3>
            {item.excerpt && <p className="order-3 mt-2.5 hidden text-[0.9375rem] leading-normal text-ink-2 sm:block">{item.excerpt}</p>}
            {item.readingMinutes > 1 && ["editorial", "minimal"].includes(item.type.template) && (
              <p className="order-4 mt-auto hidden border-t border-line-soft pt-3 text-sm text-muted sm:mt-4 sm:block">{item.readingMinutes} min read</p>
            )}
          </li>
        ))}
      </ul>
    </Band>
  );
}

/** Copy link and share on LinkedIn, under the outline of a standalone guide. */
export function ShareBox({ url, title }: { url: string; title: string }) {
  return (
    <div className="mt-6 rounded-xl border border-line bg-surface p-[18px]">
      <p className="text-sm font-semibold">Share this guide</p>
      <div className="mt-2.5 flex gap-2">
        <CopyButton text={url} label="Copy link" copiedLabel="Link copied" className="min-h-11 flex-1 justify-center" />
        <a
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-sm border border-line-strong bg-surface px-3 font-sans text-[0.8125rem] font-medium text-ink transition-colors hover:border-line-field"
          aria-label={`Share “${title}” on LinkedIn (opens in a new tab)`}
        >
          LinkedIn
        </a>
      </div>
    </div>
  );
}
