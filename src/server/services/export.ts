import "server-only";
import { asc } from "drizzle-orm";
import { sanitizeDoc } from "@/lib/content/blocks";
import { docToMarkdown, frontMatter } from "@/lib/content/markdown";
import { documentPath } from "@/lib/content/paths";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb, type Db } from "../db/client";
import {
  categories,
  collectionItems,
  contentTypeFields,
  contentTypes,
  documentCategories,
  documentRelations,
  documents,
  documentTags,
  media,
  navigationItems,
  redirects,
  siteSettings,
  tags,
} from "../db/schema";

/**
 * Portable export. `bundle.json` is lossless (it can rebuild the database via
 * `npm run import`); the Markdown files are for humans and other tools.
 * Operational data (sessions, rate limits, audit log, contact messages) is
 * intentionally excluded — it is not content and may contain personal data.
 */
export const EXPORT_FORMAT_VERSION = 1;

export async function buildExportBundle(db: Db = getDb()) {
  const [types, fields, cats, tagRows, docs, docCats, docTags, rels, items, mediaRows, nav, settings, redirectRows] = await Promise.all([
    db.select().from(contentTypes).orderBy(asc(contentTypes.position)),
    db.select().from(contentTypeFields).orderBy(asc(contentTypeFields.position)),
    db.select().from(categories).orderBy(asc(categories.position)),
    db.select().from(tags).orderBy(asc(tags.name)),
    db.select().from(documents).orderBy(asc(documents.createdAt)),
    db.select().from(documentCategories),
    db.select().from(documentTags),
    db.select().from(documentRelations),
    db.select().from(collectionItems),
    db.select().from(media),
    db.select().from(navigationItems),
    db.select().from(siteSettings),
    db.select().from(redirects),
  ]);
  return {
    format: "karthikeyan-a-studio-export",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    contentTypes: types,
    contentTypeFields: fields,
    categories: cats,
    tags: tagRows,
    documents: docs.map(({ searchVector: _sv, ...rest }) => (void _sv, rest)),
    documentCategories: docCats,
    documentTags: docTags,
    documentRelations: rels,
    collectionItems: items,
    media: mediaRows,
    navigationItems: nav,
    siteSettings: settings,
    redirects: redirectRows,
  };
}

export type ExportBundle = Awaited<ReturnType<typeof buildExportBundle>>;

export async function exportBundle(actor: Actor): Promise<ExportBundle> {
  assertAdmin(actor);
  return buildExportBundle();
}

/** One Markdown file per document with front matter describing its context. */
export function bundleToMarkdownFiles(bundle: ExportBundle, siteUrl: string): Array<{ path: string; content: string }> {
  const typeById = new Map(bundle.contentTypes.map((t) => [t.id, t]));
  const catById = new Map(bundle.categories.map((c) => [c.id, c]));
  const tagById = new Map(bundle.tags.map((t) => [t.id, t]));
  const docById = new Map(bundle.documents.map((d) => [d.id, d]));

  return bundle.documents.map((doc) => {
    const type = typeById.get(doc.typeId);
    const typeSlug = type?.slug ?? "unknown";
    const resolveDocument = (id: string) => {
      const target = docById.get(id);
      const targetType = target ? typeById.get(target.typeId) : undefined;
      return target && targetType ? { title: target.title, url: siteUrl + documentPath(targetType, target.slug) } : null;
    };
    const meta = {
      id: doc.id,
      title: doc.title,
      slug: doc.slug,
      type: typeSlug,
      status: doc.status,
      visibility: doc.visibility,
      excerpt: doc.excerpt || undefined,
      publishedAt: doc.publishedAt?.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      categories: bundle.documentCategories.filter((dc) => dc.documentId === doc.id).map((dc) => catById.get(dc.categoryId)?.slug).filter(Boolean),
      tags: bundle.documentTags.filter((dt) => dt.documentId === doc.id).map((dt) => tagById.get(dt.tagId)?.name).filter(Boolean),
      relations: bundle.documentRelations
        .filter((r) => r.sourceId === doc.id)
        .map((r) => ({ kind: r.kind, target: docById.get(r.targetId)?.slug, origin: r.origin })),
      properties: doc.properties,
    };
    return {
      path: `markdown/${typeSlug}/${doc.slug}.md`,
      content: frontMatter(meta) + `# ${doc.title}\n\n` + docToMarkdown(sanitizeDoc(doc.content), { resolveDocument }),
    };
  });
}
