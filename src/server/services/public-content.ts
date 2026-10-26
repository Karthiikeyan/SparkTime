import "server-only";
import { cache } from "react";
import { and, asc, count, desc, eq, gt, inArray, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { isUuid, sanitizeDoc, type Doc } from "@/lib/content/blocks";
import { autoExcerpt, extractReferences } from "@/lib/content/derive";
import { isCourseType } from "@/lib/content/kind";
import { isAccent, isDocumentStatus, isRelationKind, type DocumentStatus, type RelationKind, type Visibility } from "@/lib/content/model";
import { documentPath } from "@/lib/content/paths";
import { valueByRole, type Properties } from "@/lib/content/properties";
import { parseYouTubeId } from "@/lib/embeds";
import { accountsLabel, publicGuide, readGuide } from "@/lib/interviews/guide";
import type { MediaAsset } from "@/lib/media";
import { isValidSlug } from "@/lib/slug";
import { getDb } from "../db/client";
import { categories, collectionItems, documentCategories, documentRelations, documents, documentTags, tags } from "../db/schema";
import { listContentTypes, type ContentType } from "./content-types";
import { getMediaAssets } from "./media";
import { loadAllSettings } from "./settings";
import { listCategories, listTags, type Category, type Tag } from "./taxonomy";
import { accessibleSql, isAccessible, listedSql } from "./visibility";

// ---------------------------------------------------------------------------
// Card model (everything a list item needs; dates serialised for client use)
// ---------------------------------------------------------------------------

export type Card = {
  id: string;
  title: string;
  path: string;
  excerpt: string;
  /** Public reads only ever see published/archived; previews may see others. */
  status: DocumentStatus;
  type: Pick<ContentType, "id" | "name" | "slug" | "template" | "icon" | "pluralName" | "schemaType">;
  publishedAt: string | null;
  modifiedAt: string | null;
  readingMinutes: number;
  featured: boolean;
  image: MediaAsset | null;
  videoId: string | null;
  primaryCategory: { name: string; slug: string; accent: string | null } | null;
  /** A short, template-relevant fact for the card (event, period, status...). */
  meta: string | null;
};

const cardColumns = {
  id: documents.id,
  title: documents.title,
  slug: documents.slug,
  excerpt: documents.excerpt,
  plainHead: sql<string>`left(${documents.plainText}, 600)`,
  typeId: documents.typeId,
  status: documents.status,
  visibility: documents.visibility,
  publishedAt: documents.publishedAt,
  modifiedAt: documents.modifiedAt,
  readingMinutes: documents.readingMinutes,
  featured: documents.featured,
  priority: documents.priority,
  featuredMediaId: documents.featuredMediaId,
  properties: documents.properties,
};

type CardRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  plainHead: string;
  typeId: string;
  status: string;
  visibility: string;
  publishedAt: Date | null;
  modifiedAt: Date | null;
  readingMinutes: number;
  featured: boolean;
  priority: number;
  featuredMediaId: string | null;
  properties: unknown;
};

function cardMeta(type: ContentType, props: Properties): string | null {
  const pick = (role: string) => {
    const v = valueByRole(type.fields, props, role);
    return typeof v === "string" && v ? v : null;
  };
  const event = pick("eventName");
  if (event) return event;
  const period = pick("period");
  if (period) return period;
  const status = pick("projectStatus");
  if (status) return type.fields.find((f) => f.role === "projectStatus")?.options.choices?.find((c) => c.value === status)?.label ?? status;
  const itemAuthor = pick("itemAuthor");
  if (itemAuthor) return `by ${itemAuthor}`;
  const guideField = type.fields.find((f) => f.type === "interview_guide");
  if (guideField) {
    const guide = publicGuide(readGuide(props[guideField.key]));
    const questions = guide.rounds.reduce((n, r) => n + r.questions.length, 0);
    if (questions) return `${guide.rounds.length} ${guide.rounds.length === 1 ? "round" : "rounds"} · ${questions} ${questions === 1 ? "question" : "questions"}`;
    if (guide.accounts) return accountsLabel(guide.accounts);
  }
  return null;
}

/**
 * The collections behind /start-here and /uses are represented by those
 * pages: a link to /collection/{slug} would show the same list a second
 * time. Mapped only while the page itself is public, so a link never 404s.
 */
