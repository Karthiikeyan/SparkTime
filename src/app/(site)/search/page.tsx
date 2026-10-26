import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Highlighted, HighlightTokens } from "@/components/search/highlight";
import { courseMeta } from "@/components/ui/cards";
import { PageHeader } from "@/components/ui/page-header";
import { FilterPills, Pill, TagLink, TagList } from "@/components/ui/pill";
import { kindLabel, kindOf, type ContentKind } from "@/lib/content/kind";
import { categoryPath } from "@/lib/content/paths";
import { pageMetadata } from "@/server/seo/metadata";
import { lessonPlacements } from "@/server/services/library";
import { cardsByIds, seriesTotals, visibleCategories } from "@/server/services/public-content";
import { searchPublic } from "@/server/services/search";
import { loadAllSettings } from "@/server/services/settings";

type Props = { searchParams: Promise<{ q?: string | string[]; type?: string | string[]; category?: string | string[]; page?: string | string[] }> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 120) ?? "";
const RESULT_LIMIT = 20;
const KINDS = [
  ["all", "All"],
  ["course", "Courses"],
  ["guide", "Guides"],
  ["interview", "Interviews"],
] as const;
const PILL_TONE: Record<ContentKind, "neutral" | "accent" | "tech"> = { guide: "neutral", course: "accent", interview: "tech", other: "neutral" };

export async function generateMetadata(): Promise<Metadata> {
  // Result pages are never indexed; the canonical is the bare search page.
  return pageMetadata({ title: "Search", description: "Search everything on the site.", path: "/search", noindex: true });
}

