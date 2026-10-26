import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentEditor, type EditorBootstrap, type EditorContext } from "@/components/admin/document-editor";
import { TrashedDocument } from "@/components/admin/trashed-document";
import { extractReferences } from "@/lib/content/derive";
import { requireAdminPage } from "@/server/auth/guard";
import { mediaPublicOrigin, siteUrl } from "@/server/env";
import { isServiceError } from "@/server/errors";
import { listContentTypes } from "@/server/services/content-types";
import { documentTitles, getDocumentForEdit, userLogin, type AdminDocument } from "@/server/services/documents";
import { getMediaAssets } from "@/server/services/media";
import { getBrand } from "@/server/services/settings";
import { listCategories, listTags } from "@/server/services/taxonomy";

export const metadata: Metadata = { title: "Editor" };

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminPage();
  const { id } = await params;
  let doc: AdminDocument;
  try {
    doc = await getDocumentForEdit(actor, id);
  } catch (error) {
    if (isServiceError(error) && error.code === "not_found") notFound();
    throw error;
  }

  if (doc.status === "trashed") {
    const trashedBy = doc.trashedBy ? await userLogin(actor, doc.trashedBy) : null;
    return <TrashedDocument doc={{ id: doc.id, title: doc.title, slug: doc.slug, typeName: doc.type.name, trashedAt: doc.trashedAt?.toISOString() ?? null, trashedBy, wordCount: doc.wordCount }} />;
  }

  // The editor loads the staged working copy when one exists.
  const body = doc.workingCopy ?? { title: doc.title, excerpt: doc.excerpt, content: doc.content, properties: doc.properties, featuredMediaId: doc.featuredMediaId };
  const refs = extractReferences(body.content);
  const mediaFieldIds = doc.type.fields.filter((f) => f.type === "image" || f.type === "file").map((f) => body.properties[f.key] as string | undefined);
  const relationIds = doc.type.fields.filter((f) => f.type === "relation").flatMap((f) => {
    const v = body.properties[f.key];
    return Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : [];
  });

  const [types, categories, tags, media, titles, brand] = await Promise.all([
    listContentTypes(),
    listCategories(),
    listTags(),
    getMediaAssets([body.featuredMediaId, ...refs.mediaIds, ...mediaFieldIds]),
    documentTitles(actor, [...refs.documentIds, ...relationIds]),
    getBrand(),
  ]);

  const bootstrap: EditorBootstrap = {
    id: doc.id,
    version: doc.version,
    status: doc.status,
    visibility: doc.visibility,
    slug: doc.slug,
    path: doc.path,
    hasStagedChanges: doc.workingCopy !== null,
    body: { title: body.title, excerpt: body.excerpt, content: body.content as EditorBootstrap["body"]["content"], properties: body.properties, featuredMediaId: body.featuredMediaId },
    settings: {
      seoTitle: doc.seoTitle ?? "",
      seoDescription: doc.seoDescription ?? "",
      canonicalUrl: doc.canonicalUrl ?? "",
      robotsIndex: doc.robotsIndex,
      featured: doc.featured,
      priority: doc.priority,
      templateOverride: doc.templateOverride,
      notes: doc.notes,
      publishedAt: doc.publishedAt?.toISOString() ?? null,
    },
    updatedAt: doc.updatedAt.toISOString(),
    type: { id: doc.type.id, name: doc.type.name, slug: doc.type.slug, template: doc.type.template, fields: doc.type.fields, indexable: doc.type.indexable },
    categories: doc.categories,
    tags: doc.tags,
    relations: doc.relations.map((r) => ({ targetId: r.targetId, kind: r.kind, note: r.note, title: r.target.title, typeName: r.target.typeName })),
    backlinks: doc.backlinks.map((b) => ({ sourceId: b.sourceId, kind: b.kind, title: b.source.title, typeName: b.source.typeName })),
    items: doc.collectionItems.map((i) => ({ documentId: i.documentId, groupLabel: i.groupLabel, note: i.note, title: i.document.title, typeName: i.document.typeName, status: i.document.status })),
  };

  const ctx: EditorContext = {
    types: types.map((t) => ({ id: t.id, name: t.name, archived: Boolean(t.archivedAt) || t.routing === "root" })),
    allCategories: categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, archivedAt: c.archivedAt?.toISOString() ?? null })),
    allTags: tags.map((t) => ({ id: t.id, name: t.name })),
    media: Object.fromEntries(media),
    titles,
    mediaOrigin: mediaPublicOrigin(),
    siteUrl: siteUrl(),
    // The search-result preview shows the same title the public page gets: the product name and format from Settings → Site.
    siteName: brand.name,
    titleTemplate: brand.titleTemplate,
  };

  return <DocumentEditor doc={bootstrap} ctx={ctx} />;
}
