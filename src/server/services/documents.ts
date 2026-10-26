import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ContentTooLargeError, docFromText, isUuid, sanitizeDoc, type Doc } from "@/lib/content/blocks";
import { deriveContent, extractReferences, hasPlaceholderContent, hasPlaceholderText } from "@/lib/content/derive";
import { isDocumentStatus, isRelationKind, isTemplate, isVisibility, ROBOTS_OPTIONS, TRASHED, type DocumentStatus, type RelationKind, type StoredStatus } from "@/lib/content/model";
import { documentPath } from "@/lib/content/paths";
import { validateProperties, type Properties } from "@/lib/content/properties";
import { isValidSlug, slugify } from "@/lib/slug";
import { safeExternalUrl } from "@/lib/url";
import { assertAdmin, type Actor, type AdminActor } from "../auth/actor";
import { getDb, type Db } from "../db/client";
import {
  categories,
  collectionItems,
  contentTypes,
  documentCategories,
  documentRelations,
  documents,
  documentTags,
  media,
  tags,
  users,
  type DocumentRow,
} from "../db/schema";
import { siteUrl } from "../env";
import { conflict, invalid, notFound, ServiceError } from "../errors";
import { recordAudit } from "./audit";
import { loadContentTypes, type ContentType } from "./content-types";
import { assertRootSlugAvailable } from "./namespace";
import { healthCondition, isHealthCheck } from "./content-health";
import { clearRedirectFrom, upsertRedirect } from "./redirects";
import { refreshSearchExtra } from "./search-index";
import { ensureTags } from "./taxonomy";
import { isAccessible, isListed } from "./visibility";
import { clampInt } from "@/lib/numbers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditableBody = {
  title: string;
  excerpt: string;
  content: Doc;
  properties: Properties;
  featuredMediaId: string | null;
};

export type WorkingCopy = EditableBody & { savedAt: string };

export type AdminDocument = Omit<DocumentRow, "content" | "properties" | "workingCopy" | "searchVector" | "status" | "visibility"> & {
  status: StoredStatus;
  visibility: "private" | "unlisted" | "public";
  content: Doc;
  properties: Properties;
  workingCopy: WorkingCopy | null;
  type: Pick<ContentType, "id" | "name" | "slug" | "template" | "routing" | "icon" | "fields" | "schemaType" | "indexable">;
  path: string;
  categories: Array<{ id: string; name: string; slug: string; isPrimary: boolean }>;
  tags: Array<{ id: string; name: string; slug: string }>;
  relations: Array<{ id: string; targetId: string; kind: RelationKind; note: string; target: DocumentSummary }>;
  collectionItems: Array<{ documentId: string; groupLabel: string; note: string; document: DocumentSummary }>;
  backlinks: Array<{ sourceId: string; kind: RelationKind; source: DocumentSummary }>;
};

