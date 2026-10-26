import Link from "next/link";
import { IndexList } from "@/components/pages/library-view";
import { JsonLd } from "@/components/seo/json-ld";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { TagLink, TagList } from "@/components/ui/pill";
import { absoluteUrl, tagPath } from "@/lib/content/paths";
import { breadcrumbSchema, graph, itemListSchema, webPageSchema } from "@/lib/seo/json-ld";
import type { Card, Tag } from "@/server/services/public-content";

export type TagPageData = { items: Card[]; total: number; page: number; perPage: number; relatedTags: Tag[] };

/** Tag page (and its /page/{n} continuations): everything with the tag, newest first, with the tags it often appears beside. */
export function TagView({ tag, data, siteUrl }: { tag: Tag; data: TagPageData; siteUrl: string }) {
  const basePath = tagPath(tag.slug);
  const url = absoluteUrl(siteUrl, data.page === 1 ? basePath : `${basePath}/page/${data.page}`);
  const pages = Math.max(1, Math.ceil(data.total / data.perPage));
  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl, url, name: `#${tag.name}`, description: tag.description, type: "CollectionPage" }),
          breadcrumbSchema([
            { name: "Home", url: siteUrl },
            { name: "Topics", url: `${siteUrl}/topics` },
            { name: `#${tag.name}`, url: absoluteUrl(siteUrl, basePath) },
          ]),
          itemListSchema(tag.name, data.items.map((c) => ({ name: c.title, url: absoluteUrl(siteUrl, c.path) }))),
        )}
      />
      <PageHeader
        // The same trail the structured data gives search engines: tags sit under Topics.
        breadcrumb={[
          { label: "Library", href: "/library" },
          { label: "Topics", href: "/topics" },
        ]}
        currentLast={false}
        eyebrow={`Tag · ${data.total} ${data.total === 1 ? "piece" : "pieces"}${data.page > 1 ? ` · page ${data.page} of ${pages}` : ""}`}
        title={`#${tag.name}`}
        lede={tag.description || undefined}
      >
        {data.relatedTags.length > 0 && (
          <div className="mt-6 sm:mt-7">
            <h2 className="caps mb-2.5 text-muted">Related tags</h2>
            <TagList>
              {data.relatedTags.map((t) => (
                <li key={t.id}>
                  <TagLink href={tagPath(t.slug)}>#{t.name}</TagLink>
                </li>
              ))}
            </TagList>
          </div>
        )}
      </PageHeader>
      <div className="container-page max-w-[62rem] pb-20 pt-8 sm:pb-24 sm:pt-10">
        {data.items.length ? (
          <>
            {/* Row titles are h3s; this keeps the outline h1 → h2 → h3. */}
            <h2 className="sr-only">Tagged #{tag.name}</h2>
            <IndexList items={data.items} />
          </>
        ) : (
          <EmptyState title="Nothing public with this tag yet">
            <p>
              Pieces tagged #{tag.name} will appear here once they’re published. Meanwhile, <Link href="/topics" className="font-semibold text-accent-ink underline underline-offset-2">browse every topic</Link>.
            </p>
          </EmptyState>
        )}
        <Pagination page={data.page} pages={pages} href={(n) => (n === 1 ? basePath : `${basePath}/page/${n}`)} label="Tag pages" simple />
      </div>
    </>
  );
}
