import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lt, or, isNull, sql } from "drizzle-orm";
import { EMPTY_DOC, isUuid, type Doc } from "@/lib/content/blocks";
import { basename } from "@/lib/portability/paths";
import type { ParsedPackage } from "@/lib/portability/model";
import { resolvePlaceholders, type PlaceholderResolver } from "@/lib/portability/doc-refs";
import { RUN_BUDGET_MS, RUN_LEASE_MS } from "@/lib/portability/limits";
import type { CollectionPlan, DocumentPlan, ImportPlan, MediaPlan, PlannedProperty, RefResolution, RelationPlan } from "@/lib/portability/plan-types";
import { assertAdmin, type Actor, type AdminActor } from "../../auth/actor";
import { getDb, type Db } from "../../db/client";
import { categories, documents, importFiles, importItems, importJobs, media, portableIdentities, redirects } from "../../db/schema";
import { getStorage } from "../../media/storage";
import { conflict, invalid, isServiceError, notFound, ServiceError } from "../../errors";
import { recordAudit } from "../audit";
import { loadContentTypes, type ContentType } from "../content-types";
import {
  importCreateDocument,
  importUpdateDocument,
  mergeCollectionItems,
  mergeManualRelations,
  resyncContentRelations,
  runDocumentAction,
  type ImportDocumentPatch,
} from "../documents";
import { maxUploadBytes, uploadMedia } from "../media";
import { upsertRedirect } from "../redirects";
import { createCategory, ensureTags } from "../taxonomy";
import { assertMediaUploadAllowed } from "./storage-guard";
import { documentPath } from "@/lib/content/paths";

// ---------------------------------------------------------------------------
// Building items at approval
// ---------------------------------------------------------------------------

export type ItemDraft = Omit<typeof importItems.$inferInsert, "jobId">;

const writesBody = (p: DocumentPlan) => p.action === "create" || p.action === "copy" || (p.action === "update" && p.updateFields.includes("body"));
const active = (p: DocumentPlan) => p.action === "create" || p.action === "copy" || p.action === "update";

/** Turns an approved plan into ordered, idempotent work items (one per key). */
export function buildItems(plan: ImportPlan, pkg: ParsedPackage): ItemDraft[] {
  const items: ItemDraft[] = [];
  const docs = plan.documents.filter(active);
  const activeKeys = new Set(docs.map((d) => d.key));
  const bodyOf = (key: string) => (pkg.documents.find((d) => d.key === key) ?? pkg.readmes.find((r) => key === `collection:${r.sourcePath.includes("/") ? r.sourcePath.slice(0, r.sourcePath.lastIndexOf("/")) : ""}`))?.body ?? null;

  const usedMedia = new Set<string>();
  for (const d of docs) {
    if (writesBody(d)) d.mediaRefs.forEach((m) => m.mediaKey && usedMedia.add(m.mediaKey));
    if (d.coverMediaKey && (d.action !== "update" || d.updateFields.includes("cover"))) usedMedia.add(d.coverMediaKey);
    for (const prop of Object.values(d.properties)) if (prop.kind === "media") usedMedia.add(prop.mediaKey);
  }
  for (const m of plan.media) {
    if (!usedMedia.has(m.key) || m.action !== "upload") continue;
    items.push({ seq: 100, stage: "asset", key: `media:${m.key}`, action: "upload", label: m.path ?? m.key, payload: { media: m, rootFolder: plan.source.rootFolder, system: plan.source.system } });
  }

  const topicDepth = (key: string): number => {
    const t = plan.topics.find((x) => x.key === key);
    return t?.create?.parentKey ? 1 + topicDepth(t.create.parentKey) : 0;
  };
  const usedTopics = new Set(docs.filter((d) => d.action !== "update" || d.updateFields.includes("topics")).flatMap((d) => d.topicKeys));
  // A used sub-topic needs its parents.
  for (const key of [...usedTopics]) {
    let parent = plan.topics.find((t) => t.key === key)?.create?.parentKey;
    while (parent) {
      usedTopics.add(parent);
      parent = plan.topics.find((t) => t.key === parent)?.create?.parentKey;
    }
  }
  for (const t of plan.topics) {
    if (!usedTopics.has(t.key)) continue;
    if (t.action === "create") items.push({ seq: 200 + topicDepth(t.key), stage: "topic", key: `topic:${t.key}`, action: "create", label: t.create!.name, payload: { topic: t } });
    else if (t.action === "reuse" && t.key.startsWith("pid:")) items.push({ seq: 200, stage: "topic", key: `topic:${t.key}`, action: "map", label: t.label, payload: { topic: t } });
  }
  const usedTags = new Set(docs.filter((d) => d.action !== "update" || d.updateFields.includes("tags")).flatMap((d) => d.tagKeys));
  for (const t of plan.tags) {
    if (usedTags.has(t.key) && t.action === "create") items.push({ seq: 300, stage: "tag", key: `tag:${t.key}`, action: "create", label: t.name, payload: { tag: t } });
  }

  for (const d of docs) {
    items.push({ seq: d.synthetic ? 400 : 410, stage: "document", key: `doc:${d.key}`, action: d.action, label: d.title || d.sourcePath, payload: { plan: d, body: writesBody(d) ? bodyOf(d.key) : null } });
  }
  for (const c of plan.collections) {
    if (c.action === "skip" || !c.items.some((i) => activeKeys.has(i.documentKey) || plan.documents.find((d) => d.key === i.documentKey)?.conflict)) continue;
    if (c.action === "create" && (!c.documentKey || !activeKeys.has(c.documentKey))) continue;
    items.push({ seq: 500, stage: "collection", key: `collection:${c.key}`, action: c.action, label: c.title, payload: { collection: c } });
  }
  const manual = new Map<string, RelationPlan[]>();
  for (const r of plan.relations) {
    if (r.origin !== "manual") continue;
    const source = plan.documents.find((d) => d.key === r.sourceKey);
    if (!source || !active(source) || (source.action === "update" && !source.updateFields.includes("relations"))) continue;
    manual.set(r.sourceKey, [...(manual.get(r.sourceKey) ?? []), r]);
  }
  for (const [key, relations] of manual) items.push({ seq: 600, stage: "relations", key: `relations:${key}`, action: "link", label: plan.documents.find((d) => d.key === key)?.title ?? key, payload: { sourceKey: key, relations } });

  for (const d of docs) {
    const incomingRefs = d.refs.some((r) => r.resolution.status === "incoming") || Object.values(d.properties).some((p) => p.kind === "documents" && p.refs.some((r) => r.status === "incoming"));
    if (incomingRefs && (writesBody(d) || (d.action === "update" && d.updateFields.includes("properties")))) {
      items.push({ seq: 700, stage: "finalize", key: `finalize:${d.key}`, action: "resolve", label: d.title, payload: { key: d.key } });
    }
  }
  if (docs.length) items.push({ seq: 800, stage: "links", key: "links", action: "resync", label: "Links and backlinks", payload: {} });
  for (const d of docs) {
    const statusChange = d.action === "update" ? d.updateFields.includes("status") && d.status !== d.conflict?.existing.status : d.status !== "draft";
    if (statusChange || (d.status === "published" && d.legacyUrls.length && d.action !== "update")) {
      items.push({ seq: 900, stage: "status", key: `status:${d.key}`, action: d.status, label: d.title, payload: { key: d.key, status: d.status, legacyUrls: d.legacyUrls } });
    }
  }
  items.push({ seq: 1000, stage: "verify", key: "verify", action: "verify", label: "Verify imported records", payload: {} });
  return items.map((i) => ({ ...i, label: String(i.label).slice(0, 300) }));
}