export type DocumentSummary = {
  id: string;
  title: string;
  slug: string;
  status: string;
  visibility: string;
  typeId: string;
  typeName: string;
  typeSlug: string;
  path: string;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_TITLE = 300;

function sanitizeBodyContent(input: unknown): Doc {
  try {
    return sanitizeDoc(input);
  } catch (error) {
    if (error instanceof ContentTooLargeError) throw new ServiceError("too_large", error.message);
    throw error;
  }
}

export async function requireType(db: Db, typeId: string): Promise<ContentType> {
  const type = (await loadContentTypes(db)).find((t) => t.id === typeId);
  if (!type) throw invalid("Unknown content type.");
  return type;
}

/**
 * `lock` takes a row lock (SELECT … FOR NO KEY UPDATE) that lasts until the transaction ends. Writers that
 * check-then-write (the autosave version check, lifecycle actions) need it: under READ COMMITTED two
 * overlapping requests could otherwise both pass the check and the later write would silently win.
 * NO KEY UPDATE, not UPDATE: it still excludes other writers of this row but does not conflict with the
 * FOR KEY SHARE that foreign keys take, so two documents inserting relations to each other cannot deadlock.
 */
export async function loadRow(db: Db, id: string, options: { lock?: boolean; editable?: boolean } = {}): Promise<DocumentRow> {
  if (!isUuid(id)) throw notFound("Document");
  const query = db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const [row] = await (options.lock ? query.for("no key update") : query);
  if (!row) throw notFound("Document");
  if (options.editable) assertNotTrashed(row);
  return row;
}

/** Trashed documents are frozen until restored, so the Trash stays a faithful snapshot. */
export function assertNotTrashed(row: Pick<DocumentRow, "status">): void {
  if (row.status === TRASHED) throw conflict("This document is in the Trash. Restore it before changing it.");
}

export async function uniqueSlug(db: Db, type: ContentType, base: string, excludeId?: string): Promise<string> {
  const root = isValidSlug(base) ? base : slugify(base);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root.slice(0, 90)}-${attempt + 1}`;
    const clash = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.typeId, type.id), eq(documents.slug, candidate), excludeId ? ne(documents.id, excludeId) : sql`true`))
      .limit(1);
    if (clash.length) continue;
    if (type.routing === "root") {
      try {
        await assertRootSlugAvailable(db, candidate, { kind: "page", id: excludeId });
      } catch {
        continue;
      }
    }
    return candidate;
  }
  return `${root.slice(0, 80)}-${Date.now().toString(36)}`;
}

async function assertMediaExists(db: Db, ids: Array<string | null | undefined>): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => isUuid(id)))];
  if (!wanted.length) return;
  const found = await db.select({ id: media.id }).from(media).where(inArray(media.id, wanted));
  if (found.length !== wanted.length) throw invalid("A referenced media file does not exist.");
}

async function existingDocumentIds(db: Db, ids: string[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter(isUuid))];
  if (!wanted.length) return new Set();
  const rows = await db.select({ id: documents.id }).from(documents).where(inArray(documents.id, wanted));
  return new Set(rows.map((r) => r.id));
}

function mediaFieldIds(type: ContentType, properties: Properties): string[] {
  return type.fields
    .filter((f) => f.type === "image" || f.type === "file")
    .map((f) => properties[f.key])
    .filter((v): v is string => typeof v === "string");
}

/** Validates properties against the type; image/file ids must exist. */
async function validateBodyProperties(db: Db, type: ContentType, raw: unknown, mode: "draft" | "publish"): Promise<Properties> {
  const { values, errors } = validateProperties(type.fields, raw, mode);
  if (Object.keys(errors).length) throw invalid("Some properties are invalid.", errors);
  await assertMediaExists(db, mediaFieldIds(type, values));
  return values;
}

/** Resolve internal paths (/article/x, /about) linked from content to document ids. */
async function resolveInternalPaths(db: Db, paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const types = await loadContentTypes(db);
  const conditions: SQL[] = [];
  for (const path of paths.slice(0, 200)) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 2) {
      const type = types.find((t) => t.slug === parts[0] && t.routing === "type");
      if (type && isValidSlug(parts[1])) conditions.push(and(eq(documents.typeId, type.id), eq(documents.slug, parts[1]!))!);
    } else if (parts.length === 1 && isValidSlug(parts[0])) {
      for (const type of types.filter((t) => t.routing === "root")) {
        conditions.push(and(eq(documents.typeId, type.id), eq(documents.slug, parts[0]!))!);
      }
    }
  }
  if (!conditions.length) return [];
  const rows = await db.select({ id: documents.id }).from(documents).where(or(...conditions));
  return rows.map((r) => r.id);
}

/**
 * Rebuild the 'content'-origin relations of a document from its LIVE body:
 * mentions, related-content blocks, internal links and relation properties.
 * This is what makes backlinks automatic.
 */
async function syncContentRelations(db: Db, docId: string, type: ContentType, content: Doc, properties: Properties): Promise<void> {
  const refs = extractReferences(content, siteUrl());
  const linked = await resolveInternalPaths(db, refs.internalPaths);
  const wanted = new Map<string, RelationKind>();
  for (const id of [...refs.documentIds, ...linked]) wanted.set(id, "references");
  for (const field of type.fields.filter((f) => f.type === "relation")) {
    const value = properties[field.key];
    const ids = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    for (const id of ids) if (isUuid(id)) wanted.set(id, field.options.relationKind ?? "related");
  }
  wanted.delete(docId);
  const existing = await existingDocumentIds(db, [...wanted.keys()]);

  await db.delete(documentRelations).where(and(eq(documentRelations.sourceId, docId), eq(documentRelations.origin, "content")));
  const rows = [...wanted.entries()]
    .filter(([id]) => existing.has(id))
    .map(([targetId, kind], position) => ({ sourceId: docId, targetId, kind, origin: "content" as const, position }));
  if (rows.length) await db.insert(documentRelations).values(rows).onConflictDoNothing();
}

async function applyLiveBody(db: Db, row: DocumentRow, type: ContentType, body: EditableBody, extra: Partial<typeof documents.$inferInsert> = {}) {
  const derived = deriveContent(body.content);
  await db
    .update(documents)
    .set({
      title: body.title,
      excerpt: body.excerpt,
      content: body.content,
      properties: body.properties,
      featuredMediaId: body.featuredMediaId,
      plainText: derived.plainText,
      wordCount: derived.wordCount,
      readingMinutes: derived.readingMinutes,
      updatedAt: new Date(),
      version: sql`${documents.version} + 1`,
      ...extra,
    })
    .where(eq(documents.id, row.id));
  await syncContentRelations(db, row.id, type, body.content, body.properties);
  await refreshSearchExtra(db, [row.id]);
}

function liveBody(row: DocumentRow): EditableBody {
  return {
    title: row.title,
    excerpt: row.excerpt,
    content: sanitizeDoc(row.content),
    properties: (row.properties ?? {}) as Properties,
    featuredMediaId: row.featuredMediaId,
  };
}

function parseWorkingCopy(raw: unknown): WorkingCopy | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Partial<WorkingCopy>;
  return {
    title: typeof w.title === "string" ? w.title : "",
    excerpt: typeof w.excerpt === "string" ? w.excerpt : "",
    content: sanitizeDoc(w.content),
    properties: w.properties && typeof w.properties === "object" ? (w.properties as Properties) : {},
    featuredMediaId: isUuid(w.featuredMediaId) ? w.featuredMediaId : null,
    savedAt: typeof w.savedAt === "string" ? w.savedAt : new Date().toISOString(),
  };
}

/** Runs work in a transaction; deferred tasks (audit entries) run only after commit. */
async function inTransaction<T>(db: Db, fn: (tx: Db, defer: (task: () => Promise<void>) => void) => Promise<T>): Promise<T> {
  const tasks: Array<() => Promise<void>> = [];
  const result = await db.transaction((tx) => fn(tx, (task) => tasks.push(task)));
  for (const task of tasks) await task();
  return result;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const createSchema = z.object({
  typeId: z.string().refine(isUuid, "Choose a content type."),
  title: z.string().trim().max(MAX_TITLE).default(""),
  status: z.enum(["idea", "draft"]).default("draft"),
  thought: z.string().max(20000).optional(),
  categoryIds: z.array(z.string()).max(20).optional(),
  tagNames: z.array(z.string()).max(30).optional(),
});

export async function createDocument(actor: Actor, input: unknown): Promise<{ id: string }> {
  assertAdmin(actor);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid document.");
  const data = parsed.data;
  const db = getDb();
  const type = await requireType(db, data.typeId);

  const id = await db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, type, data.title ? slugify(data.title) : `untitled-${Date.now().toString(36)}`);
    const content = data.thought ? docFromText(data.thought) : { type: "doc" as const, content: [] };
    const derived = deriveContent(content);
    const [row] = await tx
      .insert(documents)
      .values({
        typeId: type.id,
        title: data.title,
        slug,
        status: data.status,
        visibility: "public",
        content,
        plainText: derived.plainText,
        wordCount: derived.wordCount,
        readingMinutes: derived.readingMinutes,
        authorId: actor.userId,
      })
      .returning({ id: documents.id });
    const docId = row!.id;
    if (data.categoryIds?.length || data.tagNames?.length) {
      await writeTaxonomy(actor, tx, docId, { categoryIds: data.categoryIds ?? [], primaryCategoryId: data.categoryIds?.[0] ?? null, tagIds: [], tagNames: data.tagNames ?? [] });
    }
    await refreshSearchExtra(tx, [docId]);
    return docId;
  });
  await recordAudit(actor, "document.create", "document", id, data.title || "Untitled");
  return { id };
}

// ---------------------------------------------------------------------------
// Save (autosave)
// ---------------------------------------------------------------------------

const saveSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  body: z
    .object({
      title: z.string().max(MAX_TITLE).optional(),
      excerpt: z.string().max(600).optional(),
      content: z.unknown().optional(),
      properties: z.unknown().optional(),
      featuredMediaId: z.string().nullable().optional(),
    })
    .optional(),
  settings: z
    .object({
      visibility: z.string().refine(isVisibility).optional(),
      seoTitle: z.string().trim().max(120).nullable().optional(),
      seoDescription: z.string().trim().max(320).nullable().optional(),
      canonicalUrl: z.string().trim().max(2048).nullable().optional(),
      robotsIndex: z.enum(ROBOTS_OPTIONS).optional(),
      featured: z.boolean().optional(),
      priority: z.number().int().min(-100).max(100).optional(),
      templateOverride: z.string().nullable().optional(),
      notes: z.string().max(20000).optional(),
      publishedAt: z.string().nullable().optional(),
    })
    .optional(),
});

export type SaveResult = { version: number; stagedChanges: boolean; affectsPublic: boolean; savedAt: string };

export async function saveDocument(actor: Actor, id: string, input: unknown): Promise<SaveResult> {
  assertAdmin(actor);
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid save.");
  const { body, settings, expectedVersion } = parsed.data;
  const db = getDb();

  return db.transaction(async (tx) => {
    const row = await loadRow(tx, id, { lock: true, editable: true });
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      throw conflict("This document was changed in another tab or window.", { currentVersion: String(row.version) });
    }
    const type = await requireType(tx, row.typeId);
    const wasPublic = isAccessible(row);
    let stagedChanges = row.workingCopy !== null;
    let affectsPublic = false;

    if (body) {
      const base = parseWorkingCopy(row.workingCopy) ?? liveBody(row);
      const next: EditableBody = {
        title: body.title !== undefined ? body.title.trim().slice(0, MAX_TITLE) : base.title,
        excerpt: body.excerpt !== undefined ? body.excerpt.trim() : base.excerpt,
        content: body.content !== undefined ? sanitizeBodyContent(body.content) : base.content,
        properties: body.properties !== undefined ? await validateBodyProperties(tx, type, body.properties, "draft") : base.properties,
        featuredMediaId: body.featuredMediaId !== undefined ? (isUuid(body.featuredMediaId) ? body.featuredMediaId : null) : base.featuredMediaId,
      };
      await assertMediaExists(tx, [next.featuredMediaId]);

      if (row.status === "published") {
        // Published documents never change live on autosave: edits are staged.
        const copy: WorkingCopy = { ...next, savedAt: new Date().toISOString() };
        await tx.update(documents).set({ workingCopy: copy, updatedAt: new Date(), version: sql`${documents.version} + 1` }).where(eq(documents.id, id));
        stagedChanges = true;
      } else {
        await applyLiveBody(tx, row, type, next);
        affectsPublic = affectsPublic || wasPublic;
      }
    }

    if (settings) {
      const patch: Partial<typeof documents.$inferInsert> = {};
      if (settings.visibility !== undefined) patch.visibility = settings.visibility;
      if (settings.seoTitle !== undefined) patch.seoTitle = settings.seoTitle || null;
      if (settings.seoDescription !== undefined) patch.seoDescription = settings.seoDescription || null;
      if (settings.canonicalUrl !== undefined) {
        if (settings.canonicalUrl && !safeExternalUrl(settings.canonicalUrl)) throw invalid("Canonical URL must be an absolute http(s) URL.", { canonicalUrl: "Invalid URL" });
        patch.canonicalUrl = settings.canonicalUrl ? safeExternalUrl(settings.canonicalUrl) : null;
      }
      if (settings.robotsIndex !== undefined) patch.robotsIndex = settings.robotsIndex;
      if (settings.featured !== undefined) patch.featured = settings.featured;
      if (settings.priority !== undefined) patch.priority = settings.priority;
      if (settings.templateOverride !== undefined) patch.templateOverride = isTemplate(settings.templateOverride) ? settings.templateOverride : null;
      if (settings.notes !== undefined) patch.notes = settings.notes;
      if (settings.publishedAt !== undefined) {
        const date = settings.publishedAt ? new Date(settings.publishedAt) : null;
        if (date && Number.isNaN(date.getTime())) throw invalid("Invalid publication date.");
        patch.publishedAt = date;
      }
      if (Object.keys(patch).length) {
        await tx
          .update(documents)
          .set({ ...patch, updatedAt: new Date(), version: sql`${documents.version} + 1` })
          .where(eq(documents.id, id));
        const nowPublic = isAccessible({ status: row.status, visibility: patch.visibility ?? row.visibility });
        // Notes are private and never affect the public site.
        const onlyNotes = Object.keys(patch).every((k) => k === "notes");
        affectsPublic = affectsPublic || (!onlyNotes && (wasPublic || nowPublic));
      }
    }

    const [after] = await tx.select({ version: documents.version }).from(documents).where(eq(documents.id, id));
    return { version: after!.version, stagedChanges, affectsPublic, savedAt: new Date().toISOString() };
  });
}

// ---------------------------------------------------------------------------
// Lifecycle actions
// ---------------------------------------------------------------------------

async function assertPublishable(db: Db, slug: string, type: ContentType, body: EditableBody): Promise<void> {
  const errors: Record<string, string> = {};
  if (!body.title.trim()) errors.title = "A title is required to publish.";
  if (hasPlaceholderText(body.title) || hasPlaceholderText(body.excerpt) || hasPlaceholderContent(body.content)) {
    errors.content = "Replace unfinished [TODO], [ADD IMAGE/VIDEO/SCREENSHOT] or [INSERT CONTENT] prompts before publishing. Your draft is saved.";
  }
  const { errors: propErrors } = validateProperties(type.fields, body.properties, "publish");
  Object.assign(errors, propErrors);
  if (Object.keys(errors).length) throw invalid("This document isn't ready to publish yet.", errors);
  await clearRedirectFrom(db, documentPath(type, slug));
}

/** The placeholder slug createDocument() gives a document that has no title yet. */
const PLACEHOLDER_SLUG = /^untitled-[a-z0-9]+(?:-\d+)?$/;

/**
 * Documents are usually created first and titled afterwards, so they start
 * with a placeholder slug. On first publish — before the URL has ever been
 * public — a placeholder is replaced by a slug derived from the title.
 * Slugs the owner chose, and anything that was ever published, never change.
 */
async function publishSlug(db: Db, row: DocumentRow, type: ContentType, title: string): Promise<string> {
  const neverPublic = !row.publishedAt && row.status !== "published" && row.status !== "archived";
  if (!neverPublic || !PLACEHOLDER_SLUG.test(row.slug) || !title.trim()) return row.slug;
  // Empty fallback: a title with no Latin letters or digits (e.g. Tamil) keeps its slug.
  const fromTitle = slugify(title, "");
  if (!fromTitle || PLACEHOLDER_SLUG.test(fromTitle)) return row.slug;
  return uniqueSlug(db, type, fromTitle, row.id);
}

export type LifecycleAction =
  | { action: "publish" }
  | { action: "discardChanges" }
  | { action: "setStatus"; status: DocumentStatus }
  | { action: "convert"; typeId: string }
  | { action: "derive"; typeId: string; copyContent?: boolean }
  | { action: "duplicate" }
  | { action: "changeSlug"; slug: string };

type ActionResult = { id: string; affectsPublic: boolean; slug?: string; path?: string };

/**
 * `path` is set when the action may have changed the document's URL (publish).
 * `version` is the resulting document's version: actions bump it, and an open
 * editor must send it with its next autosave or that save reads as a conflict.
 */
export async function runDocumentAction(actor: Actor, id: string, input: unknown): Promise<ActionResult & { version?: number }> {
  assertAdmin(actor);
  const result = await applyDocumentAction(actor, id, parseAction(input));
  const [row] = await getDb().select({ version: documents.version }).from(documents).where(eq(documents.id, result.id)).limit(1);
  return { ...result, version: row?.version };
}

async function applyDocumentAction(actor: AdminActor, id: string, action: LifecycleAction): Promise<ActionResult> {
  const db = getDb();

  switch (action.action) {
    case "publish":
      return inTransaction(db, async (tx, defer) => {
        const row = await loadRow(tx, id, { lock: true, editable: true });
        const republish = row.status === "published";
        const { title, slug, path } = await publishRow(tx, row);
        defer(() => recordAudit(actor, republish ? "document.publish_changes" : "document.publish", "document", id, title));
        return { id, affectsPublic: true, slug, path };
      });

    case "discardChanges": {
      const row = await loadRow(db, id, { editable: true });
      await db.update(documents).set({ workingCopy: null, updatedAt: new Date(), version: sql`${documents.version} + 1` }).where(eq(documents.id, id));
      await recordAudit(actor, "document.discard_changes", "document", id, row.title);
      return { id, affectsPublic: false };
    }

    case "setStatus": {
      if (action.status === "published") return applyDocumentAction(actor, id, { action: "publish" });
      const nextStatus = action.status;
      return inTransaction(db, async (tx, defer) => {
        const row = await loadRow(tx, id, { lock: true, editable: true });
        await setRowStatus(tx, row, nextStatus);
        defer(() => recordAudit(actor, `document.status.${nextStatus}`, "document", id, row.title));
        return { id, affectsPublic: isAccessible(row) || isAccessible({ status: nextStatus, visibility: row.visibility }) };
      });
    }

    case "convert":
      return inTransaction(db, async (tx, defer) => {
        const row = await loadRow(tx, id, { lock: true, editable: true });
        const from = await requireType(tx, row.typeId);
        const to = await requireType(tx, action.typeId);
        if (from.id === to.id) return { id, affectsPublic: false };
        const slug = await uniqueSlug(tx, to, row.slug, id);
        const oldPath = documentPath(from, row.slug);
        const newPath = documentPath(to, slug);
        await tx
          .update(documents)
          .set({
            typeId: to.id,
            slug,
            status: row.status === "idea" ? "draft" : row.status,
            templateOverride: null,
            updatedAt: new Date(),
            version: sql`${documents.version} + 1`,
          })
          .where(eq(documents.id, id));
        if (isAccessible(row) && oldPath !== newPath) {
          await upsertRedirect(tx, { fromPath: oldPath, toPath: newPath, source: "slug-change" });
        }
        await clearRedirectFrom(tx, newPath);
        await refreshSearchExtra(tx, [id]);
        defer(() => recordAudit(actor, "document.convert", "document", id, `${from.name} → ${to.name}`));
        return { id, affectsPublic: isAccessible(row) };
      });

    case "derive":
      return inTransaction(db, async (tx, defer) => {
        const row = await loadRow(tx, id, { editable: true });
        const to = await requireType(tx, action.typeId);
        const slug = await uniqueSlug(tx, to, row.slug);
        const content = action.copyContent ? sanitizeDoc(row.content) : { type: "doc" as const, content: [] };
        const derived = deriveContent(content);
        const [created] = await tx
          .insert(documents)
          .values({
            typeId: to.id,
            title: row.title,
            slug,
            status: "draft",
            visibility: "public",
            excerpt: row.excerpt,
            content,
            plainText: derived.plainText,
            wordCount: derived.wordCount,
            readingMinutes: derived.readingMinutes,
            authorId: actor.userId,
          })
          .returning({ id: documents.id });
        const newId = created!.id;
        await copyTaxonomy(tx, id, newId);
        await tx.insert(documentRelations).values({ sourceId: newId, targetId: id, kind: "derived_from", origin: "manual" }).onConflictDoNothing();
        await refreshSearchExtra(tx, [newId]);
        defer(() => recordAudit(actor, "document.derive", "document", newId, `Derived ${to.name} from ${row.title}`));
        return { id: newId, affectsPublic: false };
      });

    case "duplicate":
      return inTransaction(db, async (tx, defer) => {
        const row = await loadRow(tx, id, { editable: true });
        const newId = await duplicateRow(tx, row);
        defer(() => recordAudit(actor, "document.duplicate", "document", newId, row.title));
        return { id: newId, affectsPublic: false };
      });

    case "changeSlug":
      return inTransaction(db, async (tx, defer) => {
        const row = await loadRow(tx, id, { lock: true, editable: true });
        const type = await requireType(tx, row.typeId);
        const slug = action.slug.trim();
        if (!isValidSlug(slug)) throw invalid("Use lowercase letters, numbers and single hyphens.", { slug: "Invalid URL slug" });
        if (slug === row.slug) return { id, affectsPublic: false };
        const [clash] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.typeId, type.id), eq(documents.slug, slug), ne(documents.id, id)))
          .limit(1);
        if (clash) throw conflict(`Another ${type.name.toLowerCase()} already uses that URL.`, { slug: "Already in use" });
        if (type.routing === "root") await assertRootSlugAvailable(tx, slug, { kind: "page", id });
        const oldPath = documentPath(type, row.slug);
        const newPath = documentPath(type, slug);
        await tx.update(documents).set({ slug, updatedAt: new Date(), version: sql`${documents.version} + 1` }).where(eq(documents.id, id));
        // Any URL that was ever public keeps working via a permanent redirect.
        if (row.publishedAt || isAccessible(row)) await upsertRedirect(tx, { fromPath: oldPath, toPath: newPath, source: "slug-change" });
        await clearRedirectFrom(tx, newPath);
        defer(() => recordAudit(actor, "document.change_slug", "document", id, `${oldPath} → ${newPath}`));
        return { id, affectsPublic: isAccessible(row) };
      });
  }
}

// ---------------------------------------------------------------------------
// Row-level lifecycle primitives, shared by the single-document actions above
// and the bulk operations (services/content-ops.ts). Callers hold the row lock
// inside their own transaction and record the audit entry themselves.
// ---------------------------------------------------------------------------

/** Publish (or publish the staged changes of) a locked row. Throws `invalid` with field details when it isn't ready. */
export async function publishRow(tx: Db, row: DocumentRow): Promise<{ title: string; slug: string; path: string }> {
  assertNotTrashed(row);
  const type = await requireType(tx, row.typeId);
  const body = parseWorkingCopy(row.workingCopy) ?? liveBody(row);
  const slug = await publishSlug(tx, row, type, body.title);
  await assertPublishable(tx, slug, type, body);
  body.properties = await validateBodyProperties(tx, type, body.properties, "draft");
  const now = new Date();
  const republish = row.status === "published";
  await applyLiveBody(tx, row, type, body, {
    status: "published",
    workingCopy: null,
    publishedAt: row.publishedAt ?? now,
    modifiedAt: republish || row.publishedAt ? now : null,
    ...(slug !== row.slug ? { slug } : {}),
  });
  return { title: body.title, slug, path: documentPath(type, slug) };
}

/**
 * Move a locked row to a non-published editorial status. Leaving "published"
 * (or the Trash) folds staged edits into the live body so nothing is lost;
 * `folded` reports that, because such a change can't be undone exactly.
 */
export async function setRowStatus(tx: Db, row: DocumentRow, next: Exclude<DocumentStatus, "published">): Promise<{ folded: boolean }> {
  const copy = row.status === "published" || row.status === TRASHED ? parseWorkingCopy(row.workingCopy) : null;
  const leaveTrash = row.status === TRASHED ? { trashedAt: null, trashedBy: null } : {};
  if (copy) {
    const type = await requireType(tx, row.typeId);
    await applyLiveBody(tx, row, type, copy, { status: next, workingCopy: null, ...leaveTrash });
    return { folded: true };
  }
  await tx
    .update(documents)
    .set({ status: next, ...leaveTrash, updatedAt: new Date(), version: sql`${documents.version} + 1` })
    .where(eq(documents.id, row.id));
  return { folded: false };
}

/** Move a locked row to the Trash. Body, staged edits, links, topics and slug are kept, so a restore is lossless. */
export async function trashRow(tx: Db, row: DocumentRow, actor: AdminActor): Promise<void> {
  await tx
    .update(documents)
    .set({ status: TRASHED, trashedAt: new Date(), trashedBy: actor.userId, updatedAt: new Date(), version: sql`${documents.version} + 1` })
    .where(eq(documents.id, row.id));
}

/**
 * A new draft copied from `row`. It never reuses the id, slug, publication
 * dates or SEO identity (canonical URL, SEO title and description) of the
 * source and is never featured, so a published copy can't compete with its
 * original in search results or on the home page.
 */
export async function duplicateRow(tx: Db, row: DocumentRow): Promise<string> {
  assertNotTrashed(row);
  const type = await requireType(tx, row.typeId);
  const slug = await uniqueSlug(tx, type, `${row.slug}-copy`);
  const { id: _omit, searchVector: _sv, createdAt: _c, updatedAt: _u, ...rest } = row;
  void _omit;
  void _sv;
  void _c;
  void _u;
  const [created] = await tx
    .insert(documents)
    .values({
      ...rest,
      slug,
      title: `${row.title} (copy)`,
      status: "draft",
      publishedAt: null,
      modifiedAt: null,
      workingCopy: null,
      version: 1,
      canonicalUrl: null,
      seoTitle: null,
      seoDescription: null,
      featured: false,
      trashedAt: null,
      trashedBy: null,
    })
    .returning({ id: documents.id });
  const newId = created!.id;
  await copyTaxonomy(tx, row.id, newId);
  const rels = await tx.select().from(documentRelations).where(and(eq(documentRelations.sourceId, row.id), eq(documentRelations.origin, "manual")));
  if (rels.length) {
    await tx
      .insert(documentRelations)
      .values(rels.map((r) => ({ sourceId: newId, targetId: r.targetId, kind: r.kind, note: r.note, position: r.position, origin: "manual" })))
      .onConflictDoNothing();
  }
  await refreshSearchExtra(tx, [newId]);
  return newId;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish") }),
  z.object({ action: z.literal("discardChanges") }),
  z.object({ action: z.literal("setStatus"), status: z.string().refine(isDocumentStatus, "Unknown status.") }),
  z.object({ action: z.literal("convert"), typeId: z.string().refine(isUuid, "Choose a content type.") }),
  z.object({ action: z.literal("derive"), typeId: z.string().refine(isUuid, "Choose a content type."), copyContent: z.boolean().optional() }),
  z.object({ action: z.literal("duplicate") }),
  z.object({ action: z.literal("changeSlug"), slug: z.string().max(96) }),
]);

function parseAction(input: unknown): LifecycleAction {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Unknown action.");
  return parsed.data as LifecycleAction;
}

async function copyTaxonomy(db: Db, fromId: string, toId: string): Promise<void> {
  const [cats, tagRows] = await Promise.all([
    db.select().from(documentCategories).where(eq(documentCategories.documentId, fromId)),
    db.select().from(documentTags).where(eq(documentTags.documentId, fromId)),
  ]);
  if (cats.length) await db.insert(documentCategories).values(cats.map((c) => ({ ...c, documentId: toId }))).onConflictDoNothing();
  if (tagRows.length) await db.insert(documentTags).values(tagRows.map((t) => ({ ...t, documentId: toId }))).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Permanent deletion of one document: only from the Trash, and the caller
 * must echo the document's slug. Topic and tag links, relations in both
 * directions, collection places and portable identities cascade; media stays
 * in the library.
 */
export async function deleteDocument(actor: Actor, id: string, confirmation: string): Promise<{ affectsPublic: boolean }> {
  assertAdmin(actor);
  const db = getDb();
  const row = await loadRow(db, id);
  if (row.status !== TRASHED) throw conflict("Move this document to the Trash before deleting it permanently.");
  if (confirmation !== row.slug) throw invalid("Type the document's URL slug to confirm permanent deletion.", { confirmation: "Does not match" });
  const deleted = await db.delete(documents).where(and(eq(documents.id, id), eq(documents.status, TRASHED))).returning({ id: documents.id });
  if (!deleted.length) throw conflict("This document was restored before it could be deleted.");
  await recordAudit(actor, "document.delete", "document", id, row.title, { slug: row.slug, typeId: row.typeId });
  return { affectsPublic: isAccessible(row) };
}

// ---------------------------------------------------------------------------
// Taxonomy, relations, collection items
// ---------------------------------------------------------------------------

const taxonomySchema = z.object({
  categoryIds: z.array(z.string()).max(20).default([]),
  primaryCategoryId: z.string().nullable().default(null),
  tagIds: z.array(z.string()).max(50).default([]),
  tagNames: z.array(z.string()).max(50).default([]),
});

async function writeTaxonomy(actor: AdminActor, db: Db, docId: string, input: z.infer<typeof taxonomySchema>): Promise<void> {
  const categoryIds = [...new Set(input.categoryIds.filter(isUuid))];
  if (categoryIds.length) {
    const found = await db.select({ id: categories.id }).from(categories).where(inArray(categories.id, categoryIds));
    if (found.length !== categoryIds.length) throw invalid("One of the selected categories no longer exists.");
  }
  const tagIds = [...new Set(input.tagIds.filter(isUuid))];
  if (tagIds.length) {
    const found = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds));
    if (found.length !== tagIds.length) throw invalid("One of the selected tags no longer exists.");
  }
  const createdTagIds = input.tagNames.length ? await ensureTags(actor, db, input.tagNames) : [];
  const primary = input.primaryCategoryId && categoryIds.includes(input.primaryCategoryId) ? input.primaryCategoryId : categoryIds[0];

  await db.delete(documentCategories).where(eq(documentCategories.documentId, docId));
  if (categoryIds.length) {
    await db.insert(documentCategories).values(categoryIds.map((categoryId) => ({ documentId: docId, categoryId, isPrimary: categoryId === primary })));
  }
  await db.delete(documentTags).where(eq(documentTags.documentId, docId));
  const allTags = [...new Set([...tagIds, ...createdTagIds])];
  if (allTags.length) await db.insert(documentTags).values(allTags.map((tagId) => ({ documentId: docId, tagId })));
}

export async function setDocumentTaxonomy(actor: Actor, id: string, input: unknown): Promise<{ affectsPublic: boolean }> {
  assertAdmin(actor);
  const parsed = taxonomySchema.safeParse(input);
  if (!parsed.success) throw invalid("Invalid categories or tags.");
  const db = getDb();
  return db.transaction(async (tx) => {
    const row = await loadRow(tx, id, { editable: true });
    await writeTaxonomy(actor, tx, id, parsed.data);
    await refreshSearchExtra(tx, [id]);
    await tx.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, id));
    return { affectsPublic: isAccessible(row) };
  });
}

const relationsSchema = z.object({
  relations: z
    .array(z.object({ targetId: z.string(), kind: z.string(), note: z.string().max(300).default("") }))
    .max(60),
});

export async function setDocumentRelations(actor: Actor, id: string, input: unknown): Promise<{ affectsPublic: boolean }> {
  assertAdmin(actor);
  const parsed = relationsSchema.safeParse(input);
  if (!parsed.success) throw invalid("Invalid relationships.");
  const db = getDb();
  return db.transaction(async (tx) => {
    const row = await loadRow(tx, id, { editable: true });
    const cleaned = parsed.data.relations.filter((r) => isUuid(r.targetId) && isRelationKind(r.kind) && r.targetId !== id);
    if (cleaned.length !== parsed.data.relations.length) throw invalid("Relationships must point to other existing documents with a known kind.");
    const existing = await existingDocumentIds(tx, cleaned.map((r) => r.targetId));
    // Forged or stale ids are rejected outright rather than silently dropped.
    if (cleaned.some((r) => !existing.has(r.targetId))) throw invalid("A related document does not exist.");
    await tx.delete(documentRelations).where(and(eq(documentRelations.sourceId, id), eq(documentRelations.origin, "manual")));
    const seen = new Set<string>();
    const rows = cleaned
      .filter((r) => {
        const key = `${r.targetId}:${r.kind}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r, position) => ({ sourceId: id, targetId: r.targetId, kind: r.kind, note: r.note.trim(), origin: "manual" as const, position }));
    if (rows.length) await tx.insert(documentRelations).values(rows);
    await tx.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, id));
    return { affectsPublic: isAccessible(row) };
  });
}

