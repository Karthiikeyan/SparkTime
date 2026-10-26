import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { isInterviewType } from "@/lib/content/kind";
import { absoluteUrl, categoryPath, documentPath, tagPath, typeIndexPath } from "@/lib/content/paths";
import { companyHref } from "@/lib/interviews/directory";
import { RETIRED_PATHS } from "@/lib/legacy-paths";
import { taxonomyRobots } from "@/lib/seo/robots";
import { isNotesTopic } from "@/lib/site-config";
import { getDb } from "../db/client";
import { contentTypes, documents } from "../db/schema";
import { siteUrl } from "../env";
import { listContentTypes } from "../services/content-types";
import { getInterviewDirectory } from "../services/interviews";
import { getRootPage, publicTagCounts, publicTypeCounts, systemCollectionPaths, visibleCategories } from "../services/public-content";
import { getSiteSections } from "../services/sections";
import { loadAllSettings } from "../services/settings";
import { listTags } from "../services/taxonomy";
import { listedSql, sitemapCandidateSql } from "../services/visibility";

export type SitemapEntry = { url: string; lastModified?: Date; changeFrequency?: "daily" | "weekly" | "monthly" | "yearly"; priority?: number };

const SYSTEM_PAGES = ["about", "now", "uses", "start-here", "sparktribe", "contact"] as const;

/**
 * Sitemap = indexable URLs only. Drafts, ideas, scheduled, private,
 * archived, unlisted (unless explicitly opted in), noindex documents,
 * non-canonical duplicates, empty sections and thin taxonomy pages are
 * excluded.
 */
export async function sitemapEntries(): Promise<SitemapEntry[]> {
  const base = siteUrl();
  const [types, typeCounts, cats, tagRows, tagCounts, settings] = await Promise.all([
    listContentTypes(),
    publicTypeCounts(),
    visibleCategories(),
    listTags(),
    publicTagCounts(),
    loadAllSettings(),
  ]);
  const entries: SitemapEntry[] = [{ url: base, changeFrequency: "weekly", priority: 1 }];

  // The collections behind /start-here and /uses are represented by those pages
  // (their cards link there and their canonical points there), so they aren't listed twice.
  const collectionFor: Record<string, string | null> = { "start-here": settings.pages.startHereCollectionId, uses: settings.pages.usesCollectionId };
  const represented = new Set<string>();
  for (const slug of SYSTEM_PAGES) {
    const page = await getRootPage(slug);
    if (page && page.status === "published" && page.visibility === "public" && page.robotsIndex !== "noindex"
      && (!page.canonicalUrl || page.canonicalUrl === absoluteUrl(base, `/${slug}`))) {
      entries.push({ url: absoluteUrl(base, `/${slug}`), lastModified: new Date(page.modifiedAt ?? page.publishedAt ?? page.updatedAt), priority: slug === "about" ? 0.9 : 0.6 });
      const bound = collectionFor[slug];
      if (bound) represented.add(bound);
    }
  }
  if (types.some((type) => type.routing === "type" && !type.archivedAt && (typeCounts.get(type.id) ?? 0) > 0)) {
    entries.push({ url: absoluteUrl(base, "/library"), changeFrequency: "weekly", priority: 0.8 });
    if (cats.some((c) => c.count > 0)) entries.push({ url: absoluteUrl(base, "/topics"), changeFrequency: "weekly", priority: 0.7 });
    if (cats.some((c) => isNotesTopic(c, settings.home.topics.slugs))) entries.push({ url: absoluteUrl(base, "/notes"), changeFrequency: "weekly", priority: 0.6 });
  }
  // Work stays a page of its own; Writing and Speaking now live in the Library and About, and their old paths redirect.
  const work = (await getSiteSections()).hub("work");
  if (work.count > 0) entries.push({ url: absoluteUrl(base, work.path), changeFrequency: "weekly", priority: 0.8 });

  for (const type of types) {
    if (type.routing === "type" && type.indexable && !type.archivedAt && (typeCounts.get(type.id) ?? 0) > 0 && !RETIRED_PATHS.some((r) => r.from === typeIndexPath(type))) {
      entries.push({ url: absoluteUrl(base, typeIndexPath(type)), changeFrequency: "weekly", priority: 0.7 });
    }
  }
  // Interview directory and its company pages: hubs that lead to the role pages.
  const interviewType = types.find(isInterviewType);
  if (interviewType && (typeCounts.get(interviewType.id) ?? 0) > 0) {
    entries.push({ url: absoluteUrl(base, typeIndexPath(interviewType)), changeFrequency: "weekly", priority: 0.8 });
    const directory = await getInterviewDirectory(interviewType);
    const ownPages = directory.flatMap((c) => (c.page ? [c.page.id] : []));
    const ownRobots = ownPages.length ? new Map((await getDb().select({ id: documents.id, robots: documents.robotsIndex, canonical: documents.canonicalUrl }).from(documents).where(inArray(documents.id, ownPages))).map((r) => [r.id, r])) : new Map();
    for (const company of directory) {
      const path = companyHref(typeIndexPath(interviewType), company);
      const own = company.page ? ownRobots.get(company.page.id) : null;
      if (company.page && (!own || own.robots === "noindex" || (own.canonical && own.canonical !== absoluteUrl(base, path)))) continue;
      if (!company.page && company.roles.length === 0) continue;
      entries.push({ url: absoluteUrl(base, path), changeFrequency: "weekly", priority: 0.7 });
    }
  }
  for (const cat of cats) {
    if (cat.count > 0 && taxonomyRobots(cat.robotsIndex, cat.count, 1).index) {
      entries.push({ url: absoluteUrl(base, categoryPath(cat.slug)), changeFrequency: "weekly", priority: 0.7 });
    }
  }
  for (const tag of tagRows) {
    const count = tagCounts.get(tag.id) ?? 0;
    if (taxonomyRobots(tag.robotsIndex, count, settings.seo.tagIndexThreshold).index) {
      entries.push({ url: absoluteUrl(base, tagPath(tag.slug)), changeFrequency: "monthly", priority: 0.4 });
    }
  }

  const rows = await getDb()
    .select({
      id: documents.id,
      slug: documents.slug,
      typeSlug: contentTypes.slug,
      routing: contentTypes.routing,
      updatedAt: documents.updatedAt,
      modifiedAt: documents.modifiedAt,
      publishedAt: documents.publishedAt,
      canonicalUrl: documents.canonicalUrl,
      featured: documents.featured,
    })
    .from(documents)
    .innerJoin(contentTypes, eq(contentTypes.id, documents.typeId))
    .where(
      and(
        sitemapCandidateSql(),
        sql`${documents.robotsIndex} <> 'noindex'`,
        or(eq(contentTypes.indexable, true), eq(documents.robotsIndex, "index")),
        sql`${contentTypes.archivedAt} is null`,
      ),
    )
    .orderBy(desc(documents.publishedAt))
    .limit(45000);

  for (const r of rows) {
    const path = documentPath({ slug: r.typeSlug, routing: r.routing }, r.slug);
    if ((SYSTEM_PAGES as readonly string[]).includes(r.slug) && r.routing === "root") continue; // already listed
    if (represented.has(r.id)) continue; // listed as /start-here or /uses
    const url = absoluteUrl(base, path);
    if (r.canonicalUrl && r.canonicalUrl !== url) continue; // non-canonical duplicate
    entries.push({ url, lastModified: r.modifiedAt ?? r.publishedAt ?? r.updatedAt, changeFrequency: "monthly", priority: r.featured ? 0.8 : 0.6 });
  }
  // A company page can be listed above and again here when its owner set it to Index.
  return entries.filter((e, i) => entries.findIndex((o) => o.url === e.url) === i);
}

