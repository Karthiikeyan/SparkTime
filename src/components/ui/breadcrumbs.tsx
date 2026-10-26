import Link from "next/link";
import { cn } from "@/lib/cn";

export type Crumb = { label: string; href: string };

/**
 * `currentLast`: the last crumb is this page (a topic trail), not the place
 * above it (a document's section). The current page is plain text.
 */
export function Breadcrumbs({ items, currentLast = true, className }: { items: Crumb[]; currentLast?: boolean; className?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn("text-sm text-muted", className)}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {items.map((item, i) => (
          <li key={item.href + item.label} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true">/</span>}
            {currentLast && i === items.length - 1 ? (
              <span aria-current="page">{item.label}</span>
            ) : (
              <Link href={item.href} className="inline-flex min-h-8 items-center hover:text-ink hover:underline hover:underline-offset-4">
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