const itemsSchema = z.object({
  items: z
    .array(z.object({ documentId: z.string(), groupLabel: z.string().max(120).default(""), note: z.string().max(1000).default("") }))
    .max(500),
});

export async function setCollectionItems(actor: Actor, id: string, input: unknown): Promise<{ affectsPublic: boolean }> {
  assertAdmin(actor);
  const parsed = itemsSchema.safeParse(input);
  if (!parsed.success) throw invalid("Invalid collection items.");
  const db = getDb();
  return db.transaction(async (tx) => {
    const row = await loadRow(tx, id, { editable: true });
    const type = await requireType(tx, row.typeId);
    if (type.template !== "collection") throw invalid("Only collection-template documents can hold items.");
    const items = parsed.data.items.filter((i) => isUuid(i.documentId) && i.documentId !== id);
    const existing = await existingDocumentIds(tx, items.map((i) => i.documentId));
    if (items.some((i) => !existing.has(i.documentId))) throw invalid("A collection item does not exist.");
    await tx.delete(collectionItems).where(eq(collectionItems.collectionId, id));
    const seen = new Set<string>();
    const rows = items
      .filter((i) => (seen.has(i.documentId) ? false : (seen.add(i.documentId), true)))
      .map((i, position) => ({ collectionId: id, documentId: i.documentId, groupLabel: i.groupLabel.trim(), note: i.note.trim(), position }));
    if (rows.length) await tx.insert(collectionItems).values(rows);
    await tx.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, id));
    return { affectsPublic: isAccessible(row) };
  });
}