/** Server-rendered search: works without JavaScript; the ⌘K palette is the fast path. */
export default async function SearchPage({ searchParams }: Props) {
  const settings = await loadAllSettings();
  if (!settings.features.search) notFound();
  const params = await searchParams;
  const q = first(params.q).trim();
  const typeParam = first(params.type);
  const kind = KINDS.find(([k]) => k === typeParam)?.[0] ?? "all";
  // Older links name a content type ("article"); a kind of piece ("course") is what the page's own filters use.
  const typeSlug = kind === "all" && typeParam && typeParam !== "all" ? typeParam : "";
  const categorySlug = first(params.category);
  const rawPage = first(params.page) || "1";
  if (!/^[1-9]\d{0,3}$/.test(rawPage)) notFound();
  const page = Number(rawPage);
  const categories = await visibleCategories();
  const roots = categories.filter((c) => !c.parentId && c.count > 0);
  const category = categories.find((c) => c.slug === categorySlug);
  const matches = q
    ? await searchPublic(q, { kind: kind === "all" ? undefined : kind, typeSlug: typeSlug || undefined, categorySlug: categorySlug || undefined, limit: RESULT_LIMIT + 1, offset: (page - 1) * RESULT_LIMIT })
    : [];
  const results = matches.slice(0, RESULT_LIMIT);
  const hasMore = matches.length > RESULT_LIMIT;
  if (page > 1 && !results.length) notFound();
  const ids = results.map((r) => r.id);
  const [cardList, placements] = await Promise.all([cardsByIds(ids, "listed"), lessonPlacements(ids)]);
  const cards = new Map(cardList.map((c) => [c.id, c]));
  const totals = await seriesTotals(cardList.filter((c) => kindOf(c.type) === "course").map((c) => c.id));

  const href = (next: { kind?: string; category?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    const k = next.kind ?? kind;
    if (k && k !== "all") sp.set("type", k);
    else if (typeSlug && next.kind === undefined) sp.set("type", typeSlug);
    const c = next.category ?? categorySlug;
    if (c) sp.set("category", c);
    if (next.page && next.page > 1) sp.set("page", String(next.page));
    return `/search${sp.size ? `?${sp.toString()}` : ""}`;
  };

  return (
    <>
      <PageHeader width="narrow" title="Search" size="reading">
        <form action="/search" method="get" role="search" className="mt-5">
          <label htmlFor="search-q" className="sr-only">
            Search the library
          </label>
          <div className="flex min-h-16 items-center gap-3 rounded-xl border-[1.5px] border-accent bg-surface py-1 pl-4 pr-2 sm:pl-5">
            <Search size={20} aria-hidden="true" className="shrink-0 text-muted" />
            <input id="search-q" name="q" type="search" defaultValue={q} placeholder="Search titles, topics and full text" className="min-w-0 flex-1 bg-transparent text-[1.1875rem] outline-none placeholder:text-muted" autoComplete="off" maxLength={120} />
            {kind !== "all" && <input type="hidden" name="type" value={kind} />}
            {typeSlug && <input type="hidden" name="type" value={typeSlug} />}
            {category && <input type="hidden" name="category" value={category.slug} />}
            <button type="submit" className="inline-flex min-h-12 items-center rounded-[8px] bg-accent px-5.5 text-[0.9375rem] font-semibold text-accent-contrast hover:bg-accent-hover">
              Search
            </button>
          </div>
        </form>
        <FilterPills label="Filter results by type" className="mt-4" items={KINDS.map(([k, label]) => ({ label, href: href({ kind: k, page: 1 }), current: kind === k && !typeSlug }))} />
        {q && roots.length > 1 && (
          <nav aria-label="Narrow by topic" className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="caps mr-1 text-muted">Topic</span>
            {[{ id: "all", slug: "", name: "All" }, ...roots].map((t) => {
              const here = (category?.slug ?? "") === t.slug;
              return (
                <Link key={t.id} href={href({ category: t.slug, page: 1 })} aria-current={here ? "true" : undefined} className={here ? "inline-flex min-h-11 items-center px-2 font-semibold text-ink underline underline-offset-4" : "inline-flex min-h-11 items-center px-2 text-muted hover:text-ink"}>
                  {t.name}
                </Link>
              );
            })}
          </nav>
        )}
      </PageHeader>

      <div className="mx-auto w-full max-w-[55rem] px-4 pb-20 pt-6 sm:px-8 sm:pb-24" aria-live="polite">
        {q && results.length > 0 && (
          <>
            <p className="text-sm text-muted">
              {page === 1 && !hasMore ? `${results.length} ${results.length === 1 ? "result" : "results"}` : `Results ${(page - 1) * RESULT_LIMIT + 1}–${(page - 1) * RESULT_LIMIT + results.length}`} for <strong className="text-ink">“{q}”</strong>
              {category && ` in ${category.name}`}, best matches first
            </p>
            <ol className="mt-1">
              {results.map((r) => {
                const card = cards.get(r.id);
                const k = card ? kindOf(card.type) : "other";
                const lessons = card ? totals.get(card.id) : undefined;
                const where = placements.get(r.id) ?? [card?.primaryCategory?.name, lessons && courseMeta(lessons.parts, lessons.minutes), k === "interview" ? card?.meta : null].filter(Boolean).join(" · ");
                return (
                  <li key={r.id} className="group relative flex flex-col gap-1.5 border-b border-line py-5 sm:py-[22px]">
                    <p className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                      <Pill tone={PILL_TONE[k]}>{card ? kindLabel(card.type) : r.typeName}</Pill>
                      {where && <span className="text-muted">{where}</span>}
                    </p>
                    <h2 className="font-serif text-[1.375rem] font-medium leading-tight sm:text-[1.4375rem]">
                      <Link href={r.path} className="story-link after:absolute after:inset-0">
                        <HighlightTokens text={r.title} query={q} />
                      </Link>
                    </h2>
                    {r.snippet && (
                      <p className="line-clamp-2 text-base leading-normal text-muted">
                        <Highlighted text={r.snippet} />
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
            {(page > 1 || hasMore) && (
              <nav aria-label="Search result pages" className="mt-6 flex flex-wrap items-center gap-3">
                {page > 1 && (
                  <Link href={href({ page: page - 1 })} rel="prev" className="inline-flex min-h-12 items-center rounded-[8px] border border-line-strong bg-surface px-5 font-semibold hover:border-line-field">
                    ← Earlier results
                  </Link>
                )}
                {hasMore && (
                  <Link href={href({ page: page + 1 })} rel="next" className="inline-flex min-h-12 items-center rounded-[8px] border border-line-strong bg-surface px-5 font-semibold hover:border-line-field">
                    Show more results
                  </Link>
                )}
              </nav>
            )}
          </>
        )}

        {(!q || results.length === 0) && (
          <div className="rounded-lg border-[1.5px] border-dashed border-line-field p-6 sm:px-8 sm:py-7">
            <p className="font-serif text-[1.625rem] font-medium leading-tight">{q ? `Nothing matches “${q}” yet` : "What are you looking for?"}</p>
            <p className="mt-1.5 text-ink-2">
              {q ? "Check the spelling, try a shorter word" : "Search titles, topics and full text, or start from one of these"}
              {category && q ? (
                <>
                  , or{" "}
                  <Link href={href({ category: "", page: 1 })} className="font-semibold text-accent-ink underline underline-offset-2">
                    search every topic
                  </Link>
                </>
              ) : null}
              {q ? ", or start from one of these:" : ":"}
            </p>
            <TagList className="mt-3.5" label="Popular searches">
              {settings.home.hero.popular.map((p) => (
                <li key={p.label}>
                  <TagLink href={`/search?q=${encodeURIComponent(p.query)}`}>{p.label}</TagLink>
                </li>
              ))}
            </TagList>
            {roots.length > 0 && (
              <p className="mt-5 text-[0.9375rem] text-muted">
                Or browse by topic:{" "}
                {roots.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 && " · "}
                    <Link href={categoryPath(t.slug)} className="font-semibold text-accent-ink hover:underline">
                      {t.name}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
