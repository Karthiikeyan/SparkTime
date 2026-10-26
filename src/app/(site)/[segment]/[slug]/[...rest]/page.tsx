import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { CategoryView } from "@/components/pages/category-view";
import { TypeIndexView } from "@/components/pages/type-index-view";
import { categoryPath, parsePageNumber, typeIndexPath } from "@/lib/content/paths";
import { taxonomyRobots } from "@/lib/seo/robots";
import { siteUrl } from "@/server/env";
import { pageMetadata, topicDescription } from "@/server/seo/metadata";
import { findRolePage } from "@/server/services/interviews";
import { getCategoryPageData, getTypeIndexData, visibleCategories } from "@/server/services/public-content";
import { resolveRedirect } from "@/server/services/redirects";
import { getSiteSections } from "@/server/services/sections";
import { resolveSegment } from "@/server/services/segment";

/**
 * Deeper paths: /{type}/page/{n} and /{topic}/page/{n} pagination, the
 * earlier address of an interview role (/interviews/{company}/{role}, now
 * redirected to the role's page), legacy URLs covered by redirect rules,
 * otherwise a real 404.
 */
export const revalidate = 3600;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ segment: string; slug: string; rest: string[] }> };

async function pageNumber(params: Props["params"]) {
  const { segment, slug, rest } = await params;
  const page = slug === "page" && rest.length === 1 ? parsePageNumber(rest[0]) : null;
  if (!page) return null;
  const target = await resolveSegment(segment);
  // The interview index lists every round on one page, so it has no /page/{n}.
  if (target.kind === "type" && target.type.template !== "interview") return { kind: "type" as const, type: target.type, page };
  if (target.kind === "category") return { kind: "category" as const, category: target.category, page };
  return null;
}

/** /interviews/{company}/{role}: where a role's page used to be built; it now has its own page. */
async function rolePage({ segment, slug, rest }: { segment: string; slug: string; rest: string[] }) {
  if (rest.length !== 1) return null;
  const target = await resolveSegment(segment);
  return target.kind === "type" && target.type.template === "interview" ? findRolePage(target.type, slug, rest[0]!) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const paged = await pageNumber(params);
  if (!paged) return { title: "Not found", robots: { index: false } };
  if (paged.kind === "category") {
    const count = (await visibleCategories()).find((c) => c.id === paged.category.id)?.count ?? 0;
    return pageMetadata({
      title: `${paged.category.seoTitle || paged.category.name} — page ${paged.page}`,
      description: await topicDescription(paged.category, count),
      path: `${categoryPath(paged.category.slug)}/page/${paged.page}`,
      noindex: !taxonomyRobots(paged.category.robotsIndex, count, 1).index,
    });
  }
  // Same robots rule as the listing's first page: a non-indexable type stays out on every page.
  return pageMetadata({ title: `${paged.type.pluralName} — page ${paged.page}`, description: paged.type.description, path: `${typeIndexPath(paged.type)}/page/${paged.page}`, noindex: !paged.type.indexable });
}

export default async function DeepPage({ params }: Props) {
  const paged = await pageNumber(params);
  if (paged?.kind === "category") {
    const data = await getCategoryPageData(paged.category, paged.page);
    if (!data.latest.length) notFound();
    return <CategoryView data={data} siteUrl={siteUrl()} />;
  }
  if (paged) {
    const [data, sections] = await Promise.all([getTypeIndexData(paged.type, paged.page), getSiteSections()]);
    if (!data.items.length) notFound();
    return <TypeIndexView type={paged.type} items={data.items} total={data.total} page={paged.page} perPage={data.perPage} siteUrl={siteUrl()} section={sections.sectionOfType(paged.type.id)} />;
  }
  const { segment, slug, rest } = await params;
  const role = await rolePage({ segment, slug, rest });
  if (role) permanentRedirect(role.path);
  const found = await resolveRedirect(`/${[segment, slug, ...rest].map(encodeURIComponent).join("/")}`);
  if (found) (found.permanent ? permanentRedirect : redirect)(found.location);
  notFound();
}
