import { cn } from "@/lib/cn";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";

/**
 * The header every page opens with: breadcrumb → eyebrow → H1 → lede → meta
 * row, closed by a hairline. `size` picks the H1: "index" (60px) for listings
 * and site pages, "reading" (52px) for a lesson or guide. `width` is the
 * container: the page's, or a narrower one (search, Now).
 */
export function PageHeader({
  breadcrumb,
  currentLast,
  eyebrow,
  title,
  lede,
  meta,
  size = "index",
  width = "page",
  leading,
  className,
  children,
}: {
  breadcrumb?: Crumb[];
  currentLast?: boolean;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  /** The row under the lede: counts, an author, dates. */
  meta?: React.ReactNode;
  size?: "index" | "reading";
  width?: "page" | "narrow";
  /** Sits before the eyebrow and title: a tile, a photo. */
  leading?: React.ReactNode;
  className?: string;
  /** Filters, a search box, a stat row: whatever belongs inside the header, under the meta row. */
  children?: React.ReactNode;
}) {
  return (
    <header className={cn("border-b border-line", className)}>
      <div className={cn(width === "narrow" ? "mx-auto w-full max-w-[55rem] px-4 sm:px-8" : "container-page", "pb-8 pt-8 sm:pb-12 sm:pt-12 lg:pt-14")}>
        {breadcrumb && breadcrumb.length > 0 && <Breadcrumbs items={breadcrumb} currentLast={currentLast} className="mb-5 sm:mb-7" />}
        <div className={leading ? "flex items-center gap-4 sm:gap-5" : undefined}>
          {leading}
          <div className="min-w-0">
            {eyebrow && <div className="caps text-accent-ink">{eyebrow}</div>}
            <h1 className={cn(size === "reading" ? "t-page-reading" : "t-page", eyebrow ? "mt-2.5 sm:mt-3" : undefined)}>{title}</h1>
          </div>
        </div>
        {lede && <div className="t-lede mt-4 sm:mt-5">{lede}</div>}
        {meta && <div className="mt-4 text-[0.9375rem] text-muted sm:mt-5">{meta}</div>}
        {children}
      </div>
    </header>
  );
}
