import Link from "next/link";
import { cn } from "@/lib/cn";

const edge = "inline-flex min-h-11 items-center rounded-[8px] border px-4 text-[0.9375rem]";

/** Page numbers around the current one, with the first and last page and an ellipsis between: 1 2 3 … 15. */
export function pageWindow(page: number, pages: number): Array<number | "gap"> {
  if (pages <= 5) return Array.from({ length: pages }, (_, i) => i + 1);
  const start = Math.min(Math.max(page - 1, 1), pages - 2);
  const middle = [start, start + 1, start + 2];
  return [...(start > 1 ? [1] : []), ...(start > 2 ? ["gap" as const] : []), ...middle, ...(start + 2 < pages - 1 ? ["gap" as const] : []), ...(start + 2 < pages ? [pages] : [])];
}

/**
 * "← Newer · 1 2 3 … 15 · Older →" as real links. `href(n)` is page n's own
 * URL, so every page can be reached and shared without JavaScript. `simple`
 * drops the numbers for "1 of 12".
 */
export function Pagination({ page, pages, href, label = "Pagination", simple = false, className }: { page: number; pages: number; href: (n: number) => string; label?: string; simple?: boolean; className?: string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={label} className={cn("mt-8 flex flex-wrap items-center justify-between gap-3 sm:mt-10", className)}>
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={cn(edge, "border-line-strong bg-surface font-semibold text-ink hover:border-line-field")}>
          ← Newer
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(edge, "border-line text-subtle opacity-70")}>
          ← Newer
        </span>
      )}
      {simple ? (
        <span className="text-[0.9375rem] text-muted">
          {page} of {pages}
        </span>
      ) : (
        <ol className="order-last flex w-full justify-center gap-1.5 text-[0.9375rem] sm:order-none sm:w-auto">
          {pageWindow(page, pages).map((n, i) =>
            n === "gap" ? (
              <li key={`gap-${i}`} aria-hidden="true" className="inline-flex min-h-11 min-w-8 items-center justify-center text-muted">
                …
              </li>
            ) : (
              <li key={n}>
                <Link
                  href={href(n)}
                  aria-current={n === page ? "page" : undefined}
                  aria-label={`Page ${n}`}
                  className={cn("inline-flex min-h-11 min-w-11 items-center justify-center rounded-[8px] px-1", n === page ? "bg-ink font-semibold text-bg" : "text-ink hover:bg-surface-2")}
                >
                  {n}
                </Link>
              </li>
            ),
          )}
        </ol>
      )}
      {page < pages ? (
        <Link href={href(page + 1)} rel="next" className={cn(edge, "border-line-strong bg-surface font-semibold text-ink hover:border-line-field")}>
          Older →
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(edge, "border-line text-subtle opacity-70")}>
          Older →
        </span>
      )}
    </nav>
  );
}
