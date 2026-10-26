import Link from "next/link";
import { cn } from "@/lib/cn";
import { intentLabel } from "@/lib/content/intent";
import type { Card } from "@/server/services/public-content";
import { Thumb } from "./cards";

/**
 * The editorial vocabulary shared by the Library, topics and search: a newspaper's section rules, kickers and headline hierarchy rather
 * than boxes. Server components only.
 */

type HeadingTag = "h2" | "h3";

/** "System design" or "Project · Web development": form only when it matters, then the topic. */
export function kickerText(card: Card): string | null {
  const parts = [intentLabel(card.type), card.primaryCategory?.name].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const READING_TEMPLATES = ["editorial", "minimal", "story"];
const isReading = (card: Card) => card.readingMinutes > 1 && READING_TEMPLATES.includes(card.type.template);

/**
 * Secondary facts: reading time for reading, the template's fact (event,
 * status) otherwise. Never a publication date (docs/content-publishing-redesign.md §5).
 */
export function metaText(card: Card, options: { readingTime?: boolean } = {}): string | null {
  const parts: string[] = [];
  if (card.meta) parts.push(card.meta);
  if (options.readingTime !== false && isReading(card)) parts.push(`${card.readingMinutes} min read`);
  return parts.length ? parts.join(" · ") : null;
}

export function SectionRule({ title, href, linkLabel, id, as: Tag = "h2" }: { title: string; href?: string; linkLabel?: string; id?: string; as?: HeadingTag }) {
  return (
    <div className="section-rule">
      <Tag id={id}>{title}</Tag>
      {href && (
        <Link href={href}>
          {linkLabel ?? "See all"} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}

/** A compact headline: kicker, serif title, optional one-line standfirst and thumbnail. */
export function Headline({ card, as: Tag = "h3", excerpt = true, thumb = false, className }: { card: Card; as?: HeadingTag; excerpt?: boolean; thumb?: boolean; className?: string }) {
  const kicker = kickerText(card);
  const meta = metaText(card);
  const visual = thumb && Boolean(card.image || card.videoId);
  return (
    <article className={cn("group relative", visual && "grid grid-cols-[1fr_auto] gap-4", className)}>
      <div className="min-w-0">
        {kicker && <p className="kicker">{kicker}</p>}
        <Tag className="t-story mt-1.5">
          <Link href={card.path} className="story-link after:absolute after:inset-0">
            {card.title}
          </Link>
        </Tag>
        {excerpt && card.excerpt && <p className="mt-2 line-clamp-2 text-[0.9375rem] leading-relaxed text-muted">{card.excerpt}</p>}
        {meta && <p className="meta mt-2">{meta}</p>}
      </div>
      {visual && <Thumb card={card} sizes="112px" className="frame aspect-square w-20 sm:w-28" />}
    </article>
  );
}

/** One tick per part: the length of a series is visible before it is read. */
export function PartsRibbon({ parts, className }: { parts: number; className?: string }) {
  const shown = Math.min(parts, 60);
  return (
    <span className={cn("flex flex-wrap items-end gap-[3px]", className)} aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className={cn("h-3 w-[3px] rounded-[1px]", i === 0 ? "bg-accent" : "bg-line-strong")} />
      ))}
    </span>
  );
}
