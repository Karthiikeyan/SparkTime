import { Search } from "lucide-react";
import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { courseMeta } from "@/components/ui/cards";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { FilterPills, TagLink, TagList } from "@/components/ui/pill";
import { SECTION_LINK } from "@/components/ui/section-heading";
import { kindOf } from "@/lib/content/kind";
import { absoluteUrl, tagPath } from "@/lib/content/paths";
import { companyAccounts, companyHref } from "@/lib/interviews/directory";
import { breadcrumbSchema, graph, itemListSchema, webPageSchema } from "@/lib/seo/json-ld";
import { libraryQuery, type getLibraryListing, type getLibrarySidebar, type LibraryFilter, type LibraryKind, type LibraryRow } from "@/server/services/library";
import type { Card } from "@/server/services/public-content";

type Listing = Awaited<ReturnType<typeof getLibraryListing>>;
type Sidebar = Awaited<ReturnType<typeof getLibrarySidebar>>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a piece is, on the right of its row: reading time, lessons and hours, rounds and questions. */
export function rowMeta(card: Card, lessons?: number | null, minutes?: number | null): string | null {
  const kind = kindOf(card.type);
  if (kind === "course" && lessons) return courseMeta(lessons, minutes ?? 0);
  if (kind === "guide") return card.readingMinutes > 0 ? `${card.readingMinutes} min read` : null;
  return card.meta ?? (card.readingMinutes > 1 ? `${card.readingMinutes} min read` : null);
}

/** A flat list of pieces, newest first, in the shape every listing shares. */
export function IndexList({ items, rows, as, showKind = true }: { items?: Card[]; rows?: LibraryRow[]; as?: "h2" | "h3"; /** "special": name a piece's kind only when it is not a plain guide (a project, a course). */ showKind?: boolean | "special" }) {
  const list = rows ?? (items ?? []).map((card) => ({ card, kind: kindOf(card.type), lessons: null, minutes: null }));
  return (
    <div>
      {list.map(({ card, kind, lessons, minutes }) => (
        <ListRow key={card.id} href={card.path} type={card.type} topic={card.primaryCategory} meta={rowMeta(card, lessons, minutes)} title={card.title} excerpt={card.excerpt} as={as} showKind={showKind === "special" ? kind !== "guide" : showKind} />
      ))}
    </div>
  );
}

const KIND_LABEL: Record<LibraryKind, string> = { all: "All", guide: "Guides", course: "Courses", interview: "Interviews" };

/** One address per view: /library (or /library/page/{n}) with the filters in the query. */
function href(filter: LibraryFilter, page = 1): string {
  return `${page > 1 ? `/library/page/${page}` : "/library"}${libraryQuery(filter)}`;
}