export async function systemCollectionPaths(ids: string[]): Promise<Map<string, string>> {
  const { pages } = await loadAllSettings();
  const out = new Map<string, string>();
  for (const [id, slug] of [
    [pages.startHereCollectionId, "start-here"],
    [pages.usesCollectionId, "uses"],
  ] as const) {
    if (id && ids.includes(id) && (await getRootPage(slug))) out.set(id, `/${slug}`);
  }
  return out;
}

async function hydrateCards(rows: CardRow[]): Promise<Card[]> {
  if (!rows.length) return [];
  const types = await listContentTypes();
  const typeById = new Map(types.map((t) => [t.id, t]));
  const ids = rows.map((r) => r.id);
  // Featured image, else a cover-image property (e.g. a book cover).
  const imageIdByDoc = new Map<string, string>();
  for (const row of rows) {
    const type = typeById.get(row.typeId);
    const cover = type ? valueByRole(type.fields, (row.properties ?? {}) as Properties, "coverImage") : undefined;
    const imageId = row.featuredMediaId ?? (typeof cover === "string" && isUuid(cover) ? cover : null);
    if (imageId) imageIdByDoc.set(row.id, imageId);
  }

  const [primaryRows, assets, systemPaths] = await Promise.all([
    getDb()
      .select({ documentId: documentCategories.documentId, isPrimary: documentCategories.isPrimary, name: categories.name, slug: categories.slug, accent: categories.accent })
      .from(documentCategories)
      .innerJoin(categories, eq(categories.id, documentCategories.categoryId))
      .where(and(inArray(documentCategories.documentId, ids), sql`${categories.archivedAt} is null`)),
    getMediaAssets([...imageIdByDoc.values()]),
    systemCollectionPaths(ids),
  ]);

  const primaryByDoc = new Map<string, { name: string; slug: string; accent: string | null }>();
  for (const row of primaryRows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))) {
    if (!primaryByDoc.has(row.documentId)) primaryByDoc.set(row.documentId, { name: row.name, slug: row.slug, accent: row.accent });
  }

  return rows.flatMap((row) => {
    const type = typeById.get(row.typeId);
    if (!type) return [];
    const props = (row.properties ?? {}) as Properties;
    const videoUrl = valueByRole(type.fields, props, "videoUrl");
    const imageId = imageIdByDoc.get(row.id);
    const image = (imageId && assets.get(imageId)) || null;
    return [
      {
        id: row.id,
        title: row.title || "Untitled",
        path: systemPaths.get(row.id) ?? documentPath(type, row.slug),
        excerpt: row.excerpt || autoExcerpt(row.plainHead),
        status: isDocumentStatus(row.status) ? row.status : "draft",
        type: { id: type.id, name: type.name, slug: type.slug, template: type.template, icon: type.icon, pluralName: type.pluralName, schemaType: type.schemaType },
        publishedAt: row.publishedAt?.toISOString() ?? null,
        modifiedAt: row.modifiedAt?.toISOString() ?? null,
        readingMinutes: row.readingMinutes,
        featured: row.featured,
        image,
        videoId: typeof videoUrl === "string" ? parseYouTubeId(videoUrl) : null,
        primaryCategory: primaryByDoc.get(row.id) ?? null,
        meta: cardMeta(type, props),
      } satisfies Card,
    ];
  });
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type ListOptions = {
  typeIds?: string[];
  categoryIds?: string[];
  tagIds?: string[];
  featured?: boolean;
  excludeIds?: string[];
  limit?: number;
  offset?: number;
  order?: "recent" | "curated" | "oldest" | "library" | "shortest";
  /** Order by a property key (validated against the type's fields by callers). */
  propertyOrder?: { key: string; direction: "asc" | "desc" };
  /**
   * Only documents matching one of these (type, property ∈ values) pairs — e.g.
   * projects whose status is "building". Given but empty, nothing matches.
   */
  propertyIn?: Array<{ typeId: string; key: string; values: string[] }>;
  /** Standalone pages (/about, /contact…) are excluded from general lists unless asked for. */
  includePages?: boolean;
};

/** Property keys are interpolated as JSON keys; only plain field keys are allowed. */
const PROPERTY_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;