// ---------------------------------------------------------------------------
// Import writes (services/import/*). Same rules as the editor: sanitised
// bodies, validated properties, unique slugs, root namespace, derived text,
// content relations. Each takes the caller's transaction so a document and
// its import record commit together. Never publishes: status changes go
// through runDocumentAction() afterwards.
// ---------------------------------------------------------------------------

export type ImportDocumentInput = {
  typeId: string;
  title: string;
  slug: string;
  status: "idea" | "draft";
  visibility: "private" | "unlisted" | "public";
  excerpt: string;
  content: unknown;
  properties: Record<string, unknown>;
  featuredMediaId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  robotsIndex: "default" | "index" | "noindex";
  notes: string;
  featured: boolean;
  priority: number;
  createdAt: Date | null;
  publishedAt: Date | null;
  modifiedAt: Date | null;
  categoryIds: string[];
  tagIds: string[];
};

function clampDate(date: Date | null): Date | null {
  return date && !Number.isNaN(date.getTime()) && date.getTime() < Date.now() + 366 * 24 * 3600 * 1000 ? date : null;
}

export async function importCreateDocument(actor: Actor, tx: Db, input: ImportDocumentInput): Promise<{ id: string; slug: string; path: string }> {
  assertAdmin(actor);
  const type = await requireType(tx, input.typeId);
  const content = sanitizeBodyContent(input.content);
  const properties = await validateBodyProperties(tx, type, input.properties, "draft");
  await assertMediaExists(tx, [input.featuredMediaId]);
  const slug = await uniqueSlug(tx, type, input.slug || slugify(input.title));
  const derived = deriveContent(content);
  const canonical = input.canonicalUrl ? safeExternalUrl(input.canonicalUrl) : null;
  const createdAt = clampDate(input.createdAt);
  const [row] = await tx
    .insert(documents)
    .values({
      typeId: type.id,
      title: input.title.trim().slice(0, MAX_TITLE),
      slug,
      status: input.status,
      visibility: input.visibility,
      excerpt: input.excerpt.slice(0, 600),
      content,
      plainText: derived.plainText,
      wordCount: derived.wordCount,
      readingMinutes: derived.readingMinutes,
      properties,
      featuredMediaId: input.featuredMediaId,
      authorId: actor.userId,
      seoTitle: input.seoTitle?.slice(0, 120) || null,
      seoDescription: input.seoDescription?.slice(0, 320) || null,
      canonicalUrl: canonical,
      robotsIndex: input.robotsIndex,
      notes: input.notes.slice(0, 20000),
      featured: input.featured,
      priority: Math.max(-100, Math.min(100, Math.round(input.priority))),
      publishedAt: clampDate(input.publishedAt),
      modifiedAt: clampDate(input.modifiedAt),
      ...(createdAt ? { createdAt } : {}),
    })
    .returning({ id: documents.id });
  const id = row!.id;
  if (input.categoryIds.length || input.tagIds.length) {
    await writeTaxonomy(actor, tx, id, { categoryIds: input.categoryIds, primaryCategoryId: input.categoryIds[0] ?? null, tagIds: input.tagIds, tagNames: [] });
  }
  await syncContentRelations(tx, id, type, content, properties);
  await refreshSearchExtra(tx, [id]);
  return { id, slug, path: documentPath(type, slug) };
}