export function LibraryView({ filter, listing, sidebar, page, siteUrl, search }: { filter: LibraryFilter; listing: Listing; sidebar: Sidebar; page: number; siteUrl: string; search: boolean }) {
  const filtered = filter.kind !== "all" || filter.topic !== null || filter.sort !== "newest";
  const typePills = (Object.keys(KIND_LABEL) as LibraryKind[])
    .filter((k) => k === "all" || listing.counts[k] > 0)
    .map((k) => ({ label: KIND_LABEL[k], count: listing.counts[k], href: href({ ...filter, kind: k }), current: filter.kind === k }));
  const topicPills = [{ label: "All topics", href: href({ ...filter, topic: null }), current: filter.topic === null }, ...listing.topicPills.map((t) => ({ label: t.name, href: href({ ...filter, topic: t.slug }), current: filter.topic === t.slug }))];
  const url = absoluteUrl(siteUrl, page > 1 ? `/library/page/${page}` : "/library");
  const interviews = sidebar.directory.slice(0, 4);
  const countLabel = filtered
    ? `${plural(listing.total, "piece")}${listing.topicName ? ` in ${listing.topicName}` : ""}${listing.pages > 1 ? ` · page ${page} of ${listing.pages}` : ""}`
    : `${plural(listing.total, "piece")}${listing.pages > 1 ? ` · page ${page}` : ""}`;

  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl, url, name: "Library", type: "CollectionPage" }),
          breadcrumbSchema([
            { name: "Home", url: siteUrl },
            { name: "Library", url: absoluteUrl(siteUrl, "/library") },
          ]),
          itemListSchema("Library", listing.rows.map((r) => ({ name: r.card.title, url: absoluteUrl(siteUrl, r.card.path) }))),
        )}
      />
      <PageHeader
        eyebrow={`The library · ${plural(listing.counts.all, "piece")}`}
        title="Everything, in one place"
        lede="Courses, interview experiences and guides on technology, careers and money. Filter, search, or just browse the newest."
      >
        {search && (
          <form role="search" action="/search" className="mt-6 max-w-160 sm:mt-7">
            <label htmlFor="lib-search" className="sr-only">
              Search the library
            </label>
            <div className="flex min-h-14 items-center gap-3 rounded-xl border border-line-field bg-surface py-1 pl-4 pr-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent sm:pl-[18px]">
              <Search size={18} aria-hidden="true" className="shrink-0 text-muted" />
              <input id="lib-search" name="q" type="search" maxLength={120} autoComplete="off" placeholder={`Search ${listing.counts.all} pieces`} className="min-w-0 flex-1 bg-transparent text-[1.0625rem] outline-none placeholder:text-muted" />
              <button type="submit" className="inline-flex min-h-11 items-center rounded-[8px] bg-accent px-4.5 text-[0.9375rem] font-semibold text-accent-contrast hover:bg-accent-hover">
                Search
              </button>
            </div>
          </form>
        )}
      </PageHeader>

      <div className="container-page flex flex-wrap items-start gap-x-12 gap-y-12 pb-20 pt-8 sm:pb-24 lg:flex-nowrap">
        <div className="min-w-0 flex-[1_1_40rem]">
          <div className="space-y-3 border-b border-line pb-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <span className="caps w-14 text-muted">Type</span>
              <FilterPills label="Filter by type" items={typePills} />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <span className="caps w-14 text-muted">Topic</span>
              <FilterPills label="Filter by topic" items={topicPills} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <p aria-live="polite">{countLabel}</p>
              <p className="flex items-center gap-1">
                <span>Sort</span>
                {([
                  ["newest", "Newest first"],
                  ["short", "Shortest read"],
                ] as const).map(([value, label]) => (
                  <Link key={value} href={href({ ...filter, sort: value })} aria-current={filter.sort === value ? "page" : undefined} className={filter.sort === value ? "inline-flex min-h-11 items-center rounded-md bg-surface-2 px-3 font-semibold text-ink" : "inline-flex min-h-11 items-center rounded-md px-3 hover:text-ink"}>
                    {label}
                  </Link>
                ))}
              </p>
            </div>
          </div>

          {listing.rows.length ? (
            <>
              <h2 className="sr-only">{filtered ? "Matching pieces" : "Newest pieces"}</h2>
              <IndexList rows={listing.rows} />
              <Pagination page={page} pages={listing.pages} href={(n) => href(filter, n)} label="Library pages" />
            </>
          ) : (
            <EmptyState title={listing.counts.all === 0 ? "The shelves are being filled" : "Nothing matches those filters"} className="mt-8">
              <p>
                {listing.counts.all === 0 ? "Guides, courses and interview experiences will appear here as they are published." : "Try another type or topic, or "}
                {listing.counts.all > 0 && (
                  <Link href="/library" className="font-semibold text-accent-ink underline underline-offset-2">
                    clear the filters
                  </Link>
                )}
                {listing.counts.all > 0 && "."}
              </p>
            </EmptyState>
          )}
        </div>

        <aside aria-label="Beside the library" className="w-full space-y-6 lg:w-80 lg:shrink-0">
          {sidebar.courses.length > 0 && (
            <section aria-labelledby="side-courses" className="rounded-lg border border-line bg-surface p-5 sm:p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="side-courses" className="text-base font-bold">
                  Free courses
                </h2>
                {sidebar.coursePath && (
                  <Link href={sidebar.coursePath} className="text-sm font-semibold text-accent-ink hover:underline">
                    All {sidebar.courses.length} →
                  </Link>
                )}
              </div>
              <ul className="mt-1">
                {sidebar.courses.map((c) => (
                  <li key={c.id} className="border-b border-line-soft last:border-b-0">
                    <Link href={c.path} className="flex justify-between gap-3 py-3 text-[0.9375rem] hover:text-accent-ink">
                      <span className="font-medium">{c.title.split(":")[0]}</span>
                      <span className="shrink-0 text-[0.8125rem] text-muted">{plural(c.parts, "lesson")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {interviews.length > 0 && sidebar.interviewPath && (
            <section aria-labelledby="side-interviews" className="rounded-lg border border-line bg-surface p-5 sm:p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="side-interviews" className="text-base font-bold">
                  Interview experiences
                </h2>
                <Link href={sidebar.interviewPath} className="text-sm font-semibold text-accent-ink hover:underline">
                  All →
                </Link>
              </div>
              <ul className="mt-1">
                {interviews.map((c) => (
                  <li key={c.slug} className="border-b border-line-soft last:border-b-0">
                    <Link href={companyHref(sidebar.interviewPath!, c)} className="flex justify-between gap-3 py-3 text-[0.9375rem] hover:text-accent-ink">
                      <span className="font-medium">{c.name}</span>
                      <span className="shrink-0 text-[0.8125rem] text-muted">{plural(companyAccounts(c), "account")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sidebar.tags.length > 0 && (
            <section aria-labelledby="side-tags">
              <h2 id="side-tags" className="caps mb-2.5 text-muted">
                Popular tags
              </h2>
              <TagList>
                {sidebar.tags.map((t) => (
                  <li key={t.id}>
                    <TagLink href={tagPath(t.slug)}>#{t.name}</TagLink>
                  </li>
                ))}
              </TagList>
            </section>
          )}
          <Link href="/topics" className={`${SECTION_LINK} inline-flex`}>
            Browse every topic →
          </Link>
        </aside>
      </div>
    </>
  );
}
