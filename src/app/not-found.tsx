import { Search } from "lucide-react";
import Link from "next/link";
import { loadAllSettings } from "@/server/services/settings";

/** A 404 must render even when the database is unreachable — fall back to showing search. */
async function searchEnabled(): Promise<boolean> {
  try {
    return (await loadAllSettings()).features.search;
  } catch {
    return true;
  }
}

const WAYS = [
  { label: "Home", href: "/" },
  { label: "Courses", href: "/course" },
  { label: "Interviews", href: "/interviews" },
  { label: "Library", href: "/library" },
];

export default async function NotFound() {
  const search = await searchEnabled();
  return (
    <section className="mx-auto w-full max-w-[45rem] px-4 py-16 text-center sm:px-8 sm:py-24">
      <p aria-hidden="true" className="font-serif text-[5.5rem] font-medium leading-none tracking-[-0.04em] text-line-strong sm:text-[7.5rem]">
        404
      </p>
      <h1 className="mt-4 font-serif text-[2.25rem] font-medium leading-[1.1] tracking-[-0.02em] sm:text-[2.75rem]">This page isn’t on the shelf</h1>
      <p className="mx-auto mt-3.5 max-w-130 text-lg text-ink-2">It may have moved, or the link has a typo. {search ? "Search the library, or try one of these." : "Try one of these."}</p>
      {search && (
        <form action="/search" method="get" role="search" className="mx-auto mt-8 max-w-140">
          <label htmlFor="nf-q" className="sr-only">
            Search the library
          </label>
          <div className="flex min-h-14 items-center gap-3 rounded-xl border border-line-field bg-surface py-1 pl-4 pr-2 text-left focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent sm:pl-[18px]">
            <Search size={18} aria-hidden="true" className="shrink-0 text-muted" />
            <input id="nf-q" name="q" type="search" maxLength={120} placeholder="Search guides, courses, companies" className="min-w-0 flex-1 bg-transparent text-[1.0625rem] outline-none placeholder:text-muted" />
            <button type="submit" className="inline-flex min-h-11 items-center rounded-[8px] bg-accent px-4.5 text-[0.9375rem] font-semibold text-accent-contrast hover:bg-accent-hover">
              Search
            </button>
          </div>
        </form>
      )}
      <ul className="mt-7 flex flex-wrap justify-center gap-2.5">
        {WAYS.map((w) => (
          <li key={w.href}>
            <Link href={w.href} className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4.5 text-[0.9375rem] hover:border-line-field">
              {w.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