/**
 * Field-level update. Only keys present in the patch change; `undefined`
 * means "leave as is". Topics and tags are added, never removed. A
 * published document's body changes are staged in its working copy (as the
 * editor's autosave does), so the live page doesn't change until "Publish
 * changes".
 */
export type ImportDocumentPatch = {
  title?: string;
  excerpt?: string;
  content?: unknown;
  properties?: Record<string, unknown>;
  featuredMediaId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
  robotsIndex?: "default" | "index" | "noindex";
  notes?: string;
  publishedAt?: Date | null;
  modifiedAt?: Date | null;
  visibility?: "private" | "unlisted" | "public";
  addCategoryIds?: string[];
  addTagIds?: string[];
};

export async function importUpdateDocument(actor: Actor, tx: Db, id: string, patch: ImportDocumentPatch): Promise<{ affectsPublic: boolean; staged: boolean }> {
  assertAdmin(actor);
  const row = await loadRow(tx, id, { editable: true });
  const type = await requireType(tx, row.typeId);
  const wasPublic = isAccessible(row);
  let staged = false;
  const bodyKeys = ["title", "excerpt", "content", "properties", "featuredMediaId"] as const;
  if (bodyKeys.some((k) => patch[k] !== undefined)) {
    const base = parseWorkingCopy(row.workingCopy) ?? liveBody(row);
    const next: EditableBody = {
      title: patch.title !== undefined ? patch.title.trim().slice(0, MAX_TITLE) : base.title,
      excerpt: patch.excerpt !== undefined ? patch.excerpt.slice(0, 600) : base.excerpt,
      content: patch.content !== undefined ? sanitizeBodyContent(patch.content) : base.content,
      // Properties merge key by key: incoming values win, existing keys stay.
      properties: patch.properties !== undefined ? await validateBodyProperties(tx, type, { ...base.properties, ...patch.properties }, "draft") : base.properties,
      featuredMediaId: patch.featuredMediaId !== undefined ? patch.featuredMediaId : base.featuredMediaId,
    };
    await assertMediaExists(tx, [next.featuredMediaId]);
    if (row.status === "published") {
      await tx.update(documents).set({ workingCopy: { ...next, savedAt: new Date().toISOString() }, updatedAt: new Date(), version: sql`${documents.version} + 1` }).where(eq(documents.id, id));
      staged = true;
    } else {
      await applyLiveBody(tx, row, type, next);
    }
  }
  const settings: Partial<typeof documents.$inferInsert> = {};
  if (patch.seoTitle !== undefined) settings.seoTitle = patch.seoTitle?.slice(0, 120) || null;
  if (patch.seoDescription !== undefined) settings.seoDescription = patch.seoDescription?.slice(0, 320) || null;
  if (patch.canonicalUrl !== undefined) settings.canonicalUrl = patch.canonicalUrl ? safeExternalUrl(patch.canonicalUrl) : null;
  if (patch.robotsIndex !== undefined) settings.robotsIndex = patch.robotsIndex;
  if (patch.notes !== undefined) settings.notes = patch.notes.slice(0, 20000);
  if (patch.publishedAt !== undefined) settings.publishedAt = clampDate(patch.publishedAt);
  if (patch.modifiedAt !== undefined) settings.modifiedAt = clampDate(patch.modifiedAt);
  if (patch.visibility !== undefined) settings.visibility = patch.visibility;
  if (Object.keys(settings).length) {
    await tx.update(documents).set({ ...settings, updatedAt: new Date(), version: sql`${documents.version} + 1` }).where(eq(documents.id, id));
  }
  if (patch.addCategoryIds?.length || patch.addTagIds?.length) {
    const [cats, tagRows] = await Promise.all([
      tx.select().from(documentCategories).where(eq(documentCategories.documentId, id)),
      tx.select({ tagId: documentTags.tagId }).from(documentTags).where(eq(documentTags.documentId, id)),
    ]);
    const categoryIds = [...new Set([...cats.map((c) => c.categoryId), ...(patch.addCategoryIds ?? [])])];
    const primary = cats.find((c) => c.isPrimary)?.categoryId ?? categoryIds[0] ?? null;
    await writeTaxonomy(actor, tx, id, { categoryIds, primaryCategoryId: primary, tagIds: [...new Set([...tagRows.map((t) => t.tagId), ...(patch.addTagIds ?? [])])], tagNames: [] });
    await refreshSearchExtra(tx, [id]);
  }
  const nowPublic = isAccessible({ status: row.status, visibility: settings.visibility ?? row.visibility });
  return { affectsPublic: !staged && (wasPublic || nowPublic), staged };
}

