import Link from "next/link";
import { cn } from "@/lib/cn";

/** A "View all →" link in the accent ink. No display class: callers set their own. */
export const SECTION_LINK = "min-h-11 items-center font-semibold text-accent-ink hover:underline hover:underline-offset-4";

/**
 * A section's serif title with an optional line beneath it and a "View all →"
 * link on the right. `size` follows the design's three steps: "lg" for a page's
 * main sections, "md" for bands and sub-sections, "sm" for a card-sized group.
 */
export function SectionHeading({
  id,
  title,
  intro,
  link,
  size = "lg",
  as: Tag = "h2",
  className,
}: {
  id?: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
  link?: { href: string; label: string } | null;
  size?: "lg" | "md" | "sm";
  as?: "h2" | "h3";
  className?: string;
}) {
  const sizes = { lg: "text-[1.875rem] sm:text-[2.5rem]", md: "text-[1.75rem] sm:text-[2.25rem]", sm: "text-[1.5rem] sm:text-[1.75rem]" };
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 sm:mb-8", className)}>
      <div className="min-w-0">
        <Tag id={id} className={cn("font-serif font-medium leading-[1.1] tracking-[-0.02em] text-balance", sizes[size])}>
          {title}
        </Tag>
        {intro && <p className="mt-2 max-w-[39rem] text-[0.9375rem] text-muted sm:text-[1.0625rem]">{intro}</p>}
      </div>
      {link && (
        <Link href={link.href} className={cn(SECTION_LINK, "inline-flex")}>
          {link.label}
        </Link>
      )}
    </div>
  );
}
