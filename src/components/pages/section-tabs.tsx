import Link from "next/link";
import { cn } from "@/lib/cn";
import type { SectionTab } from "@/server/services/sections";

/**
 * A section's formats as one row of links — "All · Articles · Guides · Notes"
 * on Writing, "About · Journey · Now · Uses" on About. A type's own index is
 * this row with its tab current, so it reads as a filtered view of the
 * section rather than a separate place. Plain links: no client JavaScript,
 * every view keeps its own URL. Hidden when there is nothing to choose between.
 */
export function SectionTabs({ tabs, current, label, className }: { tabs: SectionTab[]; current: string; label: string; className?: string }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className={cn("-mx-1 overflow-x-auto", className)}>
      <ul className="flex min-w-max items-center gap-1 border-b border-line">
        {tabs.map((tab) => {
          const here = tab.href === current;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "relative -mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-[0.9375rem] transition-colors",
                  here ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {tab.label}
                {tab.count !== undefined && <span className="font-mono text-[11px] text-subtle">{tab.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
