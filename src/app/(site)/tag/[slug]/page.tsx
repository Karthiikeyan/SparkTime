import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { TagView } from "@/components/pages/tag-view";
import { tagPath } from "@/lib/content/paths";
import { taxonomyRobots } from "@/lib/seo/robots";
import { siteUrl } from "@/server/env";
import { pageMetadata } from "@/server/seo/metadata";
import { getTagPageData, publicTagCounts } from "@/server/services/public-content";
import { resolveRedirect } from "@/server/services/redirects";
import { loadAllSettings } from "@/server/services/settings";
import { getTagBySlug } from "@/server/services/taxonomy";

export const revalidate = 3600;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tag = await getTagBySlug(slug);
  if (!tag) return { title: "Not found", robots: { index: false } };
  const [counts, settings] = await Promise.all([publicTagCounts(), loadAllSettings()]);
  const count = counts.get(tag.id) ?? 0;
  return pageMetadata({
    title: `#${tag.name}`,
    description: tag.description || `Writing, projects and resources tagged “${tag.name}”.`,
    path: tagPath(tag.slug),
    // Thin tag pages stay out of the index until they're genuinely useful.
    noindex: !taxonomyRobots(tag.robotsIndex, count, settings.seo.tagIndexThreshold).index,
  });
}

export default async function TagPage({ params }: Props) {
  const { slug } = await params;
  const tag = await getTagBySlug(slug);
  if (!tag) {
    const found = await resolveRedirect(`/tag/${slug}`);
    if (found) permanentRedirect(found.location);
    notFound();
  }
  return <TagView tag={tag} data={await getTagPageData(tag)} siteUrl={siteUrl()} />;
}
