import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { OutlineEntry } from "@/lib/content/outline";

/**
 * "On this page": sections with their subsections nested, as real lists. The
 * section being read gets an accent left border and bold accent text
 * (aria-current="location", set by the ActiveSection island); without
 * JavaScript it is a plain list of links.
 */
export function Toc({ items, showLabel = false, className }: { items: OutlineEntry[]; showLabel?: boolean; className?: string }) {
  return (
    <nav aria-label="On this page" data-toc className={className}>
      {showLabel && (
        <p aria-hidden="true" className="caps mb-2.5 text-muted">
          On this page
        </p>
      )}
      <ol className="border-l border-line text-sm">
        {items.map((entry) => (
          <li key={entry.id}>
            <TocLink entry={entry} />
            {entry.children.length > 0 && (
              <ol className="pb-1">
                {entry.children.map((child) => (
                  <li key={child.id}>
                    <TocLink entry={child} sub />
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

function TocLink({ entry, sub = false }: { entry: OutlineEntry; sub?: boolean }) {
  return (
    <a
      href={`#${entry.id}`}
      className={cn(
        "-ml-px block border-l-2 border-transparent py-1.5 pr-1 leading-snug text-pretty transition-colors hover:text-ink aria-[current=location]:border-accent aria-[current=location]:font-semibold aria-[current=location]:text-accent-ink",
        sub ? "pl-7 text-[0.8125rem] text-muted" : "pl-3.5 text-ink-2 data-trail:text-ink",
      )}
    >
      {entry.text}
    </a>
  );
}

/** The sticky right rail on wide screens; scrolls on its own when taller than the screen. */
export function TocRail({ items, children, className }: { items: OutlineEntry[] | null; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("hidden rail:block", className)}>
      <div data-toc-scroll className="sticky top-24 -mx-2 max-h-[calc(100dvh-8rem)] overflow-y-auto px-2 pb-4 pt-1">
        {items && <Toc items={items} showLabel />}
        {children}
      </div>
    </div>
  );
}

/** Below the rail's width: a collapsed "On this page" that opens the same list. */
export function TocDisclosure({ items, className }: { items: OutlineEntry[]; className?: string }) {
  return (
    <details className={cn("group rounded-xl border border-line bg-surface px-4 rail:hidden", className)}>
      <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 text-[0.9375rem] font-semibold [&::-webkit-details-marker]:hidden">
        On this page
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="pb-4 pt-1">
        <Toc items={items} />
      </div>
    </details>
  );
}
