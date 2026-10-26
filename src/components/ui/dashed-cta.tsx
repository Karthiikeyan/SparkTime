import Link from "next/link";
import { cn } from "@/lib/cn";

/** An invitation in a dashed card: "Interviewed somewhere recently? Share your experience →". */
export function DashedCta({ href, title, body, action, className, compact = false }: { href: string; title: string; body?: string; action: string; className?: string; compact?: boolean }) {
  return (
    <Link href={href} className={cn("flex flex-col justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-line-field transition-colors hover:bg-surface", compact ? "p-5 sm:p-6" : "p-6 sm:px-8 sm:py-7", className)}>
      <span className={cn("font-serif font-medium leading-tight", compact ? "text-[1.25rem] sm:text-[1.375rem]" : "text-[1.375rem] sm:text-[1.625rem]")}>{title}</span>
      {body && <span className="text-base text-ink-2">{body}</span>}
      <span className="inline-flex min-h-11 items-center font-semibold text-accent-ink">{action}</span>
    </Link>
  );
}