/** Adds members after the existing ones. Never removes or reorders existing members. */
export async function mergeCollectionItems(actor: Actor, tx: Db, collectionId: string, items: Array<{ documentId: string; groupLabel: string; note: string }>): Promise<{ added: number }> {
  assertAdmin(actor);
  const row = await loadRow(tx, collectionId, { editable: true });
  const type = await requireType(tx, row.typeId);
  if (type.template !== "collection") throw invalid("Only collection-template documents can hold items.");
  const existing = await tx.select({ documentId: collectionItems.documentId, position: collectionItems.position }).from(collectionItems).where(eq(collectionItems.collectionId, collectionId));
  const present = new Set(existing.map((e) => e.documentId));
  const wanted = items.filter((i) => isUuid(i.documentId) && i.documentId !== collectionId && !present.has(i.documentId));
  const found = await existingDocumentIds(tx, wanted.map((i) => i.documentId));
  const start = existing.reduce((max, e) => Math.max(max, e.position + 1), 0);
  const seen = new Set<string>();
  const rows = wanted
    .filter((i) => found.has(i.documentId) && !seen.has(i.documentId) && (seen.add(i.documentId), true))
    .map((i, n) => ({ collectionId, documentId: i.documentId, groupLabel: i.groupLabel.trim().slice(0, 120), note: i.note.trim().slice(0, 1000), position: start + n }));
  if (rows.length) await tx.insert(collectionItems).values(rows).onConflictDoNothing();
  return { added: rows.length };
}

/** Adds curated relations after the existing ones; duplicates and self-links are ignored. */
export async function mergeManualRelations(actor: Actor, tx: Db, sourceId: string, relations: Array<{ targetId: string; kind: string; note: string }>): Promise<{ added: number }> {
  assertAdmin(actor);
  await loadRow(tx, sourceId, { editable: true });
  const existing = await tx.select().from(documentRelations).where(and(eq(documentRelations.sourceId, sourceId), eq(documentRelations.origin, "manual")));
  const present = new Set(existing.map((r) => `${r.targetId}:${r.kind}`));
  const valid = relations.filter((r) => isUuid(r.targetId) && r.targetId !== sourceId && isRelationKind(r.kind) && !present.has(`${r.targetId}:${r.kind}`));
  const found = await existingDocumentIds(tx, valid.map((r) => r.targetId));
  const start = existing.reduce((max, r) => Math.max(max, r.position + 1), 0);
  const seen = new Set<string>();
  const rows = valid
    .filter((r) => found.has(r.targetId) && !seen.has(`${r.targetId}:${r.kind}`) && (seen.add(`${r.targetId}:${r.kind}`), true))
    .map((r, n) => ({ sourceId, targetId: r.targetId, kind: r.kind, note: r.note.trim().slice(0, 300), origin: "manual" as const, position: start + n }));
  if (rows.length) await tx.insert(documentRelations).values(rows).onConflictDoNothing();
  return { added: rows.length };
}

