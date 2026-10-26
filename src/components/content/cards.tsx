import { ArrowRight, ArrowUpRight, Play } from "lucide-react";
import Link from "next/link";
import { ContentIcon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { intentLabel } from "@/lib/content/intent";
import { youTubeThumbnail } from "@/lib/embeds";
import type { Card } from "@/server/services/public-content";
import { MediaImage } from "./media-image";

/** "Article / 12 Sept 2026 / 8 min read" — the type is metadata, not a place. `inline` drops the wrapper for use inside another line. */
function Meta({ card, showType = true, inline = false, label }: { card: Card; showType?: boolean; inline?: boolean; label?: string }) {
  const parts: React.ReactNode[] = [];
  if (label) parts.push(<span key="l" className="text-accent">{label}</span>);
  if (showType) {
    const intent = intentLabel(card.type);
    if (intent) parts.push(<span key="t">{intent}</span>);
  }
  if (card.meta) parts.push(<span key="m">{card.meta}</span>);
  else if (card.primaryCategory) parts.push(<span key="c">{card.primaryCategory.name}</span>);
  if (card.readingMinutes > 1 && ["editorial", "minimal"].includes(card.type.template)) parts.push(<span key="r">{card.readingMinutes} min read</span>);
  // Nothing to say leaves no empty metadata line behind.
  if (!parts.length) return null;
  const items = parts.map((part, i) => (
    <span key={i} className="inline-flex items-center gap-2">
      {i > 0 && <span aria-hidden="true" className="text-line-strong">/</span>}
      {part}
    </span>
  ));
  if (inline) return <>{items}</>;
  return <p className="eyebrow flex flex-wrap items-center gap-x-2 gap-y-1">{items}</p>;
}

export function Thumb({ card, className, sizes, priority = false }: { card: Card; className?: string; sizes: string; priority?: boolean }) {
  if (card.image) {
    return (
      <div className={cn("relative overflow-hidden rounded-sm bg-surface-2", className)}>
        <MediaImage asset={card.image} alt="" sizes={sizes} fill priority={priority} className="transition-transform duration-500 group-hover:scale-[1.02]" />
      </div>
    );
  }
  if (card.videoId) {
    return (
      <div className={cn("relative overflow-hidden rounded-sm bg-surface-2", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- external YouTube thumbnail, fixed size */}
        <img src={youTubeThumbnail(card.videoId)} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" width={480} height={360} />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
            <Play size={18} fill="currentColor" aria-hidden="true" />
          </span>
        </span>
      </div>
    );
  }
  return null;
}

/** Editorial list row — hairline separated, no boxes. `label` leads the meta line in accent: why this piece is here ("Same topic"). */
export function CardRow({ card, showType = true, note, label }: { card: Card; showType?: boolean; note?: string; label?: string }) {
  const hasThumb = Boolean(card.image || card.videoId);
  return (
    <article className="group relative grid grid-cols-[1fr_auto] gap-5 border-t border-line py-6 first:border-t-0 sm:gap-8">
      <div className="min-w-0">
        <Meta card={card} showType={showType} label={label} />
        <h3 className="mt-2 text-[1.2rem] font-semibold leading-snug tracking-[-0.015em] text-balance">
          <Link href={card.path} className="after:absolute after:inset-0 group-hover:text-accent">
            {card.title}
          </Link>
          {card.status === "archived" && <span className="ml-2 align-middle font-mono text-[10px] uppercase tracking-wider text-subtle">Archived</span>}
        </h3>
        {card.excerpt && <p className="mt-2 line-clamp-2 max-w-2xl text-[0.9688rem] leading-relaxed text-muted">{card.excerpt}</p>}
        {note && <p className="mt-2 max-w-2xl border-l-2 border-accent/60 pl-3 text-sm italic text-muted">{note}</p>}
      </div>
      {hasThumb ? (
        <Thumb card={card} sizes="160px" className="aspect-[4/3] w-28 self-start sm:w-40" />
      ) : (
        <ArrowUpRight size={18} className="mt-1 text-subtle transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" />
      )}
    </article>
  );
}

/** Grid tile for projects, media and resources. */
export function CardTile({ card }: { card: Card }) {
  // Without an image the placeholder names the type, so the line below it
  // gives topic context and reading time instead of repeating "Project · Project".
  const visual = Boolean(card.image || card.videoId);
  return (
    <article className="group relative flex flex-col">
      {visual ? (
        <Thumb card={card} sizes="(min-width: 1024px) 380px, (min-width: 640px) 45vw, 100vw" className="aspect-[16/10] w-full" />
      ) : (
        <div className="relative flex aspect-[16/10] w-full items-end overflow-hidden rounded-sm border border-line bg-surface p-5">
          <div className="absolute -right-6 -top-6 text-line-strong/60 transition-transform duration-500 group-hover:rotate-6">
            <ContentIcon name={card.type.icon} size={120} className="opacity-40" />
          </div>
          <span className="eyebrow relative">{card.type.name}</span>
        </div>
      )}
      <div className="mt-4">
        <Meta card={card} showType={visual} />
        <h3 className="mt-1.5 text-lg font-semibold leading-snug tracking-[-0.01em] text-balance">
          <Link href={card.path} className="after:absolute after:inset-0 group-hover:text-accent">
            {card.title}
          </Link>
        </h3>
        {card.excerpt && <p className="mt-1.5 line-clamp-2 text-[0.9375rem] leading-relaxed text-muted">{card.excerpt}</p>}
      </div>
    </article>
  );
}

export function CardList({ cards, showType = true }: { cards: Card[]; showType?: boolean }) {
  return (
    <div>
      {cards.map((card) => (
        <CardRow key={card.id} card={card} showType={showType} />
      ))}
    </div>
  );
}

export function CardGrid({ cards, columns = 3 }: { cards: Card[]; columns?: 2 | 3 }) {
  return (
    <div className={cn("grid gap-x-8 gap-y-12 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}>
      {cards.map((card) => (
        <CardTile key={card.id} card={card} />
      ))}
    </div>
  );
}

/** Compact link used inside connection lists and mentions. */
export function CardLink({ card, label }: { card: Card; label?: string }) {
  return (
    <Link href={card.path} className="group flex items-start gap-3 rounded-sm py-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border border-line text-subtle group-hover:border-accent group-hover:text-accent">
        <ContentIcon name={card.type.icon} size={14} />
      </span>
      <span className="min-w-0">
        {label && <span className="eyebrow block">{label}</span>}
        <span className="block font-medium leading-snug group-hover:text-accent">{card.title}</span>
        <span className="block text-sm text-subtle">{card.type.name}</span>
      </span>
    </Link>
  );
}

/** Work in progress, as a ledger: status on the left, what it is on the right. */
export function LedgerList({ cards, headingLevel = 3 }: { cards: Card[]; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul>
      {cards.map((card) => (
        <li key={card.id} className="group relative grid gap-3 border-b border-line py-8 last:border-b-0 md:grid-cols-12 md:gap-8">
          <p className="eyebrow flex items-center gap-2 md:col-span-3 md:pt-2.5">
            <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            {[card.meta, card.type.name].filter(Boolean).join(" · ")}
          </p>
          <div className="min-w-0 md:col-span-9">
            <Heading className="font-serif text-title font-normal text-balance">
              <Link href={card.path} className="after:absolute after:inset-0 group-hover:text-accent">
                {card.title}
              </Link>
            </Heading>
            {card.excerpt && <p className="mt-2 line-clamp-3 max-w-2xl text-[0.9688rem] leading-relaxed text-muted">{card.excerpt}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One piece given room: the featured story that opens a list. Text first; the image only when there is one. */
export function LeadStory({ card, label = "Featured" }: { card: Card; label?: string }) {
  const visual = Boolean(card.image || card.videoId);
  return (
    <article className="group relative grid gap-6 border-b border-line pb-10 md:grid-cols-12 md:items-center md:gap-10">
      <div className={cn("min-w-0", visual ? "md:col-span-7" : "md:col-span-10")}>
        <p className="eyebrow flex flex-wrap items-center gap-x-2">
          <span className="text-accent">{label}</span>
          <span aria-hidden="true" className="text-line-strong">/</span>
          <Meta card={card} inline />
        </p>
        <h3 className="mt-3 font-serif text-[clamp(1.6rem,1.3rem+1.2vw,2.25rem)] font-normal leading-tight tracking-[-0.02em] text-balance">
          <Link href={card.path} className="after:absolute after:inset-0 group-hover:text-accent">
            {card.title}
          </Link>
        </h3>
        {card.excerpt && <p className="mt-3 line-clamp-3 max-w-xl text-[1.0625rem] leading-relaxed text-muted">{card.excerpt}</p>}
      </div>
      {visual && <Thumb card={card} sizes="(min-width: 768px) 440px, 100vw" className="aspect-[16/10] w-full md:col-span-5" />}
    </article>
  );
}

/** A few pieces of work, each given room: what was built and why it matters, with its image when it has one. */
export function ShowcaseList({ cards, cta = "Read the story" }: { cards: Card[]; cta?: string }) {
  return (
    <ul>
      {cards.map((card) => {
        const visual = Boolean(card.image || card.videoId);
        return (
          <li key={card.id} className="group relative grid gap-6 border-b border-line py-10 last:border-b-0 md:grid-cols-12 md:items-center md:gap-10">
            <div className={cn("min-w-0", visual ? "md:col-span-7" : "md:col-span-10")}>
              <p className="eyebrow">{[card.type.name, card.meta].filter(Boolean).join(" · ")}</p>
              <h3 className="mt-3 font-serif text-[clamp(1.6rem,1.3rem+1.2vw,2.25rem)] font-normal leading-tight tracking-[-0.02em] text-balance">
                <Link href={card.path} className="after:absolute after:inset-0 group-hover:text-accent">
                  {card.title}
                </Link>
              </h3>
              {card.excerpt && <p className="mt-3 line-clamp-3 max-w-xl text-[1.0625rem] leading-relaxed text-muted">{card.excerpt}</p>}
              <p className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink group-hover:text-accent" aria-hidden="true">
                {cta} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </p>
            </div>
            {visual && <Thumb card={card} sizes="(min-width: 768px) 440px, 100vw" className="aspect-[16/10] w-full md:order-first md:col-span-5" />}
          </li>
        );
      })}
    </ul>
  );
}
