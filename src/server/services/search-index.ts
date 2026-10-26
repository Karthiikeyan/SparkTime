import "server-only";
import { eq, inArray } from "drizzle-orm";
import { propertySearchText, type Properties } from "@/lib/content/properties";
import type { Db } from "../db/client";
import { categories, documentCategories, documents, documentTags, tags } from "../db/schema";
import { loadContentTypes } from "./content-types";

/**
 * documents.search_extra holds the words that make a document findable by its
 * context (type name, categories, tags, custom property text). The weighted
 * tsvector column is generated from it by Postgres.
 */
export async function refreshSearchExtra(db: Db, documentIds: string[]): Promise<void> {
  const ids = [...new Set(documentIds)];
  if (!ids.length) return;
  const types = await loadContentTypes(db);
  const typeById = new Map(types.map((t) => [t.id, t]));

  const [docs, catRows, tagRows] = await Promise.all([
    db.select({ id: documents.id, typeId: documents.typeId, properties: documents.properties }).from(documents).where(inArray(documents.id, ids)),
    db
      .select({ documentId: documentCategories.documentId, name: categories.name })
      .from(documentCategories)
      .innerJoin(categories, eq(categories.id, documentCategories.categoryId))
      .where(inArray(documentCategories.documentId, ids)),
    db
      .select({ documentId: documentTags.documentId, name: tags.name })
      .from(documentTags)
      .innerJoin(tags, eq(tags.id, documentTags.tagId))
      .where(inArray(documentTags.documentId, ids)),
  ]);

  for (const doc of docs) {
    const type = typeById.get(doc.typeId);
    const parts = [
      type?.name ?? "",
      ...catRows.filter((c) => c.documentId === doc.id).map((c) => c.name),
      ...tagRows.filter((t) => t.documentId === doc.id).map((t) => t.name),
      type ? propertySearchText(type.fields, (doc.properties ?? {}) as Properties) : "",
    ];
    await db
      .update(documents)
      .set({ searchExtra: parts.filter(Boolean).join(" ").slice(0, 20000) })
      .where(eq(documents.id, doc.id));
  }
}
