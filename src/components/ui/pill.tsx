import Link from "next/link";
import { cn } from "@/lib/cn";

export type PillTone = "neutral" | "accent" | "tech" | "warn" | "ink";

const TONES: Record<PillTone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
  tech: "bg-tech-tint text-tech-text",
  warn: "bg-warn-tint text-warn-text",
  ink: "bg-ink text-bg",
};

/** A small label: a content kind ("Course"), a level ("Intermediate"), a topic. Never a control. */
export function Pill({ tone = "neutral", children, className }: { tone?: PillTone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.8125rem] font-semibold leading-snug", TONES[tone], className)}>{children}</span>;
}

/** The tone a topic's pill takes: Technology is blue-grey, everything else the accent tint. */
export function topicTone(slug: string | undefined): PillTone {
  return slug === "technology" ? "tech" : "accent";
}

export type FilterItem = { label: string; href: string; count?: number | string; current?: boolean };

/**
 * A row of filters as plain links, so they work without JavaScript and every
 * view has its own URL. The active one is solid ink and carries
 * aria-current="page".
 */
export function FilterPills({ items, label, className, shape = "pill" }: { items: FilterItem[]; label: string; className?: string; shape?: "pill" | "button" }) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 border px-4 text-[0.9375rem] font-medium transition-colors",
                shape === "pill" ? "rounded-full" : "rounded-[8px]",
                item.current ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink hover:border-line-field",
              )}
            >
              {item.label}
              {item.count !== undefined && <span className={cn("text-[0.8125rem] tabular-nums", item.current ? "opacity-80" : "text-muted")}>{item.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A tag or topic as a link pill: "#java", "Software Engineering". */
export function TagLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-3.5 text-sm text-ink transition-colors hover:border-line-field">
      {children}
    </Link>
  );
}

/** A group of tag links. */
export function TagList({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {children}
    </ul>
  );
}
