import "server-only";
import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/content/paths";
import { valueByRole } from "@/lib/content/properties";
import { documentRobots } from "@/lib/seo/robots";
import { applyTitleTemplate } from "@/lib/settings";
import { siteUrl } from "../env";
import type { PublicDocument } from "../services/public-content";
import { getBrand, loadAllSettings } from "../services/settings";

/**
 * Metadata builders. Every indexable page gets a unique title, description,
 * canonical URL, Open Graph/Twitter cards and explicit robots directives.
 */

/**
 * Next.js merges metadata shallowly: a page's `alternates` replaces the root
 * layout's entirely. So the RSS autodiscovery link has to travel with every
 * canonical, or it silently disappears from every page that sets one.
 */
function alternatesFor(canonical: string, settings: Awaited<ReturnType<typeof loadAllSettings>>, siteName: string): Metadata["alternates"] {
  return { canonical, ...(settings.features.rss ? { types: { "application/rss+xml": [{ url: "/feed.xml", title: `${siteName} — RSS` }] } } : {}) };
}

/**
 * A topic without its own description would otherwise inherit the site's default
 * description (the home page's), which tells a searcher nothing about the topic.
 */
export async function topicDescription(topic: { name: string; description: string; seoDescription?: string | null }, count: number): Promise<string> {
  const own = topic.seoDescription || topic.description;
  if (own) return own;
  const name = (await loadAllSettings()).identity.name || "Karthikeyan A";
  return `${name}'s writing on ${topic.name}: ${count} ${count === 1 ? "piece" : "pieces"} in the library.`;
}

export async function pageMetadata(input: {
  title: string;
  description?: string;
  path: string;
  noindex?: boolean;
  ogImagePath?: string;
  type?: "website" | "profile";
}): Promise<Metadata> {
  const [settings, brand] = await Promise.all([loadAllSettings(), getBrand()]);
  const base = siteUrl();
  // The product names the page; the person (Settings → Identity) is its author. Settings → Site owns the name and the title format.
  const title = applyTitleTemplate(brand.titleTemplate, input.title, brand.name);
  const description = (input.description || brand.description).slice(0, 320);
  const url = absoluteUrl(base, input.path);
  const image = absoluteUrl(base, input.ogImagePath ?? "/opengraph-image");
  return {
    title: { absolute: title },
    description,
    alternates: alternatesFor(url, settings, brand.name),
    robots: input.noindex ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: {
      type: input.type ?? "website",
      title,
      description,
      url,
      siteName: brand.name,
      locale: "en_IN",
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
      creator: settings.seo.twitterHandle || undefined,
    },
  };
}

export async function documentMetadata(doc: PublicDocument): Promise<Metadata> {
  const [settings, brand] = await Promise.all([loadAllSettings(), getBrand()]);
  const base = siteUrl();
  const name = settings.identity.name || "Karthikeyan A";
  const url = absoluteUrl(base, doc.path);
  const canonical = doc.canonicalUrl ?? url;
  const rawTitle = doc.seoTitle || doc.title;
  const title = applyTitleTemplate(brand.titleTemplate, rawTitle, brand.name);
  const description = (doc.seoDescription || doc.excerpt || brand.description).slice(0, 320);
  const robots = documentRobots({
    status: doc.status,
    visibility: doc.visibility,
    robotsIndex: doc.robotsIndex,
    // A company's own page is a hub that earns its place in search; a role page stays as the owner (or the import's advice) set it.
    typeIndexable: doc.fullType.indexable || (doc.fullType.template === "interview" && !valueByRole(doc.fullType.fields, doc.properties, "interviewRole")),
    canonicalElsewhere: Boolean(doc.canonicalUrl && doc.canonicalUrl !== url),
  });
  // Archived pages stay reachable for old links but drop out of the index.
  if (doc.status === "archived") robots.index = false;
  const image = doc.image ? absoluteUrl(base, doc.image.url) : absoluteUrl(base, `/og${doc.path}`);
  const isArticle = ["editorial", "minimal", "story"].includes(doc.type.template);

  return {
    title: { absolute: title },
    description,
    alternates: alternatesFor(canonical, settings, brand.name),
    robots,
    authors: [{ name, url: `${base}/about` }],
    creator: name,
    openGraph: {
      type: isArticle ? "article" : "website",
      title,
      description,
      url,
      siteName: brand.name,
      locale: "en_IN",
      images: [{ url: image, width: doc.image?.width ?? 1200, height: doc.image?.height ?? 630, alt: doc.image?.alt || doc.title }],
      ...(isArticle
        ? {
            publishedTime: doc.publishedAt ?? undefined,
            modifiedTime: doc.modifiedAt ?? doc.publishedAt ?? undefined,
            authors: [`${base}/about`],
            section: doc.primaryCategory?.name,
            tags: doc.tags.map((t) => t.name),
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
      creator: settings.seo.twitterHandle || undefined,
    },
    other: {
      ...(doc.publishedAt ? { "article:published_time": doc.publishedAt } : {}),
      ...(doc.modifiedAt ? { "article:modified_time": doc.modifiedAt } : {}),
    },
  };
}
