import { cn } from "@/lib/cn";

export type Stat = { value: React.ReactNode; label: string };

/**
 * Serif numbers over muted labels, under a hairline. Every number is counted
 * by the caller from published content; a zero is dropped before it gets here.
 */
export function StatRow({ items, size = "md", tone = "light", className }: { items: Stat[]; size?: "sm" | "md" | "lg"; tone?: "light" | "feature"; className?: string }) {
  if (!items.length) return null;
  const number = size === "lg" ? "text-[1.875rem] sm:text-[2.375rem]" : size === "md" ? "text-[1.625rem] sm:text-[2.125rem]" : "text-[1.625rem]";
  return (
    <dl className={cn("grid grid-cols-2 border-t sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]", tone === "feature" ? "border-feature-border" : "border-line", className)}>
      {items.map((s) => (
        <div key={s.label} className="pb-1 pr-4 pt-4 sm:pt-5">
          <dd className="font-serif font-medium leading-none tabular-nums">
            <span className={number}>{s.value}</span>
          </dd>
          <dt className={cn("mt-1.5 text-[0.8125rem] sm:text-sm", tone === "feature" ? "text-feature-muted" : "text-muted")}>{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}