function listConditions(options: ListOptions, pageTypeIds: string[]): SQL {
  const where: SQL[] = [listedSql()];
  const typeIds = (options.typeIds ?? []).filter(isUuid);
  if (typeIds.length) where.push(inArray(documents.typeId, typeIds));
  else if (!options.includePages && pageTypeIds.length) where.push(notInArray(documents.typeId, pageTypeIds));
  const categoryIds = (options.categoryIds ?? []).filter(isUuid);
  if (categoryIds.length) {
    where.push(
      inArray(
        documents.id,
        getDb().select({ id: documentCategories.documentId }).from(documentCategories).where(inArray(documentCategories.categoryId, categoryIds)),
      ),
    );
  }
  const tagIds = (options.tagIds ?? []).filter(isUuid);
  if (tagIds.length) {
    where.push(inArray(documents.id, getDb().select({ id: documentTags.documentId }).from(documentTags).where(inArray(documentTags.tagId, tagIds))));
  }
  if (options.featured) where.push(eq(documents.featured, true));
  if (options.propertyIn) {
    const pairs = options.propertyIn.filter((p) => isUuid(p.typeId) && PROPERTY_KEY.test(p.key) && p.values.length);
    where.push(
      pairs.length ? or(...pairs.map((p) => and(eq(documents.typeId, p.typeId), inArray(sql`${documents.properties} ->> ${p.key}`, p.values))))! : sql`false`,
    );
  }
  const exclude = (options.excludeIds ?? []).filter(isUuid);
  if (exclude.length) where.push(notInArray(documents.id, exclude));
  return and(...where)!;
}

/** ORDER BY for a property-ordered list (timelines, talks); null when the key isn't a safe field key. */
function propertyOrderSql(order: ListOptions["propertyOrder"]): SQL[] | null {
  if (!order || !PROPERTY_KEY.test(order.key)) return null;
  return [sql`${documents.properties} ->> ${order.key} ${order.direction === "asc" ? sql`asc` : sql`desc`} nulls last`, desc(documents.publishedAt)];
}

export async function listPublished(options: ListOptions = {}): Promise<{ items: Card[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 12, 1), 100);
  const pageTypeIds = (await listContentTypes()).filter((t) => t.routing === "root").map((t) => t.id);
  const where = listConditions(options, pageTypeIds);
  const order: SQL[] =
    propertyOrderSql(options.propertyOrder) ??
    (options.order === "shortest"
      ? [sql`case when ${documents.readingMinutes} > 0 then 0 else 1 end`, asc(documents.readingMinutes), sql`${documents.publishedAt} desc nulls last`, asc(documents.id)]
      : options.order === "library"
      ? [desc(documents.featured), desc(documents.priority), asc(documents.title), asc(documents.id)]
      : options.order === "curated"
      ? [desc(documents.featured), desc(documents.priority), desc(documents.publishedAt)]
      : options.order === "oldest"
        ? [asc(documents.publishedAt)]
        : [sql`${documents.publishedAt} desc nulls last`, desc(documents.createdAt)]);

  const db = getDb();
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select(cardColumns)
      .from(documents)
      .where(where)
      .orderBy(...order)
      .limit(limit)
      .offset(Math.max(options.offset ?? 0, 0)),
    db.select({ total: count() }).from(documents).where(where),
  ]);
  return { items: await hydrateCards(rows), total: Number(total) };
}

/** Cards for specific ids, in the given order. Explicit references allow unlisted (accessible) docs. */
export async function cardsByIds(ids: string[], mode: "accessible" | "listed" = "accessible"): Promise<Card[]> {
  const wanted = [...new Set(ids.filter(isUuid))];
  if (!wanted.length) return [];
  const rows = await getDb()
    .select(cardColumns)
    .from(documents)
    .where(and(inArray(documents.id, wanted), mode === "listed" ? listedSql() : accessibleSql()));
  const cards = await hydrateCards(rows);
  const byId = new Map(cards.map((c) => [c.id, c]));
  return wanted.map((id) => byId.get(id)).filter((c): c is Card => Boolean(c));
}

// ---------------------------------------------------------------------------
// Single document
// ---------------------------------------------------------------------------

export type PublicDocument = Card & {
  slug: string;
  visibility: Visibility;
  content: Doc;
  properties: Properties;
  fullType: ContentType;
  categories: Array<Pick<Category, "id" | "name" | "slug" | "accent" | "parentId">>;
  tags: Array<Pick<Tag, "id" | "name" | "slug">>;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  robotsIndex: "default" | "index" | "noindex";
  wordCount: number;
  templateOverride: string | null;
  createdAt: string;
  updatedAt: string;
};