/**
 * Rebuilds content relations (links, mentions) from each document's live
 * body. Imports call this once every document exists, because a link can
 * only become a relation when its target is there.
 */
export async function resyncContentRelations(actor: Actor, tx: Db, ids: string[]): Promise<void> {
  assertAdmin(actor);
  const wanted = [...new Set(ids.filter(isUuid))];
  if (!wanted.length) return;
  const types = await loadContentTypes(tx);
  const rows = await tx.select().from(documents).where(inArray(documents.id, wanted));
  for (const row of rows) {
    const type = types.find((t) => t.id === row.typeId);
    if (type) await syncContentRelations(tx, row.id, type, sanitizeDoc(row.content), (row.properties ?? {}) as Properties);
  }
}

// ---------------------------------------------------------------------------
// Reads (admin)
// ---------------------------------------------------------------------------

async function summaries(db: Db, ids: string[]): Promise<Map<string, DocumentSummary>> {
  const wanted = [...new Set(ids.filter(isUuid))];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      status: documents.status,
      visibility: documents.visibility,
      typeId: documents.typeId,
      typeName: contentTypes.name,
      typeSlug: contentTypes.slug,
      routing: contentTypes.routing,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .innerJoin(contentTypes, eq(contentTypes.id, documents.typeId))
    .where(inArray(documents.id, wanted));
  return new Map(
    rows.map((r) => [r.id, { ...r, path: documentPath({ slug: r.typeSlug, routing: r.routing }, r.slug) }]),
  );
}

/** The GitHub login of a studio user (e.g. who moved a document to the Trash). */
export async function userLogin(actor: Actor, userId: string): Promise<string | null> {
  assertAdmin(actor);
  if (!isUuid(userId)) return null;
  const [row] = await getDb().select({ login: users.githubLogin }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.login ?? null;
}

/** Titles for referenced documents (editor labels for mentions/related blocks). */
export async function documentTitles(actor: Actor, ids: string[]): Promise<Record<string, string>> {
  assertAdmin(actor);
  const map = await summaries(getDb(), ids.slice(0, 200));
  return Object.fromEntries([...map.values()].map((s) => [s.id, s.title || "Untitled"]));
}

export async function getDocumentForEdit(actor: Actor, id: string): Promise<AdminDocument> {
  assertAdmin(actor);
  const db = getDb();
  const row = await loadRow(db, id);
  const type = await requireType(db, row.typeId);

  const [cats, tagRows, rels, backs, items] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name, slug: categories.slug, isPrimary: documentCategories.isPrimary })
      .from(documentCategories)
      .innerJoin(categories, eq(categories.id, documentCategories.categoryId))
      .where(eq(documentCategories.documentId, id)),
    db
      .select({ id: tags.id, name: tags.name, slug: tags.slug })
      .from(documentTags)
      .innerJoin(tags, eq(tags.id, documentTags.tagId))
      .where(eq(documentTags.documentId, id))
      .orderBy(asc(tags.name)),
    db.select().from(documentRelations).where(and(eq(documentRelations.sourceId, id), eq(documentRelations.origin, "manual"))).orderBy(asc(documentRelations.position)),
    db.select().from(documentRelations).where(eq(documentRelations.targetId, id)),
    db.select().from(collectionItems).where(eq(collectionItems.collectionId, id)).orderBy(asc(collectionItems.position)),
  ]);

  const summaryMap = await summaries(db, [...rels.map((r) => r.targetId), ...backs.map((b) => b.sourceId), ...items.map((i) => i.documentId)]);
  const { searchVector: _sv, ...rest } = row;
  void _sv;

  return {
    ...rest,
    status: row.status === TRASHED ? TRASHED : isDocumentStatus(row.status) ? row.status : "draft",
    visibility: isVisibilityValue(row.visibility),
    content: sanitizeDoc(row.content),
    properties: (row.properties ?? {}) as Properties,
    workingCopy: parseWorkingCopy(row.workingCopy),
    type: { id: type.id, name: type.name, slug: type.slug, template: type.template, routing: type.routing, icon: type.icon, fields: type.fields, schemaType: type.schemaType, indexable: type.indexable },
    path: documentPath(type, row.slug),
    categories: cats,
    tags: tagRows,
    relations: rels
      .filter((r) => summaryMap.has(r.targetId) && isRelationKind(r.kind))
      .map((r) => ({ id: r.id, targetId: r.targetId, kind: r.kind as RelationKind, note: r.note, target: summaryMap.get(r.targetId)! })),
    backlinks: dedupeBacklinks(backs)
      .filter((b) => summaryMap.has(b.sourceId) && isRelationKind(b.kind))
      .map((b) => ({ sourceId: b.sourceId, kind: b.kind as RelationKind, source: summaryMap.get(b.sourceId)! })),
    collectionItems: items
      .filter((i) => summaryMap.has(i.documentId))
      .map((i) => ({ documentId: i.documentId, groupLabel: i.groupLabel, note: i.note, document: summaryMap.get(i.documentId)! })),
  };
}

function isVisibilityValue(v: string): "private" | "unlisted" | "public" {
  return v === "public" || v === "unlisted" ? v : "private";
}

function dedupeBacklinks<T extends { sourceId: string; kind: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.sourceId + r.kind) ? false : (seen.add(r.sourceId + r.kind), true)));
}

export const DOCUMENT_SORTS = ["updated", "updated_asc", "created", "created_asc", "published", "title", "words"] as const;
export type DocumentSort = (typeof DOCUMENT_SORTS)[number];
/** "Not updated in N days" choices for the list filter. */
export const AGE_FILTER_DAYS = [30, 90, 180, 365] as const;

export type DocumentListFilters = {
  typeId?: string;
  /** An editorial status, or "trashed" for the Trash. Without it, trashed documents are excluded. */
  status?: string;
  visibility?: string;
  categoryId?: string;
  tagId?: string;
  /** "yes" | "no" */
  featured?: string;
  /** Only documents not updated in this many days (one of AGE_FILTER_DAYS). */
  staleDays?: number;
  /** A Content Health check key (services/content-health.ts). */
  health?: string;
  q?: string;
  sort?: DocumentSort | string;
  limit?: number;
  offset?: number;
};

export type DocumentListItem = DocumentSummary & {
  /** With typeIndexable, what the list shows as the document's result (lib/content/publication.ts). */
  robotsIndex: string;
  typeIndexable: boolean;
  excerpt: string;
  wordCount: number;
  publishedAt: Date | null;
  createdAt: Date;
  hasStagedChanges: boolean;
  featured: boolean;
  trashedAt: Date | null;
  trashedBy: string | null;
};

/** The Documents list's URL parameters (also posted back for "select all matching"). Untrusted; validated in documentFilterCondition. */
export const FILTER_PARAMS = ["q", "type", "status", "visibility", "category", "tag", "featured", "stale", "health", "sort"] as const;
export type FilterParams = Partial<Record<(typeof FILTER_PARAMS)[number], string>>;

export function parseDocumentFilters(params: FilterParams): DocumentListFilters {
  const text = (v: string | undefined) => (typeof v === "string" ? v.slice(0, 200) : undefined);
  return {
    q: text(params.q),
    typeId: text(params.type),
    status: text(params.status),
    visibility: text(params.visibility),
    categoryId: text(params.category),
    tagId: text(params.tag),
    featured: text(params.featured),
    staleDays: params.stale ? Number(params.stale) : undefined,
    health: text(params.health),
    sort: text(params.sort),
  };
}

/**
 * The WHERE clause for an admin document filter. Every value is validated
 * here, so the same untrusted filter can drive both the list and "select all
 * matching" bulk operations without either trusting the browser.
 */