// ---------------------------------------------------------------------------
// Execution context: what earlier items produced
// ---------------------------------------------------------------------------

type ItemRow = typeof importItems.$inferSelect;
type Done = { targetId: string | null; result: Record<string, unknown> };

class RunContext {
  private done = new Map<string, Done>();
  private typesBySlug = new Map<string, ContentType>();
  affectsPublic = false;

  constructor(
    readonly db: Db,
    readonly actor: AdminActor,
    readonly job: typeof importJobs.$inferSelect,
    readonly plan: ImportPlan,
  ) {}

  async load(): Promise<void> {
    const rows = await this.db
      .select({ key: importItems.key, targetId: importItems.targetId, result: importItems.result })
      .from(importItems)
      .where(and(eq(importItems.jobId, this.job.id), eq(importItems.status, "done")));
    this.done = new Map(rows.map((r) => [r.key, { targetId: r.targetId, result: (r.result ?? {}) as Record<string, unknown> }]));
    const types = await loadContentTypes(this.db);
    this.typesBySlug = new Map(types.map((t) => [t.slug, t]));
  }

  remember(key: string, targetId: string | null, result: Record<string, unknown>): void {
    this.done.set(key, { targetId, result });
  }

  type(slug: string | null): ContentType {
    const type = slug ? this.typesBySlug.get(slug) : undefined;
    if (!type) throw invalid(`The format "${slug}" no longer exists.`);
    return type;
  }

  docPlan(key: string): DocumentPlan | undefined {
    return this.plan.documents.find((d) => d.key === key);
  }

  topicId(key: string): string | null {
    const topic = this.plan.topics.find((t) => t.key === key);
    if (!topic) return null;
    if (topic.action === "reuse") return topic.existingId;
    if (topic.action === "create") return this.done.get(`topic:${key}`)?.targetId ?? null;
    return null;
  }

  tagId(key: string): string | null {
    const tag = this.plan.tags.find((t) => t.key === key);
    if (!tag) return null;
    return tag.action === "reuse" ? tag.existingId : (this.done.get(`tag:${key}`)?.targetId ?? null);
  }

  media(key: string | null): { mediaId: string; src: string } | null {
    if (!key) return null;
    const m: MediaPlan | undefined = this.plan.media.find((x) => x.key === key);
    if (!m) return null;
    if (m.action === "reuse" && m.existingId && m.url) return { mediaId: m.existingId, src: m.url };
    const done = this.done.get(`media:${key}`);
    if (m.action === "upload" && done?.targetId && typeof done.result.url === "string") return { mediaId: done.targetId, src: done.result.url };
    return null;
  }