async function loadPublicDocument(where: SQL, options: { adminPreview?: boolean } = {}): Promise<PublicDocument | null> {
  const db = getDb();
  const [row] = await db
    .select({
      ...cardColumns,
      content: documents.content,
      seoTitle: documents.seoTitle,
      seoDescription: documents.seoDescription,
      canonicalUrl: documents.canonicalUrl,
      robotsIndex: documents.robotsIndex,
      wordCount: documents.wordCount,
      templateOverride: documents.templateOverride,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(options.adminPreview ? where : and(where, accessibleSql()))
    .limit(1);
  if (!row || (!options.adminPreview && !isAccessible(row))) return null;
  const [card] = await hydrateCards([row]);
  const type = (await listContentTypes()).find((t) => t.id === row.typeId);
  if (!card || !type) return null;

  const [cats, tagRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name, slug: categories.slug, accent: categories.accent, parentId: categories.parentId, isPrimary: documentCategories.isPrimary })
      .from(documentCategories)
      .innerJoin(categories, eq(categories.id, documentCategories.categoryId))
      .where(and(eq(documentCategories.documentId, row.id), sql`${categories.archivedAt} is null`)),
    db
      .select({ id: tags.id, name: tags.name, slug: tags.slug })
      .from(documentTags)
      .innerJoin(tags, eq(tags.id, documentTags.tagId))
      .where(eq(documentTags.documentId, row.id))
      .orderBy(asc(tags.name)),
  ]);

  return {
    ...card,
    slug: row.slug,
    visibility: row.visibility === "unlisted" ? "unlisted" : row.visibility === "private" ? "private" : "public",
    content: sanitizeDoc(row.content),
    properties: (row.properties ?? {}) as Properties,
    fullType: type,
    categories: cats
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map((c) => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, accent: isAccent(c.accent) ? c.accent : null })),
    tags: tagRows,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    canonicalUrl: row.canonicalUrl,
    robotsIndex: row.robotsIndex === "index" || row.robotsIndex === "noindex" ? row.robotsIndex : "default",
    wordCount: row.wordCount,
    templateOverride: row.templateOverride,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * ADMIN PREVIEW ONLY: load any document regardless of status/visibility.
 * Callers must have asserted an admin actor (see services/preview.ts).
 */
export async function loadDocumentUnfilteredForPreview(id: string): Promise<PublicDocument | null> {
  if (!isUuid(id)) return null;
  return loadPublicDocument(eq(documents.id, id), { adminPreview: true });
}

/** /{typeSlug}/{slug} */
export const getDocumentByTypeAndSlug = cache(async (typeSlug: string, slug: string): Promise<PublicDocument | null> => {
  if (!isValidSlug(typeSlug) || !isValidSlug(slug)) return null;
  const type = (await listContentTypes()).find((t) => t.slug === typeSlug && t.routing === "type");
  if (!type) return null;
  return loadPublicDocument(and(eq(documents.typeId, type.id), eq(documents.slug, slug))!);
});

/** /{slug} for root-routed types (standalone pages, including system pages). */
export const getRootPage = cache(async (slug: string): Promise<PublicDocument | null> => {
  if (!isValidSlug(slug)) return null;
  const rootTypes = (await listContentTypes()).filter((t) => t.routing === "root");
  if (!rootTypes.length) return null;
  return loadPublicDocument(and(inArray(documents.typeId, rootTypes.map((t) => t.id)), eq(documents.slug, slug))!);
});

// ---------------------------------------------------------------------------
// Connections around a document
// ---------------------------------------------------------------------------

export type Connection = { kind: RelationKind; direction: "outgoing" | "incoming"; note: string; card: Card };

/**
 * Outgoing relations (manual first) and incoming backlinks. Only LISTED
 * documents appear, so a private or draft document can never be revealed
 * through a relationship - even if the relation row exists.
 */