export function documentFilterCondition(filters: DocumentListFilters): SQL | undefined {
  const where: SQL[] = [];
  if (filters.typeId && isUuid(filters.typeId)) where.push(eq(documents.typeId, filters.typeId));
  if (filters.status === TRASHED) where.push(eq(documents.status, TRASHED));
  else {
    where.push(ne(documents.status, TRASHED));
    if (filters.status && isDocumentStatus(filters.status)) where.push(eq(documents.status, filters.status));
  }
  if (filters.visibility && isVisibility(filters.visibility)) where.push(eq(documents.visibility, filters.visibility));
  if (filters.categoryId && isUuid(filters.categoryId)) {
    where.push(sql`exists (select 1 from studio.document_categories dc where dc.document_id = ${documents.id} and dc.category_id = ${filters.categoryId})`);
  }
  if (filters.tagId && isUuid(filters.tagId)) {
    where.push(sql`exists (select 1 from studio.document_tags dt where dt.document_id = ${documents.id} and dt.tag_id = ${filters.tagId})`);
  }
  if (filters.featured === "yes") where.push(eq(documents.featured, true));
  if (filters.featured === "no") where.push(eq(documents.featured, false));
  if (filters.staleDays && (AGE_FILTER_DAYS as readonly number[]).includes(filters.staleDays)) {
    where.push(sql`${documents.updatedAt} < now() - make_interval(days => ${filters.staleDays})`);
  }
  if (filters.health && isHealthCheck(filters.health)) where.push(healthCondition(filters.health, siteUrl()));
  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(documents.title, pattern), ilike(documents.slug, pattern), ilike(documents.excerpt, pattern))!);
  }
  return where.length ? and(...where) : undefined;
}

function documentOrder(sort: DocumentListFilters["sort"]): SQL[] {
  // Every order ends with the id so pages never overlap or skip rows on ties.
  switch (sort) {
    case "title":
      return [asc(documents.title), asc(documents.id)];
    case "created":
      return [desc(documents.createdAt), asc(documents.id)];
    case "created_asc":
      return [asc(documents.createdAt), asc(documents.id)];
    case "published":
      return [sql`${documents.publishedAt} desc nulls last`, asc(documents.id)];
    case "updated_asc":
      return [asc(documents.updatedAt), asc(documents.id)];
    case "words":
      return [desc(documents.wordCount), asc(documents.id)];
    default:
      return [desc(documents.updatedAt), asc(documents.id)];
  }
}

export async function listDocuments(actor: Actor, filters: DocumentListFilters = {}): Promise<{ items: DocumentListItem[]; total: number }> {
  assertAdmin(actor);
  const db = getDb();
  const condition = documentFilterCondition(filters);
  const order = filters.status === TRASHED && !filters.sort ? [sql`${documents.trashedAt} desc nulls last`, asc(documents.id)] : documentOrder(filters.sort);
  const limit = clampInt(filters.limit, 1, 200, 50);

  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        slug: documents.slug,
        status: documents.status,
        visibility: documents.visibility,
        typeId: documents.typeId,
        typeName: contentTypes.name,
        typeSlug: contentTypes.slug,
        routing: contentTypes.routing,
        robotsIndex: documents.robotsIndex,
        typeIndexable: contentTypes.indexable,
        updatedAt: documents.updatedAt,
        createdAt: documents.createdAt,
        publishedAt: documents.publishedAt,
        excerpt: documents.excerpt,
        wordCount: documents.wordCount,
        featured: documents.featured,
        hasStagedChanges: sql<boolean>`${documents.workingCopy} is not null`,
        trashedAt: documents.trashedAt,
        trashedBy: users.githubLogin,
      })
      .from(documents)
      .innerJoin(contentTypes, eq(contentTypes.id, documents.typeId))
      .leftJoin(users, eq(users.id, documents.trashedBy))
      .where(condition)
      .orderBy(...order)
      .limit(limit)
      .offset(clampInt(filters.offset, 0, 1_000_000, 0)),
    db.select({ total: count() }).from(documents).where(condition),
  ]);

  return {
    items: rows.map((r) => ({ ...r, path: documentPath({ slug: r.typeSlug, routing: r.routing }, r.slug) })),
    total: Number(total),
  };
}

/** Ids (only) matching a filter, in list order, capped. For "select all matching". */
export async function documentIdsMatching(actor: Actor, filters: DocumentListFilters, cap: number): Promise<{ ids: string[]; total: number }> {
  assertAdmin(actor);
  const db = getDb();
  const condition = documentFilterCondition(filters);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db.select({ id: documents.id }).from(documents).where(condition).orderBy(...documentOrder(filters.sort)).limit(cap),
    db.select({ total: count() }).from(documents).where(condition),
  ]);
  return { ids: rows.map((r) => r.id), total: Number(total) };
}

/** Lightweight lookup for relation pickers, mentions and collection editors. */
export async function lookupDocuments(actor: Actor, q: string, options: { excludeId?: string; typeIds?: string[]; limit?: number } = {}) {
  assertAdmin(actor);
  const db = getDb();
  // Pickers never offer trashed documents as new link, relation or collection targets.
  const where: SQL[] = [ne(documents.status, TRASHED)];
  const term = q.trim().slice(0, 100);
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(documents.title, pattern), ilike(documents.slug, pattern))!);
  }
  if (options.excludeId && isUuid(options.excludeId)) where.push(ne(documents.id, options.excludeId));
  const typeIds = (options.typeIds ?? []).filter(isUuid);
  if (typeIds.length) where.push(inArray(documents.typeId, typeIds));
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      status: documents.status,
      visibility: documents.visibility,
      typeId: documents.typeId,
      typeName: contentTypes.name,
      typeSlug: contentTypes.slug,
      routing: contentTypes.routing,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .innerJoin(contentTypes, eq(contentTypes.id, documents.typeId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(documents.updatedAt))
    .limit(clampInt(options.limit, 1, 50, 12));
  return rows.map((r) => ({ ...r, path: documentPath({ slug: r.typeSlug, routing: r.routing }, r.slug), isPublic: isListed(r) }));
}

export async function dashboardStats(actor: Actor) {
  assertAdmin(actor);
  const db = getDb();
  const [byStatus, byType, words, staged] = await Promise.all([
    db.select({ status: documents.status, n: count() }).from(documents).groupBy(documents.status),
    db.select({ typeId: documents.typeId, n: count() }).from(documents).groupBy(documents.typeId),
    db.select({ total: sql<number>`coalesce(sum(${documents.wordCount}), 0)` }).from(documents).where(eq(documents.status, "published")),
    db.select({ n: count() }).from(documents).where(sql`${documents.workingCopy} is not null`),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Record<string, number>,
    byType: Object.fromEntries(byType.map((r) => [r.typeId, Number(r.n)])) as Record<string, number>,
    publishedWords: Number(words[0]?.total ?? 0),
    stagedChanges: Number(staged[0]?.n ?? 0),
  };
}

/**
 * Documents that would make the public site look unfinished:
 *
 *   "todo" — still carries a [TODO] marker from the seed.
 *   "demo" — published, but titled after its own content type ("Guide",
 *            "Projects"). These get created while testing templates, listings
 *            and the home page, and they are easy to forget: unpublished they
 *            cost nothing, published they fill the home page and Explore.
 */
export async function placeholderDocuments(actor: Actor) {
  assertAdmin(actor);
  const rows = await getDb()
    .select({ id: documents.id, title: documents.title, status: documents.status, typeName: contentTypes.name, typePlural: contentTypes.pluralName })
    .from(documents)
    .innerJoin(contentTypes, eq(contentTypes.id, documents.typeId))
    .where(
      sql`${documents.status} <> 'trashed' and (${documents.plainText} ilike '%[TODO%' or ${documents.excerpt} ilike '%[TODO%'
        or (${documents.status} = 'published' and lower(btrim(${documents.title})) in (lower(${contentTypes.name}), lower(${contentTypes.pluralName}))))`,
    )
    .orderBy(asc(documents.title))
    .limit(50);
  return rows.map(({ typeName, typePlural, ...row }) => ({
    ...row,
    reason: [typeName, typePlural].some((n) => n.toLowerCase() === row.title.trim().toLowerCase()) && row.status === "published" ? ("demo" as const) : ("todo" as const),
  }));
}
