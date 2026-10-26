import Link from "next/link";
import { categoryPath } from "@/lib/content/paths";
import type { getTopicDirectory } from "@/server/services/public-content";

export type TopicEntry = Awaited<ReturnType<typeof getTopicDirectory>>[number];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One of the main topics as a column: name and count, what it covers, its sub-topics, and where to start. */
export function MainTopic({ entry }: { entry: TopicEntry }) {
  const { topic, children, picks } = entry;
  return (
    <section aria-labelledby={`t-${topic.slug}`} className="flex flex-col gap-3.5 py-8 pr-0 sm:py-8 sm:pr-7">
      <h2 id={`t-${topic.slug}`} className="flex items-baseline justify-between gap-4">
        <Link href={categoryPath(topic.slug)} className="font-serif text-[2rem] font-medium leading-tight tracking-[-0.02em] hover:text-accent-ink sm:text-[2.5rem]">
          {topic.name}
        </Link>
        <span className="text-[0.9375rem] font-normal text-muted">{topic.count}</span>
      </h2>
      {topic.description && <p className="text-[1.0625rem] text-ink-2">{topic.description}</p>}
      {children.length > 0 && (
        <ul>
          {children.map(({ topic: child }) => (
            <li key={child.id} className="border-b border-line">
              <Link href={categoryPath(child.slug)} className="flex min-h-11 items-center justify-between gap-3 py-2 hover:text-accent-ink">
                <span>{child.name}</span>
                <span className="text-sm text-muted">{child.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {picks.length > 0 && (
        <div className="mt-1.5">
          <p className="caps text-muted">Start with</p>
          <ul className="mt-1">
            {picks.map((card) => (
              <li key={card.id}>
                <Link href={card.path} className="inline-flex min-h-11 items-center font-medium text-accent-ink hover:underline">
                  {card.title} →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** A topic outside the three main ones: its name and count, a line about it, and optionally where to start. */
export function NoteCard({ entry, picks = false }: { entry: TopicEntry; picks?: boolean }) {
  const { topic, picks: starts } = entry;
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-5 transition-colors focus-within:border-line-field hover:border-line-field sm:px-6 sm:py-[22px]">
      <p className="flex items-baseline justify-between gap-4">
        <Link href={categoryPath(topic.slug)} className="font-serif text-2xl font-medium leading-tight hover:text-accent-ink">
          {topic.name}
        </Link>
        <span className="shrink-0 text-sm text-muted" aria-label={plural(topic.count, "piece")}>
          {topic.count}
        </span>
      </p>
      {topic.description && <p className="text-[0.9375rem] text-muted">{topic.description}</p>}
      {picks && starts.length > 0 && (
        <div className="mt-auto border-t border-line-soft pt-3">
          <p className="caps text-muted">Start with</p>
          <ul>
            {starts.map((card) => (
              <li key={card.id}>
                <Link href={card.path} className="flex min-h-11 items-center font-serif text-lg leading-snug hover:text-accent-ink">
                  {card.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
