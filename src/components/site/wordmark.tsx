import Link from "next/link";
import { BrandMark } from "./brand-mark";

/** The logo, the product's name in the serif, and who writes it beside it ("SparkTime by Karthikeyan A"). */
export function Wordmark({ name, byline, className = "" }: { name: string; byline?: string; className?: string }) {
  return (
    <Link href="/" className={`inline-flex min-h-11 items-center gap-2.5 text-ink hover:text-ink ${className}`}>
      <BrandMark className="h-8 shrink-0 sm:h-9" />
      <span className="inline-flex items-baseline gap-2.5">
        <span className="font-serif text-2xl font-semibold tracking-[-0.02em] sm:text-[1.75rem]">{name}</span>
        {byline && <span className="hidden text-[0.8125rem] text-muted sm:inline">{byline}</span>}
      </span>
      <span className="sr-only">, home</span>
    </Link>
  );
}
