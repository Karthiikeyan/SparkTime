import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { CategoryView } from "@/components/pages/category-view";
import { InterviewIndexView } from "@/components/pages/interview-index-view";
import { TypeIndexView } from "@/components/pages/type-index-view";
import { DocumentView } from "@/components/templates/document-view";
import { categoryPath, typeIndexPath } from "@/lib/content/paths";
import { taxonomyRobots } from "@/lib/seo/robots";
import { siteUrl } from "@/server/env";
import { documentMetadata, pageMetadata, topicDescription } from "@/server/seo/metadata";
import { loadDocumentPage } from "@/server/services/document-page";
import { getInterviewDirectory } from "@/server/services/interviews";
import { getCategoryPageData, getTypeIndexData, publicTypeCounts, visibleCategories } from "@/server/services/public-content";
import { resolveRedirect } from "@/server/services/redirects";
import { getSiteSections } from "@/server/services/sections";
import { resolveSegment } from "@/server/services/segment";

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ segment: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { segment } = await params;
  const target = await resolveSegment(segment);
  if (target.kind === "category") {
    const count = (await visibleCategories()).find((c) => c.id === target.category.id)?.count ?? 0;
    return pageMetadata({
      title: target.category.seoTitle || target.category.name,
      description: await topicDescription(target.category, count),
      path: categoryPath(target.category.slug),
      noindex: !taxonomyRobots(target.category.robotsIndex, count, 1).index,
    });
  }
  if (target.kind === "type") {
    const count = (await publicTypeCounts()).get(target.type.id) ?? 0;
    // The interview directory is a page of its own (companies, roles, counts), indexed whenever it lists something.
    const indexable = target.type.template === "interview" || target.type.indexable;
    return pageMetadata({ title: target.type.pluralName, description: target.type.description, path: typeIndexPath(target.type), noindex: !indexable || count === 0 });
  }
  if (target.kind === "page") return documentMetadata(target.doc);
  return { title: "Not found", robots: { index: false } };
}

export default async function SegmentPage({ params }: Props) {
  const { segment } = await params;
  const target = await resolveSegment(segment);

  switch (target.kind) {
    case "category":
      return <CategoryView data={await getCategoryPageData(target.category)} siteUrl={siteUrl()} />;
    case "type": {
      // Interview rounds are a map (company → role → rounds), not a dated feed.
      if (target.type.template === "interview") return <InterviewIndexView type={target.type} companies={await getInterviewDirectory(target.type)} siteUrl={siteUrl()} />;
      const [data, sections] = await Promise.all([getTypeIndexData(target.type, 1), getSiteSections()]);
      return <TypeIndexView type={target.type} items={data.items} total={data.total} page={1} perPage={data.perPage} siteUrl={siteUrl()} section={sections.sectionOfType(target.type.id)} />;
    }
    case "page":
      return <DocumentView data={await loadDocumentPage(target.doc)} />;
    default: {
      const found = await resolveRedirect(`/${segment}`);
      if (found) (found.permanent ? permanentRedirect : redirect)(found.location);
      notFound();
    }
  }
}