  /** Where a reference lands now: created id/path, the existing document, or (not yet created) nothing. */
  landing(resolution: RefResolution, plannedPathFallback: boolean): { id: string | null; path: string } | null {
    if (resolution.status === "existing") return { id: resolution.id, path: resolution.path };
    if (resolution.status === "kept") return { id: null, path: resolution.path };
    if (resolution.status !== "incoming") return null;
    const done = this.done.get(`doc:${resolution.key}`);
    if (done?.targetId) return { id: done.targetId, path: String(done.result.path ?? "") };
    const target = this.docPlan(resolution.key);
    if (!target) return null;
    if (target.conflict && (target.action === "skip" || target.action === "update")) return { id: target.conflict.existing.id, path: target.conflict.existing.path };
    if (!plannedPathFallback || !target.typeSlug) return null;
    const type = this.typesBySlug.get(target.typeSlug);
    return type ? { id: null, path: documentPath(type, target.slug) } : null;
  }

  resolver(plan: DocumentPlan): PlaceholderResolver {
    return {
      doc: (i) => {
        const ref = plan.refs[i];
        const hit = ref ? this.landing(ref.resolution, true) : null;
        if (!hit) return null;
        // Mentions need an id; links can use the planned path until the target exists.
        return { id: hit.id ?? "", path: hit.path };
      },
      media: (i) => {
        const hit = this.media(plan.mediaRefs[i]?.mediaKey ?? null);
        return hit ? { src: hit.src, mediaId: hit.mediaId } : null;
      },
      describeMedia: (i) => {
        const m = this.plan.media.find((x) => x.key === plan.mediaRefs[i]?.mediaKey);
        return m?.path ?? m?.url ?? "unknown file";
      },
    };
  }

  properties(plan: DocumentPlan): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(plan.properties) as Array<[string, PlannedProperty]>) {
      if (prop.kind === "value") out[key] = prop.value;
      else if (prop.kind === "media") {
        const m = this.media(prop.mediaKey);
        if (m) out[key] = m.mediaId;
      } else {
        const ids = prop.refs.map((r) => this.landing(r, false)?.id).filter((id): id is string => isUuid(id));
        if (ids.length) out[key] = prop.multiple ? ids : ids[0];
      }
    }
    return out;
  }
}

async function linkIdentity(tx: Db, entity: "document" | "topic" | "tag" | "media", portableId: string, id: string, source: string, metadata: Record<string, unknown>): Promise<void> {
  const column = entity === "document" ? { documentId: id } : entity === "topic" ? { categoryId: id } : entity === "tag" ? { tagId: id } : { mediaId: id };
  await tx
    .insert(portableIdentities)
    .values({ portableId: portableId.slice(0, 400), entity, ...column, source, metadata })
    .onConflictDoNothing();
}

