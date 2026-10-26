import Link from "next/link";
import { CardGrid, CardList, CardRow } from "@/components/content/cards";
import type { Template } from "@/lib/content/model";
import type { Card } from "@/server/services/public-content";

export function PageIntro({ eyebrow, title, lead, children }: { eyebrow?: React.ReactNode; title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <header className="container-page pt-12 sm:pt-16">
      {eyebrow && <div className="kicker">{eyebrow}</div>}
      <h1 className="t-display mt-3 max-w-4xl">{title}</h1>
      {lead && <p className="t-deck mt-5 max-w-2xl">{lead}</p>}
      {children}
    </header>
  );
}

export function SectionHeading({ index, title, href, linkLabel = "View all" }: { index?: string; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="section-rule">
      <h2>
        {index && <span className="mr-3 font-mono font-normal text-accent-ink">{index}</span>}
        {title}
      </h2>
      {href && (
        <Link href={href}>
          {linkLabel} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}

/** `basePath` is page 1; later pages live at `{basePath}/page/{n}`. */
export function Pagination({ basePath, page, pages }: { basePath: string; page: number; pages: number }) {
  if (pages <= 1) return null;
  const pageHref = (n: number) => (n === 1 ? basePath : `${basePath}/page/${n}`);
  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-between border-t border-line pt-6 text-sm">
      {page > 1 ? (
        <Link href={pageHref(page - 1)} rel="prev" className="link-quiet">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="font-mono text-xs text-subtle">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={pageHref(page + 1)} rel="next" className="link-quiet">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="font-serif text-2xl">{title}</p>
      {children && <div className="mx-auto mt-3 max-w-md text-muted">{children}</div>}
    </div>
  );
}

/** Timeline for story-template types (e.g. the journey). */
export function Timeline({ cards }: { cards: Card[] }) {
  return (
    <ol className="relative ml-1.5 border-l border-line pl-8">
      {cards.map((card) => (
        <li key={card.id} className="relative pb-10 last:pb-0">
          <span className="absolute left-[-2.4rem] top-1.5 size-3 rounded-full border-2 border-accent bg-bg" aria-hidden="true" />
          {card.meta && <p className="font-mono text-xs tracking-wide text-accent">{card.meta}</p>}
          <h3 className="mt-1 font-serif text-2xl">
            <Link href={card.path} className="hover:text-accent">
              {card.title}
            </Link>
          </h3>
          {card.excerpt && <p className="mt-1.5 max-w-2xl text-muted">{card.excerpt}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Index layout chosen by template: timelines for stories, grids for visual work, lists for writing. */
export function TemplateListing({ template, cards }: { template: Template; cards: Card[] }) {
  if (template === "project" || template === "media" || template === "collection") return <CardGrid cards={cards} />;
  if (template === "resource")
    return (
      <div className="grid gap-x-10 sm:grid-cols-2">
        {cards.map((c) => (
          <CardRow key={c.id} card={c} showType={false} />
        ))}
      </div>
    );
  return <CardList cards={cards} showType={false} />;
}
