import "server-only";
import { and, asc, count, eq, ne, sql, type SQL } from "drizzle-orm";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb } from "../db/client";
import { categories, documentCategories, documents, documentTags, tags } from "../db/schema";
import { siteUrl } from "../env";

/**
 * Content Health: concrete, explainable checks over the library. Each check
 * is ONE SQL predicate on `documents`, used both to count (the health page)
 * and to filter (the Documents list, `?health=<key>`), so a count and the
 * list it opens can never disagree. Checks are diagnostic only — nothing
 * here changes content; the owner reviews the list and decides.
 */

export const HEALTH_CHECKS = {
  placeholder: {
    group: "Content",
    label: "Unfinished placeholders",
    help: "A line starting with [TODO], [ADD IMAGE/VIDEO/SCREENSHOT] or [INSERT CONTENT] in the title, excerpt or body. Publishing refuses these.",
  },
  empty: {
    group: "Content",
    label: "Empty body",
    help: "No words and no media in the body (ideas and collections are excluded).",
  },
  thin: {
    group: "Content",
    label: "Thin published articles",
    help: "Published editorial pieces under 300 words.",
  },
  "duplicate-title": {
    group: "Content",
    label: "Duplicate titles",
    help: "Another document (outside the Trash) has the same title, ignoring case.",
  },
  stale: {
    group: "Content",
    label: "Not revised in a year",
    help: "Published, and neither published nor revised in the last 365 days.",
  },
  "no-description": {
    group: "SEO",
    label: "No description",
    help: "Published with neither an SEO description nor an excerpt, so search results show the site's default description.",
  },
  noindex: {
    group: "SEO",
    label: "Published but noindex",
    help: "Explicitly excluded from search engines. Fine if intended.",
  },
  "no-image": {
    group: "SEO",
    label: "No featured image",
    help: "Published without a featured image. Social previews fall back to the generated card.",
  },
  "broken-links": {
    group: "Discovery",
    label: "Broken internal links",
    help: "Published documents linking to a /format/slug URL that isn't live (unpublished, private, in the Trash or deleted) and has no redirect.",
  },
  orphan: {
    group: "Discovery",
    label: "Orphan pages",
    help: "Published and public, but no other published document links to it and no published collection includes it.",
  },
  "no-topic": {
    group: "Discovery",
    label: "No topic",
    help: "Published without a topic, so it appears on no topic page.",
  },
  "missing-media": {
    group: "Media",
    label: "Missing media",
    help: "The body references a media file that no longer exists in the library.",
  },
} as const;

export type HealthCheck = keyof typeof HEALTH_CHECKS;

export function isHealthCheck(value: unknown): value is HealthCheck {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(HEALTH_CHECKS, value);
}

const published = sql`${documents.status} = 'published'`;
const listed = sql`(${documents.status} = 'published' and ${documents.visibility} = 'public')`;
const placeholderPattern = "(?n)^\\s*\\[(TODO|ADD (IMAGE|VIDEO|SCREENSHOT)|INSERT CONTENT)";

/** The predicate for one check. `origin` is the site's own origin, so absolute links to this site count as internal. */
export function healthCondition(check: HealthCheck, origin: string): SQL {
  switch (check) {
    case "placeholder":
      return sql`(${documents.title} ~* ${placeholderPattern} or ${documents.excerpt} ~* ${placeholderPattern} or ${documents.plainText} ~* ${placeholderPattern})`;
    case "empty":
      return sql`(${documents.status} <> 'idea' and ${documents.wordCount} = 0
        and ${documents.content}::text !~ '"type": ?"(image|gallery|youtube|embed|audio|file|bookmark)"'
        and not exists (select 1 from studio.content_types ct where ct.id = ${documents.typeId} and ct.template = 'collection'))`;
    case "thin":
      return sql`(${published} and ${documents.wordCount} < 300
        and exists (select 1 from studio.content_types ct where ct.id = ${documents.typeId} and ct.template = 'editorial'))`;
    case "duplicate-title":
      return sql`(btrim(${documents.title}) <> '' and exists (
        select 1 from studio.documents o
        where o.id <> ${documents.id} and o.status <> 'trashed' and lower(btrim(o.title)) = lower(btrim(${documents.title}))))`;
    case "stale":
      return sql`(${published} and coalesce(${documents.modifiedAt}, ${documents.publishedAt}, ${documents.createdAt}) < now() - interval '365 days')`;
    case "no-description":
      return sql`(${published} and coalesce(btrim(${documents.seoDescription}), '') = '' and btrim(${documents.excerpt}) = '')`;
    case "noindex":
      return sql`(${published} and ${documents.robotsIndex} = 'noindex')`;
    case "no-image":
      return sql`(${published} and ${documents.featuredMediaId} is null)`;
    case "broken-links": {
      const base = origin.replace(/\/+$/, "");
      return sql`(${published} and exists (
        select 1
        from jsonb_path_query(${documents.content}, 'lax $.**.href') as h(v)
        cross join lateral (
          select rtrim(split_part(split_part(
            case when (h.v #>> '{}') like ${`${base}/%`} then substr(h.v #>> '{}', ${base.length + 1}) else h.v #>> '{}' end,
            '#', 1), '?', 1), '/') as p
        ) link
        join studio.content_types ct on ct.routing = 'type' and link.p ~ ('^/' || ct.slug || '/[a-z0-9-]+$')
        where jsonb_typeof(h.v) = 'string'
          and not exists (
            select 1 from studio.documents t
            where t.type_id = ct.id and '/' || ct.slug || '/' || t.slug = link.p
              and t.status in ('published', 'archived') and t.visibility in ('public', 'unlisted'))
          and not exists (
            select 1 from studio.redirects r
            where r.from_path = link.p or (r.match_type = 'prefix' and link.p like r.from_path || '/%'))))`;
    }
    case "orphan":
      return sql`(${listed}
        and not exists (select 1 from studio.content_types ct where ct.id = ${documents.typeId} and ct.routing = 'root')
        and not exists (
          select 1 from studio.document_relations r join studio.documents s on s.id = r.source_id
          where r.target_id = ${documents.id} and s.status = 'published' and s.visibility = 'public')
        and not exists (
          select 1 from studio.collection_items ci join studio.documents c on c.id = ci.collection_id
          where ci.document_id = ${documents.id} and c.status = 'published' and c.visibility = 'public'))`;
    case "no-topic":
      return sql`(${published} and not exists (select 1 from studio.document_categories dc where dc.document_id = ${documents.id}))`;
    case "missing-media":
      return sql`exists (
        select 1 from jsonb_path_query(${documents.content}, 'lax $.**.mediaId') as m(v)
        where jsonb_typeof(m.v) = 'string' and not exists (select 1 from studio.media x where x.id::text = m.v #>> '{}'))`;
  }
}

