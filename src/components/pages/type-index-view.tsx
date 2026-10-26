import Link from "next/link";
import { CardGrid, CardRow } from "@/components/content/cards";
import { Timeline } from "@/components/content/listing";
import { IndexList } from "@/components/pages/library-view";
import { JsonLd } from "@/components/seo/json-ld";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { absoluteUrl, typeIndexPath } from "@/lib/content/paths";
import { breadcrumbSchema, graph, itemListSchema, webPageSchema } from "@/lib/seo/json-ld";
import type { Card, ContentType } from "@/server/services/public-content";
import type { TypeSection } from "@/server/services/sections";
import { SectionTabs } from "./section-tabs";

/**
 * A content type's own index (/talk, /project…): a filtered view of the section
 * it belongs to, with the section's tabs and this format current. Written
 * formats list as the library does; projects, talks and resources keep the
 * grid they are looked at in.
 */
export function TypeIndexView({ type, items, total, page, perPage, siteUrl, section }: { type: ContentType; items: Card[]; total: number; page: number; perPage: number; siteUrl: string; section: TypeSection }) {
  const url = absoluteUrl(siteUrl, typeIndexPath(type));
  // Later pages are their own canonical URL (as on topic and tag pages); the breadcrumb stays the listing.
  const pageUrl = page > 1 ? `${url}/page/${page}` : url;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const path = typeIndexPath(type);
  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl, url: pageUrl, name: type.pluralName, description: type.description, type: "CollectionPage" }),
          breadcrumbSchema([
            { name: "Home", url: siteUrl },
            ...(section.href !== url ? [{ name: section.label, url: absoluteUrl(siteUrl, section.href) }] : []),
            { name: type.pluralName, url },
          ]),
          itemListSchema(type.pluralName, items.map((c) => ({ name: c.title, url: absoluteUrl(siteUrl, c.path) }))),
        )}
      />
      <PageHeader
        breadcrumb={section.href !== path ? [{ label: section.label, href: section.href }] : undefined}
        currentLast={false}
        // Plural names are section names ("Articles", "Talks", "Journey"), not countable nouns.
        eyebrow={`${section.label} · ${total} published`}
        title={type.pluralName}
        lede={type.description || undefined}
      >
        <SectionTabs tabs={section.tabs} current={path} label={`${section.label}: formats`} className="mt-8" />
      </PageHeader>
      <div className="container-page pb-20 pt-8 sm:pb-24 sm:pt-10">
        {/* Item titles are h3s; this keeps the outline h1 → h2 → h3. */}
        {items.length > 0 && <h2 className="sr-only">{type.template === "story" ? "Timeline" : "All entries"}</h2>}
        {items.length === 0 ? (
          <EmptyState title={`No ${type.pluralName.toLowerCase()} yet`}>
            <p>
              Check back soon, or <Link href="/library" className="font-semibold text-accent-ink underline underline-offset-2">browse what’s already here</Link>.
            </p>
          </EmptyState>
        ) : type.template === "story" ? (
          <div className="max-w-3xl">
            <Timeline cards={items} />
          </div>
        ) : type.template === "project" || type.template === "media" || type.template === "collection" ? (
          <CardGrid cards={items} />
        ) : type.template === "resource" ? (
          <div className="grid gap-x-10 sm:grid-cols-2">
            {items.map((c) => (
              <CardRow key={c.id} card={c} showType={false} />
            ))}
          </div>
        ) : (
          <div className="max-w-[62rem]">
            <IndexList items={items} showKind="special" />
          </div>
        )}
        <Pagination page={page} pages={pages} href={(n) => (n === 1 ? path : `${path}/page/${n}`)} label={`${type.pluralName} pages`} simple />
      </div>
    </>
  );
}
