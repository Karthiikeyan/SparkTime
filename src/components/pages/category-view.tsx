import Link from "next/link";
import { GetNewGuides, RelatedTopics, TagsBlock } from "@/components/pages/browse-parts";
import { IndexList } from "@/components/pages/library-view";
import { DocContent } from "@/components/content/renderer";
import { JsonLd } from "@/components/seo/json-ld";
import { CourseCard } from "@/components/ui/cards";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { FilterPills } from "@/components/ui/pill";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";
import { extractReferences } from "@/lib/content/derive";
import { absoluteUrl, categoryPath } from "@/lib/content/paths";
import { splitCourseTitle } from "@/lib/courses";
import { firstSentence } from "@/lib/home";
import { breadcrumbSchema, graph, itemListSchema, webPageSchema } from "@/lib/seo/json-ld";
import { getMediaAssets } from "@/server/services/media";
import { resolveReferences, type CategoryPageData } from "@/server/services/public-content";
import { loadAllSettings } from "@/server/services/settings";

/**
 * Topic page: header with its sub-topics, the courses filed under it, then the
 * latest pieces with a sidebar. Later pages (/{topic}/page/n) keep the header
 * and show only the list, so every piece in a topic stays reachable.
 */
export async function CategoryView({ data, siteUrl }: { data: CategoryPageData; siteUrl: string }) {
  const { category, trail, page } = data;
  const firstPage = page === 1;
  const basePath = categoryPath(category.slug);
  const url = absoluteUrl(siteUrl, firstPage ? basePath : `${basePath}/page/${page}`);
  const pages = Math.max(1, Math.ceil(data.total / data.perPage));
  const intro = firstPage ? category.intro : null;
  const [introRefs, introMedia, settings] = await Promise.all([intro ? resolveReferences(intro) : new Map(), intro ? getMediaAssets(extractReferences(intro).mediaIds) : new Map(), loadAllSettings()]);
  const children = data.children.filter((c) => c.count > 0);
  const parent = trail.length > 1 ? trail[trail.length - 2] : null;
  const hasAside = data.relatedCategories.length > 0 || data.topTags.length > 0 || firstPage;

  // A sub-topic's pills are its siblings, so a reader can move sideways; a topic's are its children.
  const pills = children.length
    ? [{ label: "All", count: data.total, href: basePath, current: true }, ...children.map((c) => ({ label: c.name, count: c.count, href: categoryPath(c.slug), current: false }))]
    : [];

  return (
    <div className={cn(category.accent && `hue-${category.accent}`)}>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl, url, name: category.name, description: category.description, type: "CollectionPage" }),
          breadcrumbSchema([{ name: "Home", url: siteUrl }, { name: "Topics", url: absoluteUrl(siteUrl, "/topics") }, ...trail.map((c) => ({ name: c.name, url: absoluteUrl(siteUrl, categoryPath(c.slug)) }))]),
          itemListSchema(category.name, data.latest.map((c) => ({ name: c.title, url: absoluteUrl(siteUrl, c.path) }))),
        )}
      />
      <PageHeader
        breadcrumb={[{ label: "Library", href: "/library" }, { label: "Topics", href: "/topics" }, ...(parent ? [{ label: parent.name, href: categoryPath(parent.slug) }] : [])]}
        currentLast={false}
        eyebrow={`Topic · ${data.total} ${data.total === 1 ? "piece" : "pieces"}${firstPage ? "" : ` · page ${page} of ${pages}`}`}
        title={category.name}
        lede={category.description || undefined}
      >
        {pills.length > 0 && <FilterPills label={`Inside ${category.name}`} items={pills} className="mt-6 sm:mt-7" />}
      </PageHeader>

      {intro && (
        <div className="container-page mt-10 max-w-3xl">
          <DocContent doc={intro} context={{ refs: introRefs, media: introMedia }} className="[&>*]:mx-0" />
        </div>
      )}

      {firstPage && data.courses.length > 0 && (
        <section aria-labelledby="topic-courses" className="container-page pt-10 sm:pt-12">
          <SectionHeading id="topic-courses" title={`Courses in ${category.name}`} size="sm" link={{ href: "/course", label: "All courses →" }} />
          <ul className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
            {data.courses.map((c) => (
              <li key={c.id}>
                <CourseCard size="sm" course={{ path: c.path, title: splitCourseTitle(c.title).title, lessons: c.parts, minutes: c.minutes, oneLiner: firstSentence(c.excerpt) }} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="container-page flex flex-wrap items-start gap-x-12 gap-y-12 pb-20 pt-10 sm:pb-24 sm:pt-12 lg:flex-nowrap">
        <section aria-labelledby="topic-latest" className="min-w-0 flex-[1_1_40rem]">
          {data.total === 0 ? (
            <EmptyState title="Nothing published here yet">
              <p>
                This topic is waiting for its first piece. Meanwhile, <Link href="/library" className="font-semibold text-accent-ink underline underline-offset-2">browse the rest of the library</Link>.
              </p>
            </EmptyState>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink pb-3">
                <h2 id="topic-latest" className="font-serif text-[1.625rem] font-medium tracking-[-0.02em] sm:text-[2.125rem]">
                  {firstPage ? `Latest in ${category.name}` : `Earlier in ${category.name}`}
                </h2>
                {pages > 1 && (
                  <span className="text-sm text-muted">
                    Page {page} of {pages}
                  </span>
                )}
              </div>
              <IndexList items={data.latest} as="h3" showKind="special" />
              <Pagination page={page} pages={pages} href={(n) => (n === 1 ? basePath : `${basePath}/page/${n}`)} label={`${category.name} pages`} simple />
            </>
          )}
        </section>
        {hasAside && (
          <aside aria-label="Beside this topic" className="w-full space-y-7 lg:w-75 lg:shrink-0">
            <TagsBlock title="Frequent tags" tags={data.topTags} />
            <RelatedTopics topics={data.relatedCategories} />
            <GetNewGuides rss={settings.features.rss} social={settings.site.social} />
          </aside>
        )}
      </div>
    </div>
  );
}