export type HealthReport = {
  checks: Array<{ key: HealthCheck; group: string; label: string; help: string; count: number }>;
  taxonomy: {
    unusedTopics: Array<{ id: string; name: string }>;
    topicsWithoutPublished: Array<{ id: string; name: string; documents: number }>;
    duplicateTopics: Array<{ key: string; names: string[] }>;
    unusedTags: Array<{ id: string; name: string }>;
    duplicateTags: Array<{ key: string; names: string[] }>;
  };
};

/** Normalised name for near-duplicate detection: "Node.js" ≡ "NodeJS" ≡ "node js". */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function duplicates(rows: Array<{ name: string }>): Array<{ key: string; names: string[] }> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const key = nameKey(row.name);
    if (key) groups.set(key, [...(groups.get(key) ?? []), row.name]);
  }
  return [...groups.entries()].filter(([, names]) => names.length > 1).map(([key, names]) => ({ key, names }));
}

/** Every check counted in one pass over the library (count(*) FILTER per check), plus taxonomy findings. */
export async function contentHealthReport(actor: Actor): Promise<HealthReport> {
  assertAdmin(actor);
  const db = getDb();
  const origin = siteUrl();
  const keys = Object.keys(HEALTH_CHECKS) as HealthCheck[];
  const selection = Object.fromEntries(keys.map((key) => [key, sql<number>`count(*) filter (where ${healthCondition(key, origin)})`]));

  const [[counts], cats, tagRows, catUse, tagUse] = await Promise.all([
    db.select(selection).from(documents).where(ne(documents.status, "trashed")),
    db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
    db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(asc(tags.name)),
    db
      .select({ id: documentCategories.categoryId, all: count(), published: sql<number>`count(*) filter (where ${listed})` })
      .from(documentCategories)
      .innerJoin(documents, eq(documents.id, documentCategories.documentId))
      .where(ne(documents.status, "trashed"))
      .groupBy(documentCategories.categoryId),
    db
      .select({ id: documentTags.tagId, all: count() })
      .from(documentTags)
      .innerJoin(documents, and(eq(documents.id, documentTags.documentId), ne(documents.status, "trashed")))
      .groupBy(documentTags.tagId),
  ]);

  const catCount = new Map(catUse.map((r) => [r.id, { all: Number(r.all), published: Number(r.published) }]));
  const tagCount = new Map(tagUse.map((r) => [r.id, Number(r.all)]));
  const row = (counts ?? {}) as Record<string, unknown>;

  return {
    checks: keys.map((key) => ({ key, ...HEALTH_CHECKS[key], count: Number(row[key] ?? 0) })),
    taxonomy: {
      unusedTopics: cats.filter((c) => !catCount.get(c.id)?.all),
      topicsWithoutPublished: cats
        .filter((c) => (catCount.get(c.id)?.all ?? 0) > 0 && !catCount.get(c.id)?.published)
        .map((c) => ({ ...c, documents: catCount.get(c.id)!.all })),
      duplicateTopics: duplicates(cats),
      unusedTags: tagRows.filter((t) => !tagCount.get(t.id)),
      duplicateTags: duplicates(tagRows),
    },
  };
}
