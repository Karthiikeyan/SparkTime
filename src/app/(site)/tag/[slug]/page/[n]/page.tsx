import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { TagView } from "@/components/pages/tag-view";
import { parsePageNumber, tagPath } from "@/lib/content/paths";
import { taxonomyRobots } from "@/lib/seo/robots";
import { siteUrl } from "@/server/env";
import { pageMetadata } from "@/server/seo/metadata";
import { getTagPageData, publicTagCounts } from "@/server/services/public-content";
import { resolveRedirect } from "@/server/services/redirects";
import { loadAllSettings } from "@/server/services/settings";
import { getTagBySlug } from "@/server/services/taxonomy";

/** /tag/{slug}/page/{n} — older pieces with a tag, so none fall off the end. */
export const revalidate = 3600;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string; n: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, n } = await params;
  const page = parsePageNumber(n);
  const tag = page ? await getTagBySlug(slug) : null;
  if (!tag || !page) return { title: "Not found", robots: { index: false } };
  const [counts, settings] = await Promise.all([publicTagCounts(), loadAllSettings()]);
  return pageMetadata({
    title: `#${tag.name} — page ${page}`,
    description: tag.description || `Writing, projects and resources tagged “${tag.name}”.`,
    path: `${tagPath(tag.slug)}/page/${page}`,
    noindex: !taxonomyRobots(tag.robotsIndex, counts.get(tag.id) ?? 0, settings.seo.tagIndexThreshold).index,
  });
}

export default async function TagPagedPage({ params }: Props) {
  const { slug, n } = await params;
  const page = parsePageNumber(n);
  if (!page) notFound();
  const tag = await getTagBySlug(slug);
  if (!tag) {
    // A merged or renamed tag: send people to where it lives now.
    const found = await resolveRedirect(`/tag/${slug}`);
    if (found) permanentRedirect(found.location);
    notFound();
  }
  const data = await getTagPageData(tag, page);
  if (!data.items.length) notFound();
  return <TagView tag={tag} data={data} siteUrl={siteUrl()} />;
}