async function markDone(tx: Db, item: ItemRow, targetId: string | null, result: Record<string, unknown>): Promise<boolean> {
  const updated = await tx
    .update(importItems)
    .set({ status: "done", targetId, result, error: null, attempts: sql`${importItems.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(importItems.id, item.id), eq(importItems.status, "pending")))
    .returning({ id: importItems.id });
  // Another request already finished this item: roll this attempt back.
  if (!updated.length) throw new ServiceError("conflict", "This item was already processed.");
  return true;
}

// ---------------------------------------------------------------------------
// Item handlers
// ---------------------------------------------------------------------------

function docInputFromPlan(plan: DocumentPlan, ctx: RunContext, body: Doc | null) {
  const type = ctx.type(plan.typeSlug);
  const content = body ? resolvePlaceholders(body, ctx.resolver(plan)) : EMPTY_DOC;
  const date = (s: string | null) => (s ? new Date(s) : null);
  return {
    type,
    input: {
      typeId: type.id,
      title: plan.title,
      slug: plan.slug,
      status: "draft" as const,
      visibility: plan.visibility,
      excerpt: plan.excerpt ?? "",
      content,
      properties: ctx.properties(plan),
      featuredMediaId: ctx.media(plan.coverMediaKey)?.mediaId ?? null,
      seoTitle: plan.seoTitle,
      seoDescription: plan.seoDescription,
      canonicalUrl: plan.canonicalUrl,
      robotsIndex: (plan.robotsIndex === "index" || plan.robotsIndex === "noindex" ? plan.robotsIndex : "default") as "default" | "index" | "noindex",
      notes: plan.notes ?? "",
      featured: plan.featured === true,
      priority: plan.priority ?? 0,
      createdAt: date(plan.createdAt),
      publishedAt: date(plan.publishedAt),
      modifiedAt: date(plan.updatedAt),
      categoryIds: plan.topicKeys.map((k) => ctx.topicId(k)).filter((id): id is string => Boolean(id)),
      tagIds: plan.tagKeys.map((k) => ctx.tagId(k)).filter((id): id is string => Boolean(id)),
    },
  };
}

function updatePatch(plan: DocumentPlan, ctx: RunContext, body: Doc | null): ImportDocumentPatch & { clearProperties?: boolean } {
  const f = new Set(plan.updateFields);
  const clear = new Set(plan.clearFields);
  const patch: ImportDocumentPatch = {};
  const { input } = docInputFromPlan(plan, ctx, body);
  if (f.has("title")) patch.title = plan.title;
  if (f.has("body") && body) patch.content = input.content;
  // Selected but absent in the source = unchanged; only an explicit clear empties a field.
  if (clear.has("excerpt")) patch.excerpt = "";
  else if (f.has("excerpt") && plan.excerpt !== null) patch.excerpt = plan.excerpt;
  if (clear.has("seo")) Object.assign(patch, { seoTitle: null, seoDescription: null, canonicalUrl: null, robotsIndex: "default" as const });
  else if (f.has("seo")) {
    if (plan.seoTitle !== null) patch.seoTitle = plan.seoTitle;
    if (plan.seoDescription !== null) patch.seoDescription = plan.seoDescription;
    if (plan.canonicalUrl !== null) patch.canonicalUrl = plan.canonicalUrl;
    if (plan.robotsIndex !== null) patch.robotsIndex = input.robotsIndex;
  }
  if (clear.has("cover")) patch.featuredMediaId = null;
  else if (f.has("cover") && input.featuredMediaId) patch.featuredMediaId = input.featuredMediaId;
  if (f.has("properties") && Object.keys(input.properties).length) patch.properties = input.properties;
  if (clear.has("notes")) patch.notes = "";
  else if (f.has("notes") && plan.notes !== null) patch.notes = plan.notes;
  if (f.has("dates")) {
    if (plan.publishedAt) patch.publishedAt = new Date(plan.publishedAt);
    if (plan.updatedAt) patch.modifiedAt = new Date(plan.updatedAt);
  }
  if (f.has("visibility")) patch.visibility = plan.visibility;
  // An explicit Index/Noindex choice in the preview applies whether or not SEO fields are updated.
  if (plan.robotsFrom === "decision") patch.robotsIndex = input.robotsIndex;
  if (f.has("topics") && input.categoryIds.length) patch.addCategoryIds = input.categoryIds;
  if (f.has("tags") && input.tagIds.length) patch.addTagIds = input.tagIds;
  return { ...patch, clearProperties: clear.has("properties") };
}

async function runDocument(ctx: RunContext, item: ItemRow): Promise<void> {
  const { plan, body } = item.payload as { plan: DocumentPlan; body: Doc | null };
  const source = ctx.plan.source.system;
  const metadata = { sourcePath: plan.sourcePath, sourceSystem: source, jobId: ctx.job.id, importedAt: new Date().toISOString(), unmapped: plan.unmapped };
  if (plan.action === "create" || plan.action === "copy") {
    const { input } = docInputFromPlan(plan, ctx, body);
    const created = await ctx.db.transaction(async (tx) => {
      const row = await importCreateDocument(ctx.actor, tx, input);
      // A copy is a new document: the original keeps the identity.
      if (plan.action === "create" && plan.pid) await linkIdentity(tx, "document", plan.pid, row.id, source, metadata);
      await markDone(tx, item, row.id, { slug: row.slug, path: row.path, plannedSlug: plan.slug, slugChanged: row.slug !== plan.slug });
      return row;
    });
    ctx.remember(item.key, created.id, { path: created.path });
    if (input.visibility !== "private" && plan.status !== "draft") ctx.affectsPublic = true;
    return;
  }
  if (plan.action === "update" && plan.conflict) {
    const id = plan.conflict.existing.id;
    if (plan.updateFields.includes("slug") && plan.slug !== plan.conflict.existing.slug) {
      const result = await runDocumentAction(ctx.actor, id, { action: "changeSlug", slug: plan.slug });
      ctx.affectsPublic ||= result.affectsPublic;
    }
    const { clearProperties, ...patch } = updatePatch(plan, ctx, body);
    const path = await ctx.db.transaction(async (tx) => {
      if (clearProperties) await tx.update(documents).set({ properties: {}, updatedAt: new Date() }).where(eq(documents.id, id));
      const result = await importUpdateDocument(ctx.actor, tx, id, patch);
      ctx.affectsPublic ||= result.affectsPublic;
      if (plan.pid) await linkIdentity(tx, "document", plan.pid, id, source, metadata);
      const [row] = await tx.select({ slug: documents.slug }).from(documents).where(eq(documents.id, id));
      const docPath = documentPath(ctx.type(plan.typeSlug), row?.slug ?? plan.slug);
      await markDone(tx, item, id, { path: docPath, staged: result.staged, fields: plan.updateFields, cleared: plan.clearFields });
      return docPath;
    });
    ctx.remember(item.key, id, { path });
  }
}

async function runTopic(ctx: RunContext, item: ItemRow): Promise<void> {
  const { topic } = item.payload as { topic: ImportPlan["topics"][number] };
  if (item.action === "map") {
    await ctx.db.transaction(async (tx) => {
      if (topic.existingId) await linkIdentity(tx, "topic", topic.key.slice(4), topic.existingId, ctx.plan.source.system, {});
      await markDone(tx, item, topic.existingId, {});
    });
    ctx.remember(item.key, topic.existingId, {});
    return;
  }
  const create = topic.create!;
  const parentId = create.parentId ?? (create.parentKey ? ctx.topicId(create.parentKey) : null);
  // Idempotent: a retry after a crash finds the category it already created by slug.
  let [existing] = await ctx.db.select({ id: categories.id }).from(categories).where(eq(categories.slug, create.slug)).limit(1);
  if (!existing) {
    const created = await createCategory(ctx.actor, { name: create.name, slug: create.slug, parentId });
    existing = { id: created.id };
  }
  await ctx.db.transaction(async (tx) => {
    if (topic.key.startsWith("pid:")) await linkIdentity(tx, "topic", topic.key.slice(4), existing!.id, ctx.plan.source.system, {});
    await markDone(tx, item, existing!.id, { slug: create.slug });
  });
  ctx.remember(item.key, existing.id, {});
}

async function runTag(ctx: RunContext, item: ItemRow): Promise<void> {
  const { tag } = item.payload as { tag: ImportPlan["tags"][number] };
  // ensureTags is find-or-create by slug, so a retry never duplicates.
  const [id] = await ensureTags(ctx.actor, ctx.db, [tag.name]);
  if (!id) throw invalid(`The tag "${tag.name}" could not be created.`);
  await ctx.db.transaction(async (tx) => markDone(tx, item, id, {}));
  ctx.remember(item.key, id, {});
}

async function runCollection(ctx: RunContext, item: ItemRow): Promise<void> {
  const { collection } = item.payload as { collection: CollectionPlan };
  const collectionId = collection.action === "merge" ? collection.existingId : ctx.landing({ status: "incoming", key: collection.documentKey! }, false)?.id;
  if (!collectionId) throw invalid("The collection document wasn't created, so its items couldn't be added.");
  const members = collection.items
    .map((i) => ({ documentId: ctx.landing({ status: "incoming", key: i.documentKey }, false)?.id ?? null, groupLabel: i.groupLabel, note: i.note }))
    .filter((m): m is { documentId: string; groupLabel: string; note: string } => isUuid(m.documentId));
  await ctx.db.transaction(async (tx) => {
    const { added } = await mergeCollectionItems(ctx.actor, tx, collectionId, members);
    await markDone(tx, item, collectionId, { added, planned: collection.items.length });
  });
}

async function runRelations(ctx: RunContext, item: ItemRow): Promise<void> {
  const { sourceKey, relations } = item.payload as { sourceKey: string; relations: RelationPlan[] };
  const sourceId = ctx.landing({ status: "incoming", key: sourceKey }, false)?.id;
  if (!sourceId) throw invalid("The source document wasn't imported, so its relationships were skipped.");
  const rows = relations
    .map((r) => ({ targetId: ctx.landing(r.target, false)?.id ?? null, kind: r.kind, note: r.note }))
    .filter((r): r is { targetId: string; kind: string; note: string } => isUuid(r.targetId));
  await ctx.db.transaction(async (tx) => {
    const { added } = await mergeManualRelations(ctx.actor, tx, sourceId, rows);
    await markDone(tx, item, sourceId, { added, planned: relations.length });
  });
}

async function runFinalize(ctx: RunContext, item: ItemRow): Promise<void> {
  const { key } = item.payload as { key: string };
  const plan = ctx.docPlan(key);
  const docItem = await ctx.db.select().from(importItems).where(and(eq(importItems.jobId, ctx.job.id), eq(importItems.key, `doc:${key}`))).limit(1);
  const id = docItem[0]?.targetId;
  if (!plan || !id || docItem[0]?.status !== "done") {
    await ctx.db.transaction(async (tx) => markDone(tx, item, null, { skipped: "document not imported" }));
    return;
  }
  const body = (docItem[0]!.payload as { body: Doc | null }).body;
  await ctx.db.transaction(async (tx) => {
    const patch: ImportDocumentPatch = {};
    if (body && writesBody(plan)) patch.content = resolvePlaceholders(body, ctx.resolver(plan));
    const props = ctx.properties(plan);
    if (Object.values(plan.properties).some((p) => p.kind === "documents") && (plan.action !== "update" || plan.updateFields.includes("properties"))) patch.properties = props;
    if (Object.keys(patch).length) await importUpdateDocument(ctx.actor, tx, id, patch);
    await markDone(tx, item, id, {});
  });
}

async function runLinks(ctx: RunContext, item: ItemRow): Promise<void> {
  const rows = await ctx.db
    .select({ targetId: importItems.targetId })
    .from(importItems)
    .where(and(eq(importItems.jobId, ctx.job.id), eq(importItems.stage, "document"), eq(importItems.status, "done")));
  await ctx.db.transaction(async (tx) => {
    await resyncContentRelations(ctx.actor, tx, rows.map((r) => r.targetId).filter((id): id is string => isUuid(id)));
    await markDone(tx, item, null, { documents: rows.length });
  });
}

async function runStatus(ctx: RunContext, item: ItemRow): Promise<void> {
  const { key, status, legacyUrls } = item.payload as { key: string; status: string; legacyUrls: string[] };
  const id = ctx.landing({ status: "incoming", key }, false)?.id;
  if (!id) throw invalid("The document wasn't imported, so its status was not changed.");
  // Through the normal lifecycle, so publishing runs the same checks as the editor.
  const result = await runDocumentAction(ctx.actor, id, status === "published" ? { action: "publish" } : { action: "setStatus", status });
  ctx.affectsPublic ||= result.affectsPublic;
  const redirected: string[] = [];
  if (status === "published" && legacyUrls.length) {
    const [row] = await ctx.db.select({ slug: documents.slug, typeId: documents.typeId }).from(documents).where(eq(documents.id, id));
    const plan = ctx.docPlan(key);
    const path = documentPath(ctx.type(plan?.typeSlug ?? null), row!.slug);
    for (const from of legacyUrls) {
      const [taken] = await ctx.db.select({ id: redirects.id }).from(redirects).where(eq(redirects.fromPath, from)).limit(1);
      if (taken || from === path) continue;
      try {
        await upsertRedirect(ctx.db, { fromPath: from, toPath: path, source: "import" });
        redirected.push(from);
      } catch {
        // An unusable legacy path is reported in the item result, not fatal.
      }
    }
  }
  await ctx.db.transaction(async (tx) => markDone(tx, item, id, { status, redirects: redirected }));
}

async function runVerify(ctx: RunContext, item: ItemRow): Promise<void> {
  const docItems = await ctx.db.select({ targetId: importItems.targetId, action: importItems.action }).from(importItems).where(and(eq(importItems.jobId, ctx.job.id), eq(importItems.stage, "document"), eq(importItems.status, "done")));
  const ids = docItems.map((d) => d.targetId).filter((id): id is string => isUuid(id));
  const found = ids.length ? await ctx.db.select({ id: documents.id }).from(documents).where(inArray(documents.id, ids)) : [];
  const missing = ids.length - found.length;
  // Fail BEFORE marking done: the failure handler only records pending items.
  if (missing) throw invalid(`${missing} imported document${missing === 1 ? " is" : "s are"} missing (deleted during the import?).`);
  await ctx.db.transaction(async (tx) => markDone(tx, item, null, { documents: ids.length }));
}

const HANDLERS: Record<string, (ctx: RunContext, item: ItemRow) => Promise<void>> = {
  topic: runTopic,
  tag: runTag,
  document: runDocument,
  collection: runCollection,
  relations: runRelations,
  finalize: runFinalize,
  links: runLinks,
  status: runStatus,
  verify: runVerify,
};

// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------

export type RunResult = {
  status: string;
  progress: { done: number; failed: number; pending: number; total: number };
  needsAssets: Array<{ key: string; path: string; size: number }>;
  affectsPublic: boolean;
  current: string | null;
};

async function loadOwnedJob(db: Db, actor: AdminActor, id: string) {
  if (!isUuid(id)) throw notFound("Import");
  const [job] = await db.select().from(importJobs).where(and(eq(importJobs.id, id), eq(importJobs.createdBy, actor.userId))).limit(1);
  if (!job) throw notFound("Import");
  return job;
}

async function counts(db: Db, jobId: string) {
  const rows = await db.select({ status: importItems.status, n: sql<number>`count(*)` }).from(importItems).where(eq(importItems.jobId, jobId)).groupBy(importItems.status);
  const get = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  return { done: get("done"), failed: get("failed"), pending: get("pending"), skipped: get("skipped"), cancelled: get("cancelled"), total: rows.reduce((n, r) => n + Number(r.n), 0) };
}

async function failureMessage(error: unknown): Promise<string> {
  if (isServiceError(error)) return error.message;
  console.error("[import] item failed", error instanceof Error ? error.message : error);
  return "Unexpected error while importing this item.";
}

async function finish(db: Db, actor: AdminActor, job: typeof importJobs.$inferSelect, cancelled: boolean): Promise<string> {
  const c = await counts(db, job.id);
  const status = cancelled ? "cancelled" : c.failed === 0 ? "completed" : c.done > 0 ? "partial" : "failed";
  const byStage = await db
    .select({ stage: importItems.stage, action: importItems.action, status: importItems.status, n: sql<number>`count(*)` })
    .from(importItems)
    .where(eq(importItems.jobId, job.id))
    .groupBy(importItems.stage, importItems.action, importItems.status);
  const n = (stage: string, statusName: string, action?: string) => byStage.filter((r) => r.stage === stage && r.status === statusName && (!action || r.action === action)).reduce((s, r) => s + Number(r.n), 0);
  const result = {
    created: n("document", "done", "create"),
    updated: n("document", "done", "update"),
    copied: n("document", "done", "copy"),
    failedDocuments: n("document", "failed"),
    topicsCreated: n("topic", "done", "create"),
    tagsCreated: n("tag", "done", "create"),
    mediaUploaded: n("asset", "done"),
    mediaFailed: n("asset", "failed"),
    collections: n("collection", "done"),
    relationSets: n("relations", "done"),
    published: n("status", "done", "published"),
    statusFailed: n("status", "failed"),
    failed: c.failed,
    cancelled: c.cancelled,
  };
  await db
    .update(importJobs)
    .set({ status, completedAt: new Date(), leaseUntil: null, updatedAt: new Date(), summary: sql`${importJobs.summary} || ${JSON.stringify({ result })}::jsonb` })
    .where(eq(importJobs.id, job.id));
  // Staged sources are no longer needed: every item carries its own payload for retries.
  await db.update(importFiles).set({ content: null }).where(eq(importFiles.jobId, job.id));
  await recordAudit(actor, `import.${status}`, "import", job.id, job.sourceName || "Import", result);
  return status;
}

async function cancelPending(db: Db, jobId: string): Promise<void> {
  await db.update(importItems).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(importItems.jobId, jobId), eq(importItems.status, "pending")));
}

/**
 * Processes pending items in order until the time budget runs out, an
 * upload is needed from the browser, or the work is done. Safe to call
 * repeatedly (and from a resumed tab): a lease stops concurrent runs, and
 * finished items are never run again.
 */
export async function runImportJob(actor: Actor, id: string): Promise<RunResult> {
  assertAdmin(actor);
  const db = getDb();
  let job = await loadOwnedJob(db, actor, id);
  if (job.status !== "running") {
    const c = await counts(db, id);
    return { status: job.status, progress: c, needsAssets: [], affectsPublic: false, current: null };
  }
  const leased = await db
    .update(importJobs)
    .set({ leaseUntil: new Date(Date.now() + RUN_LEASE_MS) })
    .where(and(eq(importJobs.id, id), eq(importJobs.status, "running"), or(isNull(importJobs.leaseUntil), lt(importJobs.leaseUntil, new Date()))))
    .returning();
  if (!leased.length) throw conflict("This import is already running in another tab.");
  job = leased[0]!;

  const ctx = new RunContext(db, actor, job, job.plan as ImportPlan);
  await ctx.load();
  const deadline = Date.now() + RUN_BUDGET_MS;
  let current: string | null = null;
  try {
    for (;;) {
      const [fresh] = await db.select({ cancel: importJobs.cancelRequested }).from(importJobs).where(eq(importJobs.id, id));
      if (fresh?.cancel) {
        await cancelPending(db, id);
        const status = await finish(db, actor, job, true);
        return { status, progress: await counts(db, id), needsAssets: [], affectsPublic: ctx.affectsPublic, current: null };
      }
      const [next] = await db.select().from(importItems).where(and(eq(importItems.jobId, id), eq(importItems.status, "pending"))).orderBy(asc(importItems.seq), asc(importItems.id)).limit(1);
      if (!next) {
        const status = await finish(db, actor, job, false);
        return { status, progress: await counts(db, id), needsAssets: [], affectsPublic: ctx.affectsPublic, current: null };
      }
      if (next.stage === "asset") {
        const waiting = await db.select().from(importItems).where(and(eq(importItems.jobId, id), eq(importItems.status, "pending"), eq(importItems.stage, "asset"))).orderBy(asc(importItems.id)).limit(200);
        return {
          status: "running",
          progress: await counts(db, id),
          needsAssets: waiting.map((w) => ({ key: w.key, path: String((w.payload as { media: MediaPlan }).media.path ?? ""), size: (w.payload as { media: MediaPlan }).media.size })),
          affectsPublic: ctx.affectsPublic,
          current: "Waiting for media files",
        };
      }
      current = next.label;
      try {
        const handler = HANDLERS[next.stage];
        if (!handler) throw invalid(`Unknown step "${next.stage}".`);
        await handler(ctx, next);
      } catch (error) {
        if (!(isServiceError(error) && error.message === "This item was already processed.")) {
          await db
            .update(importItems)
            .set({ status: "failed", error: await failureMessage(error), attempts: sql`${importItems.attempts} + 1`, updatedAt: new Date() })
            .where(and(eq(importItems.id, next.id), eq(importItems.status, "pending")));
        }
      }
      await db.update(importJobs).set({ leaseUntil: new Date(Date.now() + RUN_LEASE_MS), updatedAt: new Date() }).where(eq(importJobs.id, id));
      if (Date.now() > deadline) {
        return { status: "running", progress: await counts(db, id), needsAssets: [], affectsPublic: ctx.affectsPublic, current };
      }
    }
  } finally {
    await db.update(importJobs).set({ leaseUntil: null }).where(and(eq(importJobs.id, id), eq(importJobs.status, "running")));
  }
}

// ---------------------------------------------------------------------------
// Media uploads from the browser
// ---------------------------------------------------------------------------

/**
 * Uploads the bytes for one planned asset. The file must be exactly the one
 * analysed (same SHA-256); it then goes through the normal media pipeline
 * (signature sniffing, re-encoding, storage).
 */
export async function uploadImportAsset(actor: Actor, id: string, key: string, file: { bytes: Buffer; declaredType: string }): Promise<{ key: string; mediaId: string; reused: boolean }> {
  assertAdmin(actor);
  const db = getDb();
  const job = await loadOwnedJob(db, actor, id);
  if (job.status !== "running") throw conflict("This import is not running.");
  const [item] = await db.select().from(importItems).where(and(eq(importItems.jobId, id), eq(importItems.key, key))).limit(1);
  if (!item || item.stage !== "asset") throw notFound("Media item");
  if (item.status !== "pending") return { key, mediaId: item.targetId ?? "", reused: true };
  assertMediaUploadAllowed();
  const { media: planned, system } = item.payload as { media: MediaPlan; system: string };
  if (file.bytes.length > maxUploadBytes()) throw new ServiceError("too_large", "File is too large.");
  const sha = createHash("sha256").update(file.bytes).digest("hex");
  if (planned.sha256 && sha !== planned.sha256) throw invalid(`"${planned.path}" doesn't match the file that was analysed. Choose the same folder or archive again.`);

  // An identical file imported before (or a retry of this one) is reused, not uploaded twice.
  const [known] = await db.select({ mediaId: portableIdentities.mediaId }).from(portableIdentities).where(and(eq(portableIdentities.entity, "media"), eq(portableIdentities.portableId, `sha256:${sha}`))).limit(1);
  let mediaId = known?.mediaId ?? null;
  let url: string;
  const reused = Boolean(mediaId);
  if (!mediaId) {
    const asset = await uploadMedia(actor, { bytes: file.bytes, filename: basename(planned.path ?? "file"), declaredType: file.declaredType, alt: planned.alt });
    mediaId = asset.id;
    url = asset.url;
  } else {
    const [row] = await db.select({ storageKey: media.storageKey }).from(media).where(eq(media.id, mediaId)).limit(1);
    url = getStorage().urlFor(row!.storageKey);
  }
  await db.transaction(async (tx) => {
    await linkIdentity(tx, "media", `sha256:${sha}`, mediaId!, system, { sourcePath: planned.path, jobId: id });
    await tx
      .update(importItems)
      .set({ status: "done", targetId: mediaId, result: { url, reused }, error: null, attempts: sql`${importItems.attempts} + 1`, updatedAt: new Date() })
      .where(and(eq(importItems.id, item.id), eq(importItems.status, "pending")));
  });
  return { key, mediaId, reused };
}

// ---------------------------------------------------------------------------
// Cancel, retry, skip uploads
// ---------------------------------------------------------------------------

export async function controlImportJob(actor: Actor, id: string, input: unknown): Promise<{ status: string }> {
  assertAdmin(actor);
  const action = (input as { action?: unknown } | null)?.action;
  const db = getDb();
  const job = await loadOwnedJob(db, actor, id);
  switch (action) {
    case "cancel": {
      if (job.status === "staging" || job.status === "analyzed") {
        await db.update(importJobs).set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() }).where(eq(importJobs.id, id));
        await db.update(importFiles).set({ content: null }).where(eq(importFiles.jobId, id));
        return { status: "cancelled" };
      }
      if (job.status !== "running") throw conflict("Only a running import can be cancelled.");
      await db.update(importJobs).set({ cancelRequested: true, updatedAt: new Date() }).where(eq(importJobs.id, id));
      // Nobody is running it right now: cancel immediately. Otherwise the running request stops at its next item.
      const idle = !job.leaseUntil || job.leaseUntil < new Date();
      if (idle) {
        await cancelPending(db, id);
        return { status: await finish(db, actor, job, true) };
      }
      return { status: "running" };
    }
    case "retry": {
      if (job.status !== "partial" && job.status !== "failed") throw conflict("Only an import with failures can be retried.");
      await db.transaction(async (tx) => {
        await tx.update(importItems).set({ status: "pending", error: null, updatedAt: new Date() }).where(and(eq(importItems.jobId, id), eq(importItems.status, "failed")));
        // Steps that gather results from other documents are re-run: a document that
        // failed earlier may now exist and must join its collection, relations and links.
        // All of them are idempotent merges (existing members and relations are kept).
        await tx.update(importItems).set({ status: "pending", updatedAt: new Date() }).where(and(eq(importItems.jobId, id), inArray(importItems.stage, ["collection", "relations", "finalize", "links", "verify"]), eq(importItems.status, "done")));
        await tx.update(importJobs).set({ status: "running", completedAt: null, cancelRequested: false, updatedAt: new Date() }).where(eq(importJobs.id, id));
      });
      return { status: "running" };
    }
    case "skipAssets": {
      if (job.status !== "running") throw conflict("This import is not running.");
      await db
        .update(importItems)
        .set({ status: "failed", error: "Not uploaded: the file wasn't available. A placeholder marks where it was used.", updatedAt: new Date() })
        .where(and(eq(importItems.jobId, id), eq(importItems.stage, "asset"), eq(importItems.status, "pending")));
      return { status: "running" };
    }
    default:
      throw invalid("Unknown action.");
  }
}
