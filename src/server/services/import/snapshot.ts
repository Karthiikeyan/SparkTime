import "server-only";
import { count, max } from "drizzle-orm";
import { documentPath } from "@/lib/content/paths";
import { sha256Hex } from "@/lib/portability/parse";
import type { DestinationSnapshot } from "@/lib/portability/plan-types";
import type { Db } from "../../db/client";
import { categories, collectionItems, documents, media, portableIdentities, redirects, tags } from "../../db/schema";
import { getStorage } from "../../media/storage";
import { loadContentTypes } from "../content-types";

/**
 * A read-only view of the destination for the planner. The fingerprint
 * changes whenever anything the plan depends on changes, which is how an
 * approval detects a stale preview.
 */
export async function loadDestinationSnapshot(db: Db): Promise<DestinationSnapshot> {
  const [types, cats, tagRows, docs, identities, mediaRows, items, redirectRows, stats] = await Promise.all([
    loadContentTypes(db),
    db.select({ id: categories.id, name: categories.name, slug: categories.slug, parentId: categories.parentId }).from(categories),
    db.select({ id: tags.id, name: tags.name, slug: tags.slug }).from(tags),
    db
      .select({ id: documents.id, typeId: documents.typeId, slug: documents.slug, title: documents.title, status: documents.status, visibility: documents.visibility, canonicalUrl: documents.canonicalUrl })
      .from(documents),
    db.select().from(portableIdentities),
    db.select({ id: media.id, storageKey: media.storageKey }).from(media),
    db.select({ collectionId: collectionItems.collectionId, documentId: collectionItems.documentId, position: collectionItems.position }).from(collectionItems),
    db.select({ fromPath: redirects.fromPath }).from(redirects),
    Promise.all([
      db.select({ n: count(), at: max(documents.updatedAt) }).from(documents),
      db.select({ n: count(), at: max(categories.updatedAt) }).from(categories),
      db.select({ n: count(), at: max(tags.updatedAt) }).from(tags),
      db.select({ n: count(), at: max(portableIdentities.updatedAt) }).from(portableIdentities),
      db.select({ n: count() }).from(collectionItems),
      db.select({ n: count() }).from(media),
    ]),
  ]);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const storage = getStorage();
  const activeTypes = types.filter((t) => !t.archivedAt);
  return {
    types: activeTypes.map((t) => ({ id: t.id, slug: t.slug, name: t.name, pluralName: t.pluralName, template: t.template, routing: t.routing, fields: t.fields })),
    categories: cats,
    tags: tagRows,
    documents: docs.map((d) => {
      const type = typeById.get(d.typeId);
      return { ...d, path: type ? documentPath(type, d.slug) : `/${d.slug}` };
    }),
    identities: identities.map((i) => ({
      portableId: i.portableId,
      entity: i.entity as DestinationSnapshot["identities"][number]["entity"],
      entityId: (i.documentId ?? i.categoryId ?? i.tagId ?? i.mediaId)!,
    })),
    media: mediaRows.map((m) => ({ id: m.id, url: storage.urlFor(m.storageKey) })),
    collectionItems: items,
    // Archived types still own their URL prefix.
    rootSlugs: types.map((t) => t.slug),
    redirectPaths: redirectRows.map((r) => r.fromPath),
    fingerprint: await sha256Hex(JSON.stringify([stats, types.map((t) => [t.id, t.slug, t.updatedAt, t.fields.length])])),
  };
}