export async function getConnections(documentId: string): Promise<{ outgoing: Connection[]; incoming: Connection[] }> {
  const db = getDb();
  const [outRows, inRows] = await Promise.all([
    db
      .select({ targetId: documentRelations.targetId, kind: documentRelations.kind, note: documentRelations.note, origin: documentRelations.origin, position: documentRelations.position })
      .from(documentRelations)
      .innerJoin(documents, eq(documents.id, documentRelations.targetId))
      .where(and(eq(documentRelations.sourceId, documentId), listedSql())),
    db
      .select({ sourceId: documentRelations.sourceId, kind: documentRelations.kind, note: documentRelations.note })
      .from(documentRelations)
      .innerJoin(documents, eq(documents.id, documentRelations.sourceId))
      .where(and(eq(documentRelations.targetId, documentId), listedSql())),
  ]);
  outRows.sort((a, b) => (a.origin === b.origin ? a.position - b.position : a.origin === "manual" ? -1 : 1));
  const cards = new Map((await cardsByIds([...outRows.map((r) => r.targetId), ...inRows.map((r) => r.sourceId)], "listed")).map((c) => [c.id, c]));

  const seenOut = new Set<string>();
  const outgoing = outRows.flatMap((r) => {
    const card = cards.get(r.targetId);
    if (!card || seenOut.has(r.targetId) || !isRelationKind(r.kind)) return [];
    seenOut.add(r.targetId);
    return [{ kind: r.kind, direction: "outgoing" as const, note: r.note, card }];
  });
  const seenIn = new Set<string>();
  const incoming = inRows.flatMap((r) => {
    const card = cards.get(r.sourceId);
    if (!card || seenIn.has(r.sourceId) || seenOut.has(r.sourceId) || !isRelationKind(r.kind)) return [];
    seenIn.add(r.sourceId);
    return [{ kind: r.kind, direction: "incoming" as const, note: r.note, card }];
  });
  return { outgoing, incoming };
}

export type CollectionEntry = { card: Card; groupLabel: string; note: string };

export async function getCollectionEntries(collectionId: string): Promise<CollectionEntry[]> {
  const rows = await getDb()
    .select({ documentId: collectionItems.documentId, groupLabel: collectionItems.groupLabel, note: collectionItems.note })
    .from(collectionItems)
    .where(eq(collectionItems.collectionId, collectionId))
    .orderBy(asc(collectionItems.position));
  const cards = new Map((await cardsByIds(rows.map((r) => r.documentId), "accessible")).map((c) => [c.id, c]));
  return rows.flatMap((r) => {
    const card = cards.get(r.documentId);
    return card ? [{ card, groupLabel: r.groupLabel, note: r.note }] : [];
  });
}

export type SeriesSummary = Card & { parts: number; minutes: number };

/** Listed series (collection-template types; `typeIds` narrows them, e.g. to courses) with their readable part count and total reading time; empty ones are left out. */
export async function listSeries(options: { limit?: number; categoryIds?: string[]; excludeIds?: string[]; typeIds?: string[] } = {}): Promise<SeriesSummary[]> {
  const typeIds = (await listContentTypes())
    .filter((t) => t.template === "collection" && t.routing === "type" && !t.archivedAt && (!options.typeIds || options.typeIds.includes(t.id)))
    .map((t) => t.id);
  if (!typeIds.length) return [];
  const { items } = await listPublished({ typeIds, limit: options.limit ?? 6, order: "curated", categoryIds: options.categoryIds, excludeIds: options.excludeIds });
  if (!items.length) return [];
  const totals = await seriesTotals(items.map((i) => i.id));
  return items.flatMap((card) => {
    const total = totals.get(card.id);
    return total && total.parts > 0 ? [{ ...card, parts: total.parts, minutes: total.minutes }] : [];
  });
}

/** Readable parts and total reading time of each collection, for the ones that have any. */
export async function seriesTotals(ids: string[]): Promise<Map<string, { parts: number; minutes: number }>> {
  if (!ids.length) return new Map();
  const rows = await getDb()
    .select({ id: collectionItems.collectionId, parts: count(), minutes: sql<number>`coalesce(sum(${documents.readingMinutes}), 0)` })
    .from(collectionItems)
    .innerJoin(documents, eq(documents.id, collectionItems.documentId))
    .where(and(inArray(collectionItems.collectionId, ids), accessibleSql()))
    .groupBy(collectionItems.collectionId);
  return new Map(rows.map((r) => [r.id, { parts: Number(r.parts), minutes: Number(r.minutes) }]));
}

/** Listed collections that include this document ("Part of..."), most curated first. */
export async function getCollectionsContaining(documentId: string): Promise<Card[]> {
  const rows = await getDb()
    .select({ id: collectionItems.collectionId })
    .from(collectionItems)
    .innerJoin(documents, eq(documents.id, collectionItems.collectionId))
    .where(and(eq(collectionItems.documentId, documentId), listedSql()))
    .orderBy(desc(documents.featured), desc(documents.priority), sql`${documents.publishedAt} desc nulls last`)
    .limit(6);
  return cardsByIds(rows.map((r) => r.id), "listed");
}

