import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { outlineIds, PROGRESS_MIN_WORDS, type OutlineEntry } from "@/lib/content/outline";
import { ActiveSection } from "./islands/active-section";

/**
 * Centres the reading column under the page header and gives the outline the
 * right-hand margin. The empty first column only balances the rail, so the
 * words stay the centre of the page rather than sitting between two sidebars.
 */
const OUTLINE_GRID = "container-page xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,40rem)_minmax(0,1fr)] xl:gap-10";

/**
 * The long-form reading column every reading template shares: the progress
 * bar on long reads and, when the piece has an outline (readingOutline), an
 * "On this page" rail beside the text from xl up and a collapsed list above
 * it on narrower screens. Without an outline the template's own container is
 * used unchanged. Everything here is server-rendered; the only client code is
 * the ActiveSection island, and only on pages that have an outline.
 */
export function ReadingLayout({
  outline,
  wordCount,
  container,
  narrow = false,
  className,
  columnClassName,
  lead,
  children,
}: {
  outline: OutlineEntry[] | null;
  wordCount: number;
  /** The template's own container, used when there is no outline. */
  container: string;
  /** Keep the column at reading width below xl too (templates built on container-narrow). */
  narrow?: boolean;
  className?: string;
  columnClassName?: string;
  /** What comes before the outline on narrow screens: facts, takeaways, the reviewed book. */
  lead?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
      {wordCount >= PROGRESS_MIN_WORDS && <div className="reading-progress" aria-hidden="true" />}
      <div className={cn(outline ? OUTLINE_GRID : container, className)}>
        <div className={cn("min-w-0 xl:col-start-2", outline && narrow && "mx-auto max-w-[40rem]", columnClassName)}>
          {lead}
          {outline && <OutlineDisclosure outline={outline} />}
          {children}
        </div>
        {outline && (
          <div className="hidden xl:block">
            {/* Scrolls on its own when the outline is taller than the screen; the room around it keeps focus rings unclipped. */}
            <div data-toc-scroll className="sticky top-24 -mx-2 max-h-[calc(100dvh-8rem)] overflow-y-auto px-2 pb-4 pt-1">
              <Outline outline={outline} showLabel />
            </div>
          </div>
        )}
      </div>
      {outline && <ActiveSection ids={outlineIds(outline)} />}
    </>
  );
}

/** Below xl: one quiet line above the text that opens the same outline. */
function OutlineDisclosure({ outline }: { outline: OutlineEntry[] }) {
  return (
    <details className="group mx-auto max-w-[40rem] border-y border-line xl:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        On this page
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-subtle transition-transform group-open:rotate-180" />
      </summary>
      <div className="pb-4 pt-1">
        <Outline outline={outline} />
      </div>
    </details>
  );
}

/**
 * Sections, with their subsections nested (real nested lists, so screen
 * readers hear the structure). The section being read is marked
 * aria-current="location" by the ActiveSection island: an accent rule on the
 * list's hairline plus full-strength text, and its section stays full-strength
 * too. The visible label is hidden from assistive technology, which already
 * hears the landmark's name.
 */
function Outline({ outline, showLabel = false }: { outline: OutlineEntry[]; showLabel?: boolean }) {
  return (
    <nav aria-label="On this page" data-toc>
      {showLabel && (
        <p aria-hidden="true" className="eyebrow mb-3">
          On this page
        </p>
      )}
      <ol className="space-y-0.5 border-l border-line text-sm">
        {outline.map((entry) => (
          <li key={entry.id}>
            <OutlineLink entry={entry} />
            {entry.children.length > 0 && (
              <ol className="pb-1">
                {entry.children.map((child) => (
                  <li key={child.id}>
                    <OutlineLink entry={child} sub />
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function OutlineLink({ entry, sub = false }: { entry: OutlineEntry; sub?: boolean }) {
  return (
    <a
      href={`#${entry.id}`}
      className={cn(
        "-ml-px block border-l-2 border-transparent py-1 leading-snug text-pretty transition-colors hover:text-ink aria-[current=location]:border-accent aria-[current=location]:text-ink",
        sub ? "pl-7 text-[0.8125rem] text-subtle" : "pl-3.5 text-muted data-trail:text-ink",
      )}
    >
      {entry.text}
    </a>
  );
}