export type FeedItem = { title: string; url: string; description: string; publishedAt: Date; categories: string[]; typeName: string };

/** RSS: public, published, feed-enabled types only. */
export async function feedItems(limit = 40): Promise<FeedItem[]> {
  const base = siteUrl();
  const types = (await listContentTypes()).filter((t) => t.inFeeds && !t.archivedAt);
  if (!types.length) return [];
  const rows = await getDb()
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      excerpt: documents.excerpt,
      plainHead: sql<string>`left(${documents.plainText}, 400)`,
      publishedAt: documents.publishedAt,
      typeId: documents.typeId,
    })
    .from(documents)
    .where(and(listedSql(), inArray(documents.typeId, types.map((t) => t.id)), sql`${documents.robotsIndex} <> 'noindex'`))
    .orderBy(desc(documents.publishedAt))
    .limit(limit);
  const byId = new Map(types.map((t) => [t.id, t]));
  // The Start here / Toolkit collections link to /start-here and /uses (their canonical), as they do everywhere else.
  const systemPaths = await systemCollectionPaths(rows.map((r) => r.id));
  return rows.flatMap((r) => {
    const type = byId.get(r.typeId);
    if (!type || !r.publishedAt) return [];
    return [
      {
        title: r.title,
        url: absoluteUrl(base, systemPaths.get(r.id) ?? documentPath(type, r.slug)),
        description: r.excerpt || r.plainHead.replace(/\s+/g, " ").slice(0, 300),
        publishedAt: r.publishedAt,
        categories: [type.name],
        typeName: type.name,
      },
    ];
  });
}

export function escapeXml(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderRss(input: { title: string; description: string; siteUrl: string; items: FeedItem[] }): string {
  const items = input.items
    .map(
      (i) => `    <item>
      <title>${escapeXml(i.title)}</title>
      <link>${escapeXml(i.url)}</link>
      <guid isPermaLink="true">${escapeXml(i.url)}</guid>
      <pubDate>${i.publishedAt.toUTCString()}</pubDate>
      <description>${escapeXml(i.description)}</description>
${i.categories.map((c) => `      <category>${escapeXml(c)}</category>`).join("\n")}
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(input.title)}</title>
    <link>${escapeXml(input.siteUrl)}</link>
    <description>${escapeXml(input.description)}</description>
    <language>en</language>
    <atom:link href="${escapeXml(input.siteUrl)}/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${(input.items[0]?.publishedAt ?? new Date()).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