/** Where a document sits inside an ordered collection: "3 of 7", with its neighbours in that order. */
export type SeriesPosition = {
  collection: Card;
  position: number;
  total: number;
  previous: Card | null;
  next: Card | null;
  /** Every piece in the series — already one click away, so never "recommended" beside it. */
  memberIds: string[];
  /** The series' entries in order, with their module (group) labels: what a course's lesson list is built from. */
  entries: CollectionEntry[];
};

/**
 * The document's place in its most curated collection (a course, a reading
 * path, Start here). Entries are exactly what the collection page shows, so
 * the numbering and neighbours always match it. Null when the document isn't
 * in a collection with at least one other item.
 */
export async function getSeriesPosition(documentId: string, collections: Card[]): Promise<SeriesPosition | null> {
  const collection = collections[0];
  if (!collection) return null;
  const entries = await getCollectionEntries(collection.id);
  const index = entries.findIndex((e) => e.card.id === documentId);
  if (index === -1 || entries.length < 2) return null;
  return {
    collection,
    position: index + 1,
    total: entries.length,
    previous: entries[index - 1]?.card ?? null,
    next: entries[index + 1]?.card ?? null,
    memberIds: entries.map((e) => e.card.id),
    entries,
  };
}

/** Resolve mentions / related-content blocks. Only accessible documents resolve. */
export async function resolveReferences(doc: Doc): Promise<Map<string, Card>> {
  const refs = extractReferences(doc);
  return new Map((await cardsByIds(refs.documentIds, "accessible")).map((c) => [c.id, c]));
}

export async function mediaForDoc(doc: Doc, extraIds: Array<string | null | undefined> = []): Promise<Map<string, MediaAsset>> {
  return getMediaAssets([...extractReferences(doc).mediaIds, ...extraIds]);
}

/**
 * Neighbours within the same type, in the order its index shows them.
 * Types with a narrative order (journey chapters by start date, talks by
 * event date) follow that order, so "Next chapter" is the next part of the
 * story rather than whatever was published next. Everything else is by
 * publish date. "Previous" is always the earlier one.
 */
export type Adjacent = {
  previous: Card | null;
  next: Card | null;
  /** Chronological place among its type ("2 of 5"), for types with a narrative order only. */
  place: { position: number; total: number } | null;
};

export async function getAdjacent(doc: Pick<PublicDocument, "id" | "fullType" | "publishedAt">): Promise<Adjacent> {
  const db = getDb();
  const order = typeListOrder(doc.fullType);
  const orderSql = propertyOrderSql(order);
  if (order && orderSql) {
    // Small, bounded sets (timelines, talks): read the ordered ids, then hydrate two cards.
    const rows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(listedSql(), eq(documents.typeId, doc.fullType.id)))
      .orderBy(...orderSql)
      .limit(500);
    const i = rows.findIndex((r) => r.id === doc.id);
    if (i === -1) return { previous: null, next: null, place: null };
    const asc = order.direction === "asc";
    const [earlierId, laterId] = asc ? [rows[i - 1]?.id, rows[i + 1]?.id] : [rows[i + 1]?.id, rows[i - 1]?.id];
    const cards = new Map((await cardsByIds([earlierId, laterId].filter((id): id is string => Boolean(id)), "listed")).map((c) => [c.id, c]));
    return {
      previous: (earlierId && cards.get(earlierId)) || null,
      next: (laterId && cards.get(laterId)) || null,
      place: { position: asc ? i + 1 : rows.length - i, total: rows.length },
    };
  }
  if (!doc.publishedAt) return { previous: null, next: null, place: null };
  const published = new Date(doc.publishedAt);
  const base = and(listedSql(), eq(documents.typeId, doc.fullType.id), ne(documents.id, doc.id));
  const [prev, next] = await Promise.all([
    // Typed operators (not raw sql) so the Date is serialised by the column's mapper on every driver.
    db.select(cardColumns).from(documents).where(and(base, lt(documents.publishedAt, published))).orderBy(desc(documents.publishedAt)).limit(1),
    db.select(cardColumns).from(documents).where(and(base, gt(documents.publishedAt, published))).orderBy(asc(documents.publishedAt)).limit(1),
  ]);
  const [p] = await hydrateCards(prev);
  const [n] = await hydrateCards(next);
  return { previous: p ?? null, next: n ?? null, place: null };
}

// ---------------------------------------------------------------------------
// Taxonomy pages
// ---------------------------------------------------------------------------

