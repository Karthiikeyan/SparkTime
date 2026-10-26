import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { LibraryView } from "@/components/pages/library-view";
import { siteUrl } from "@/server/env";
import { pageMetadata } from "@/server/seo/metadata";
import { getLibraryListing, getLibrarySidebar, libraryQuery, parseLibraryFilter } from "@/server/services/library";
import { loadAllSettings } from "@/server/services/settings";

export type LibrarySearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /library and /library/page/{n}: one list, filtered by the query. Reading the query makes these pages dynamic. */
export function pageNumber(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  return /^[1-9]\d{0,3}$/.test(raw) ? Number(raw) : null;
}

export async function libraryMetadata(raw: string | undefined, searchParams: LibrarySearchParams): Promise<Metadata> {
  const page = pageNumber(raw);
  const filter = parseLibraryFilter(await searchParams);
  const listing = await getLibraryListing(parseLibraryFilter({}), 1);
  const filtered = libraryQuery(filter) !== "";
  const path = page && page > 1 ? `/library/page/${page}` : "/library";
  return pageMetadata({
    title: page && page > 1 ? `Library — page ${page}` : "Library",
    description: "Free courses, interview experiences and guides on technology, careers and money, in one place: filter by type or topic, or just browse the newest.",
    path,
    // A filtered view is another address for the same list: it points at the plain one and stays out of the index.
    noindex: !page || filtered || listing.counts.all === 0,
  });
}

export async function LibraryPage({ raw, searchParams }: { raw: string | undefined; searchParams: LibrarySearchParams }) {
  const page = pageNumber(raw);
  if (!page) notFound();
  const filter = parseLibraryFilter(await searchParams);
  if (raw === "1") permanentRedirect(`/library${libraryQuery(filter)}`);
  const [listing, sidebar, settings] = await Promise.all([getLibraryListing(filter, page), getLibrarySidebar(), loadAllSettings()]);
  if (page > 1 && listing.rows.length === 0) notFound();
  return <LibraryView filter={filter} listing={listing} sidebar={sidebar} page={page} siteUrl={siteUrl()} search={settings.features.search} />;
}
