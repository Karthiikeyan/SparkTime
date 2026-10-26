import Link from "next/link";
import { cn } from "@/lib/cn";
import { kindLabel, kindOf, type ContentKind, type KindableType } from "@/lib/content/kind";
import { Pill, type PillTone } from "./pill";

const KIND_TONE: Record<ContentKind, PillTone> = { guide: "neutral", course: "accent", interview: "tech", other: "neutral" };

/**
 * One piece in a list: a type pill with its topic, what it is (read time,
 * lessons, rounds) on the right, then the serif title and its excerpt. The
 * whole row is one link, from the title.
 */
export function ListRow({
  href,
  type,
  topic,
  meta,
  title,
  excerpt,
  as: Tag = "h3",
  showKind = true,
  className,
}: {
  href: string;
  type: KindableType;
  topic?: { name: string; slug?: string } | null;
  meta?: string | null;
  title: string;
  excerpt?: string;
  as?: "h2" | "h3";
  showKind?: boolean;
  className?: string;
}) {
  const kind = kindOf(type);
  return (
    <article className={cn("group relative grid gap-x-8 gap-y-1.5 border-b border-line py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:py-6", className)}>
      <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] sm:col-start-1 sm:row-start-1">
        {showKind && <Pill tone={KIND_TONE[kind]}>{kindLabel(type)}</Pill>}
        {topic && <span className="text-muted">{topic.name}</span>}
      </p>
      {meta && <p className="text-sm text-muted sm:col-start-2 sm:row-start-1 sm:whitespace-nowrap sm:text-right">{meta}</p>}
      <Tag className="font-serif text-[1.375rem] font-medium leading-tight text-balance sm:col-span-2 sm:text-2xl">
        <Link href={href} className="story-link after:absolute after:inset-0">
          {title}
        </Link>
      </Tag>
      {excerpt && <p className="line-clamp-2 text-base leading-normal text-muted sm:col-span-2">{excerpt}</p>}
    </article>
  );
}