export function descendantIds(all: Category[], rootId: string): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) {
    for (const c of all) if (c.parentId === out[i] && !c.archivedAt) out.push(c.id);
  }
  return out;
}

export const publicTagCounts = cache(async (): Promise<Map<string, number>> => {
  const rows = await getDb()
    .select({ id: documentTags.tagId, n: count() })
    .from(documentTags)
    .innerJoin(documents, eq(documents.id, documentTags.documentId))
    .where(listedSql())
    .groupBy(documentTags.tagId);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
});

/** Listed documents per category: categoryId → document ids (one row per filing). */
const publicCategoryMembers = cache(async (): Promise<Map<string, string[]>> => {
  const rows = await getDb()
    .select({ categoryId: documentCategories.categoryId, documentId: documentCategories.documentId })
    .from(documentCategories)
    .innerJoin(documents, eq(documents.id, documentCategories.documentId))
    .where(listedSql());
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.categoryId);
    if (list) list.push(r.documentId);
    else out.set(r.categoryId, [r.documentId]);
  }
  return out;
});

/**
 * Categories with their number of listed documents, sub-categories included.
 * A piece filed under a topic and one of its sub-topics (or under two
 * sub-topics) counts once, as it appears once on the topic page.
 */
export async function visibleCategories(): Promise<Array<Category & { count: number }>> {
  const [all, members] = await Promise.all([listCategories(), publicCategoryMembers()]);
  return all
    .filter((c) => !c.archivedAt)
    .map((c) => ({ ...c, count: new Set(descendantIds(all, c.id).flatMap((id) => members.get(id) ?? [])).size }));
}

export type CategoryPageData = {
  category: Category;
  trail: Category[];
  children: Array<Category & { count: number }>;
  featured: Card[];
  latest: Card[];
  total: number;
  page: number;
  perPage: number;
  byType: Array<{ type: Pick<ContentType, "id" | "name" | "pluralName" | "slug" | "template" | "routing">; count: number }>;
  collections: Card[];
  /** The courses filed under this topic (or its sub-topics), with their lesson counts. */
  courses: SeriesSummary[];
  relatedCategories: Array<Category & { count: number }>;
  topTags: Array<Tag & { count: number }>;
};

export const TAXONOMY_PAGE_SIZE = 18;

export async function getCategoryPageData(category: Category, page = 1): Promise<CategoryPageData> {
  const [all, withCounts, types] = await Promise.all([listCategories(), visibleCategories(), listContentTypes()]);
  const ids = descendantIds(all, category.id);
  const perPage = TAXONOMY_PAGE_SIZE;
  const [featured, latest] = await Promise.all([
    listPublished({ categoryIds: ids, featured: true, limit: 4, order: "curated" }),
    listPublished({ categoryIds: ids, limit: perPage, offset: (page - 1) * perPage }),
  ]);
  const db = getDb();
  const [typeCounts, tagCounts, relatedRows] = await Promise.all([
    db
      .select({ typeId: documents.typeId, n: count() })
      .from(documents)
      .where(and(listedSql(), inArray(documents.id, db.select({ id: documentCategories.documentId }).from(documentCategories).where(inArray(documentCategories.categoryId, ids)))))
      .groupBy(documents.typeId),
    db
      .select({ tagId: documentTags.tagId, n: count() })
      .from(documentTags)
      .innerJoin(documents, eq(documents.id, documentTags.documentId))
      .where(and(listedSql(), inArray(documentTags.documentId, db.select({ id: documentCategories.documentId }).from(documentCategories).where(inArray(documentCategories.categoryId, ids)))))
      .groupBy(documentTags.tagId)
      .orderBy(desc(count()))
      .limit(12),
    // Categories that co-occur on the same listed documents.
    db
      .select({ categoryId: documentCategories.categoryId, n: count() })
      .from(documentCategories)
      .innerJoin(documents, eq(documents.id, documentCategories.documentId))
      .where(
        and(
          listedSql(),
          notInArray(documentCategories.categoryId, ids),
          inArray(documentCategories.documentId, db.select({ id: documentCategories.documentId }).from(documentCategories).where(inArray(documentCategories.categoryId, ids))),
        ),
      )
      .groupBy(documentCategories.categoryId)
      .orderBy(desc(count()))
      .limit(6),
  ]);

  const collectionTypeIds = types.filter((t) => t.template === "collection").map((t) => t.id);
  const collections = collectionTypeIds.length ? (await listPublished({ categoryIds: ids, typeIds: collectionTypeIds, limit: 4 })).items : [];
  const courseTypeIds = types.filter(isCourseType).map((t) => t.id);
  const courses = courseTypeIds.length ? await listSeries({ typeIds: courseTypeIds, categoryIds: ids, limit: 4 }) : [];
  const allTags = await listTags();
  const catById = new Map(withCounts.map((c) => [c.id, c]));

  return {
    category,
    trail: categoryTrailOf(all, category),
    children: withCounts.filter((c) => c.parentId === category.id),
    featured: featured.items,
    latest: latest.items,
    total: latest.total,
    page,
    perPage,
    byType: typeCounts
      .map((r) => ({ type: types.find((t) => t.id === r.typeId)!, count: Number(r.n) }))
      // Root-routed types (standalone pages) have no index to link to.
      .filter((r) => r.type && r.type.routing === "type")
      .sort((a, b) => b.count - a.count),
    collections,
    courses,
    relatedCategories: relatedRows.map((r) => catById.get(r.categoryId)).filter((c): c is Category & { count: number } => Boolean(c && c.count > 0)),
    topTags: tagCounts.map((r) => ({ ...allTags.find((t) => t.id === r.tagId)!, count: Number(r.n) })).filter((t) => t.id),
  };
}

function categoryTrailOf(all: Category[], category: Category): Category[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  const trail = [category];
  let cursor = category.parentId ? byId.get(category.parentId) : undefined;
  for (let i = 0; cursor && i < 3; i++) {
    trail.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return trail;
}

export async function getTagPageData(tag: Tag, page = 1) {
  const perPage = TAXONOMY_PAGE_SIZE;
  const result = await listPublished({ tagIds: [tag.id], limit: perPage, offset: (page - 1) * perPage });
  // Tags that co-occur with this one.
  const db = getDb();
  const related = await db
    .select({ tagId: documentTags.tagId, n: count() })
    .from(documentTags)
    .innerJoin(documents, eq(documents.id, documentTags.documentId))
    .where(and(listedSql(), ne(documentTags.tagId, tag.id), inArray(documentTags.documentId, db.select({ id: documentTags.documentId }).from(documentTags).where(eq(documentTags.tagId, tag.id)))))
    .groupBy(documentTags.tagId)
    .orderBy(desc(count()))
    .limit(10);
  const allTags = await listTags();
  return {
    items: result.items,
    total: result.total,
    page,
    perPage,
    relatedTags: related.map((r) => allTags.find((t) => t.id === r.tagId)).filter((t): t is Tag => Boolean(t)),
  };
}

/** Ordering rule per type: timelines by start date, talks by event date, else newest first. */
export function typeListOrder(type: ContentType): ListOptions["propertyOrder"] | undefined {
  const start = type.fields.find((f) => f.role === "startDate");
  const event = type.fields.find((f) => f.role === "eventDate");
  if (type.template === "story" && start) return { key: start.key, direction: "asc" };
  if (event) return { key: event.key, direction: "desc" };
  return undefined;
}

export async function getTypeIndexData(type: ContentType, page = 1) {
  const perPage = type.template === "story" ? 100 : 24;
  const result = await listPublished({ typeIds: [type.id], limit: perPage, offset: (page - 1) * perPage, propertyOrder: typeListOrder(type) });
  return { ...result, perPage };
}
/** Topic tree for the directory: roots with content, their children and grandchildren with counts. */
export async function getTopicDirectory() {
  const topics = (await visibleCategories()).filter((t) => t.count > 0);
  const childrenOf = (id: string) => topics.filter((c) => c.parentId === id);
  const roots = topics.filter((t) => !t.parentId);
  const latest = await Promise.all(roots.map((root) => listPublished({ categoryIds: descendantIds(topics, root.id), limit: 2, order: "curated" }).then((r) => r.items)));
  return roots.map((root, i) => ({ topic: root, children: childrenOf(root.id).map((child) => ({ topic: child, children: childrenOf(child.id) })), picks: latest[i] ?? [] }));
}

/** Public content types that currently have listed documents, with counts. */
export const publicTypeCounts = cache(async (): Promise<Map<string, number>> => {
  const rows = await getDb().select({ typeId: documents.typeId, n: count() }).from(documents).where(listedSql()).groupBy(documents.typeId);
  return new Map(rows.map((r) => [r.typeId, Number(r.n)]));
});

export type { Category, Tag, ContentType };
