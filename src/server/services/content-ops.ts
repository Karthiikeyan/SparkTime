import "server-only";
import { and, asc, count, countDistinct, eq, inArray, max, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { isUuid } from "@/lib/content/blocks";
import {
  BULK_ACTION_TEXT,
  MAX_BULK_CHUNK,
  MAX_BULK_SELECTION,
  PERMANENT_DELETE_TOKEN,
  REVERSIBLE_ACTIONS,
  UNDO_WINDOW_MINUTES,
  type BulkActionName,
} from "@/lib/content/bulk-actions";
import { ROBOTS_OPTIONS, TRASHED, VISIBILITIES } from "@/lib/content/model";
import { assertAdmin, type Actor, type AdminActor } from "../auth/actor";
import { getDb, type Db } from "../db/client";
import { auditLogs, categories, collectionItems, contentTypes, documentCategories, documentRelations, documents, documentTags, tags, type DocumentRow } from "../db/schema";
import { conflict, invalid, isServiceError, notFound, ServiceError } from "../errors";
import { recordAudit } from "./audit";
import { documentIdsMatching, duplicateRow, FILTER_PARAMS, loadRow, parseDocumentFilters, publishRow, requireType, setRowStatus, trashRow } from "./documents";
import { refreshSearchExtra } from "./search-index";
import { isAccessible } from "./visibility";

/**
 * Bulk content operations (docs/ADMIN-OPERATIONS.md).
 *
 * The browser runs an operation as a sequence of bounded chunks, each one a
 * request to runBulkChunk() carrying an action from a fixed allowlist and at
 * most MAX_BULK_CHUNK ids. Nothing the browser sends is trusted beyond that:
 * every id is re-read here, the target state comes from the action name, and
 * the actor comes from the session.
 *
 *  - Lifecycle actions (draft, publish, archive, trash, restore, duplicate)
 *    run each document in its own short transaction with a row lock, so one
 *    failure never rolls back the others and nothing holds locks for long.
 *  - Field and link actions (featured, visibility, topics, tags, collections)
 *    and permanent deletion are set-based: one transaction per chunk, a few
 *    statements regardless of the chunk size.
 *
 * Every chunk records one audit row (`bulk.<action>`) with counts, failure
 * reasons and, for reversible actions, the previous state of each document it
 * changed. undoBulkOperation() reverts from those rows — never from anything
 * the browser sends — and only where a document is still in the state the
 * operation left it in.
 */

const uuid = z.string().refine(isUuid, "Invalid id.");

export const bulkActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("draft") }),
  z.strictObject({ action: z.literal("publish") }),
  z.strictObject({ action: z.literal("archive") }),
  z.strictObject({ action: z.literal("trash") }),
  z.strictObject({ action: z.literal("restore") }),
  z.strictObject({ action: z.literal("delete"), confirm: z.literal(PERMANENT_DELETE_TOKEN, "Permanent deletion must be confirmed.") }),
  z.strictObject({ action: z.literal("duplicate") }),
  z.strictObject({ action: z.literal("featured"), value: z.boolean() }),
  z.strictObject({ action: z.literal("visibility"), value: z.enum(VISIBILITIES) }),
  z.strictObject({ action: z.literal("indexing"), value: z.enum(ROBOTS_OPTIONS) }),
  z.strictObject({ action: z.literal("addTopic"), categoryId: uuid }),
  z.strictObject({ action: z.literal("removeTopic"), categoryId: uuid }),
  z.strictObject({ action: z.literal("addTag"), tagId: uuid }),
  z.strictObject({ action: z.literal("removeTag"), tagId: uuid }),
  z.strictObject({ action: z.literal("addToCollection"), collectionId: uuid }),
  z.strictObject({ action: z.literal("removeFromCollection"), collectionId: uuid }),
]);
export type BulkAction = z.infer<typeof bulkActionSchema>;

const runSchema = z.strictObject({
  operationId: uuid,
  ids: z.array(uuid).min(1, "Select at least one document.").max(MAX_BULK_CHUNK, `Send at most ${MAX_BULK_CHUNK} documents per request.`),
  action: bulkActionSchema,
});

export type BulkOutcome = "updated" | "unchanged" | "failed";
export type BulkItemResult = { id: string; title: string; outcome: BulkOutcome; message?: string };
export type BulkRunResult = {
  operationId: string;
  action: BulkActionName;
  requested: number;
  updated: number;
  unchanged: number;
  failed: number;
  items: BulkItemResult[];
  /** True when at least one document changed and the action can be undone. */
  undoable: boolean;
  affectsPublic: boolean;
};

// ---------------------------------------------------------------------------
// Undo records (stored in audit_logs.metadata.undo — ids and scalar state only, never bodies)
// ---------------------------------------------------------------------------

type StatusSnapshot = { status: string; publishedAt: string | null; modifiedAt: string | null; trashedAt: string | null; trashedBy: string | null };
type UndoEntry =
  | { kind: "status"; id: string; set: string; prev: StatusSnapshot; folded: boolean }
  | { kind: "duplicate"; id: string; newId: string }
  | { kind: "featured"; id: string; prev: boolean }
  | { kind: "visibility"; id: string; prev: string }
  | { kind: "indexing"; id: string; prev: string }
  | { kind: "topicAdded"; id: string }
  | { kind: "topicRemoved"; id: string; primary: boolean }
  | { kind: "tagAdded"; id: string }
  | { kind: "tagRemoved"; id: string }
  | { kind: "itemAdded"; id: string }
  | { kind: "itemRemoved"; id: string; position: number; groupLabel: string; note: string };

type BulkMetadata = {
  operationId: string;
  action: BulkActionName;
  params: Record<string, unknown>;
  requested: number;
  updated: number;
  unchanged: number;
  failed: number;
  failures: Array<{ id: string; title: string; message: string }>;
  undo: UndoEntry[];
  deleted?: Array<{ id: string; title: string; slug: string }>;
};

function snapshot(row: DocumentRow): StatusSnapshot {
  return {
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    modifiedAt: row.modifiedAt?.toISOString() ?? null,
    trashedAt: row.trashedAt?.toISOString() ?? null,
    trashedBy: row.trashedBy,
  };
}

/** A message that is safe and useful to show the owner. Anything unexpected is logged, not echoed. */
function failureMessage(error: unknown): string {
  if (isServiceError(error)) {
    const detail = error.details ? Object.values(error.details)[0] : undefined;
    return detail && detail !== error.message ? `${error.message} ${detail}` : error.message;
  }
  console.error("[bulk] unexpected error", error);
  return "Unexpected database error. Details were logged on the server.";
}

const IN_TRASH = "It is in the Trash. Restore it first.";

// ---------------------------------------------------------------------------
// Run one chunk
// ---------------------------------------------------------------------------

type ItemChange = { outcome: "updated" | "unchanged"; message?: string; undo?: UndoEntry; affectsPublic?: boolean; title?: string };
type Collector = {
  results: Map<string, BulkItemResult>;
  undo: UndoEntry[];
  affectsPublic: boolean;
  deleted: Array<{ id: string; title: string; slug: string }>;
};

export async function runBulkChunk(actor: Actor, input: unknown): Promise<BulkRunResult> {
  assertAdmin(actor);
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid bulk request.");
  const { operationId, action } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];
  const db = getDb();

  // Titles for the result report, and to tell "missing" from "present".
  const known = new Map(
    (await db.select({ id: documents.id, title: documents.title }).from(documents).where(inArray(documents.id, ids))).map((r) => [r.id, r.title || "Untitled"]),
  );
  const out: Collector = { results: new Map(), undo: [], affectsPublic: false, deleted: [] };
  const present = ids.filter((id) => known.has(id));
  for (const id of ids) {
    if (known.has(id)) continue;
    // Deleting something already gone is a no-op, so a retried delete stays deterministic.
    out.results.set(id, action.action === "delete" ? { id, title: "(deleted)", outcome: "unchanged", message: "Already deleted." } : { id, title: "(not found)", outcome: "failed", message: "Not found. It may have been deleted." });
  }

  const record = (id: string, change: ItemChange) => {
    out.results.set(id, { id, title: change.title ?? known.get(id) ?? "Untitled", outcome: change.outcome, message: change.message });
    if (change.undo) out.undo.push(change.undo);
    if (change.affectsPublic) out.affectsPublic = true;
  };
  const fail = (id: string, error: unknown) => out.results.set(id, { id, title: known.get(id) ?? "Untitled", outcome: "failed", message: failureMessage(error) });

  /** One short transaction per document, row locked: a failure is isolated to that document. */
  const eachLocked = async (fn: (tx: Db, row: DocumentRow) => Promise<ItemChange>) => {
    for (const id of present) {
      try {
        record(id, await db.transaction(async (tx) => fn(tx, await loadRow(tx, id, { lock: true }))));
      } catch (error) {
        fail(id, error);
      }
    }
  };

  switch (action.action) {
    case "draft":
    case "archive": {
      const next = action.action === "draft" ? "draft" : "archived";
      await eachLocked(async (tx, row) => {
        if (row.status === TRASHED) throw conflict(IN_TRASH);
        if (row.status === next) return { outcome: "unchanged", message: `Already ${next === "draft" ? "a draft" : "archived"}.` };
        const prev = snapshot(row);
        const { folded } = await setRowStatus(tx, row, next);
        return {
          outcome: "updated",
          undo: { kind: "status", id: row.id, set: next, prev, folded },
          affectsPublic: isAccessible(row) || isAccessible({ status: next, visibility: row.visibility }),
          message: folded ? "Its staged edits were merged into the document." : undefined,
        };
      });
      break;
    }
    case "publish":
      await eachLocked(async (tx, row) => {
        if (row.status === TRASHED) throw conflict(IN_TRASH);
        // Bulk publish never applies staged edits to something already live: that stays a per-document decision.
        if (row.status === "published") return { outcome: "unchanged", message: row.workingCopy ? "Already published. Its staged edits were left unpublished." : "Already published." };
        const prev = snapshot(row);
        await publishRow(tx, row);
        return { outcome: "updated", undo: { kind: "status", id: row.id, set: "published", prev, folded: false }, affectsPublic: true };
      });
      break;
    case "trash":
      await eachLocked(async (tx, row) => {
        if (row.status === TRASHED) return { outcome: "unchanged", message: "Already in the Trash." };
        const prev = snapshot(row);
        await trashRow(tx, row, actor);
        return { outcome: "updated", undo: { kind: "status", id: row.id, set: TRASHED, prev, folded: false }, affectsPublic: isAccessible(row) };
      });
      break;
    case "restore":
      await eachLocked(async (tx, row) => {
        if (row.status !== TRASHED) return { outcome: "unchanged", message: "Not in the Trash." };
        const prev = snapshot(row);
        const { folded } = await setRowStatus(tx, row, "draft");
        return { outcome: "updated", undo: { kind: "status", id: row.id, set: "draft", prev, folded } };
      });
      break;
    case "duplicate": {
      const done = await duplicatedInOperation(db, actor, operationId);
      await eachLocked(async (tx, row) => {
        if (done.has(row.id)) return { outcome: "unchanged", message: "Already duplicated by this operation." };
        if (row.status === TRASHED) throw conflict(IN_TRASH);
        const newId = await duplicateRow(tx, row);
        return { outcome: "updated", undo: { kind: "duplicate", id: row.id, newId } };
      });
      break;
    }
    case "delete":
      await permanentlyDelete(db, present, out, known);
      break;
    default:
      await setBased(db, action, present, out, known);
  }

  const items = ids.map((id) => out.results.get(id)!);
  const tally = (o: BulkOutcome) => items.filter((i) => i.outcome === o).length;
  const result: BulkRunResult = {
    operationId,
    action: action.action,
    requested: ids.length,
    updated: tally("updated"),
    unchanged: tally("unchanged"),
    failed: tally("failed"),
    items,
    undoable: REVERSIBLE_ACTIONS.has(action.action) && out.undo.length > 0,
    affectsPublic: out.affectsPublic || out.deleted.length > 0,
  };

  const { action: _name, ...params } = action as Record<string, unknown>;
  void _name;
  const metadata: BulkMetadata = {
    operationId,
    action: action.action,
    params: Object.fromEntries(Object.entries(params).filter(([key]) => key !== "confirm")),
    requested: result.requested,
    updated: result.updated,
    unchanged: result.unchanged,
    failed: result.failed,
    failures: items.filter((i) => i.outcome === "failed").map((i) => ({ id: i.id, title: i.title, message: i.message ?? "" })),
    undo: out.undo,
    ...(out.deleted.length ? { deleted: out.deleted } : {}),
  };
  const summary = `${BULK_ACTION_TEXT[action.action].verb}: ${result.updated} changed, ${result.unchanged} unchanged, ${result.failed} failed`;
  await recordAudit(actor, `bulk.${action.action}`, "document", null, summary, metadata);
  return result;
}

/** Sources this operation has already duplicated (a replayed chunk must not copy twice). */
async function duplicatedInOperation(db: Db, actor: AdminActor, operationId: string): Promise<Set<string>> {
  const rows = await operationRows(db, operationId);
  return new Set(
    rows
      .filter((r) => r.action === "bulk.duplicate" && r.actorId === actor.userId)
      .flatMap((r) => ((r.metadata as Partial<BulkMetadata>).undo ?? []).map((u) => u.id)),
  );
}

async function operationRows(db: Db, operationId: string) {
  return db
    .select()
    .from(auditLogs)
    .where(and(sql`${auditLogs.metadata} ? 'operationId'`, sql`${auditLogs.metadata}->>'operationId' = ${operationId}`))
    .orderBy(asc(auditLogs.id));
}

async function permanentlyDelete(db: Db, ids: string[], out: Collector, known: Map<string, string>): Promise<void> {
  if (!ids.length) return;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: documents.id, title: documents.title, slug: documents.slug, status: documents.status })
      .from(documents)
      .where(inArray(documents.id, ids))
      .for("update");
    const trashed = rows.filter((r) => r.status === TRASHED);
    for (const r of rows.filter((r) => r.status !== TRASHED)) {
      out.results.set(r.id, { id: r.id, title: known.get(r.id) ?? "Untitled", outcome: "failed", message: "Not in the Trash. Move it to the Trash before deleting it permanently." });
    }
    if (!trashed.length) return;
    const removed = await tx
      .delete(documents)
      .where(and(inArray(documents.id, trashed.map((r) => r.id)), eq(documents.status, TRASHED)))
      .returning({ id: documents.id });
    const gone = new Set(removed.map((r) => r.id));
    for (const r of trashed) {
      if (gone.has(r.id)) {
        out.results.set(r.id, { id: r.id, title: known.get(r.id) ?? "Untitled", outcome: "updated" });
        out.deleted.push({ id: r.id, title: r.title, slug: r.slug });
      } else {
        out.results.set(r.id, { id: r.id, title: known.get(r.id) ?? "Untitled", outcome: "failed", message: "It changed while being deleted. Try again." });
      }
    }
  });
}

/** Field and link changes: one transaction per chunk, a fixed number of statements. */
async function setBased(db: Db, action: Exclude<BulkAction, { action: "draft" | "publish" | "archive" | "trash" | "restore" | "duplicate" | "delete" }>, ids: string[], out: Collector, known: Map<string, string>) {
  if (!ids.length) return;
  const mark = (id: string, outcome: "updated" | "unchanged", message?: string) => out.results.set(id, { id, title: known.get(id) ?? "Untitled", outcome, message });

  await db.transaction(async (tx) => {
    // Lock the rows so a concurrent lifecycle change can't interleave, and to read status/visibility once.
    const rows = await tx
      .select({ id: documents.id, status: documents.status, visibility: documents.visibility, featured: documents.featured, robotsIndex: documents.robotsIndex })
      .from(documents)
      .where(inArray(documents.id, ids))
      .for("no key update");
    const editable = rows.filter((r) => r.status !== TRASHED);
    for (const r of rows.filter((r) => r.status === TRASHED)) out.results.set(r.id, { id: r.id, title: known.get(r.id) ?? "Untitled", outcome: "failed", message: IN_TRASH });
    const touch = async (changed: string[], bumpVersion = false) => {
      if (!changed.length) return;
      await tx
        .update(documents)
        .set(bumpVersion ? { updatedAt: new Date(), version: sql`${documents.version} + 1` } : { updatedAt: new Date() })
        .where(inArray(documents.id, changed));
      if (editable.some((r) => changed.includes(r.id) && isAccessible(r))) out.affectsPublic = true;
    };

    switch (action.action) {
      case "featured":
      case "visibility":
      case "indexing": {
        const patch = action.action === "featured" ? { featured: action.value } : action.action === "visibility" ? { visibility: action.value } : { robotsIndex: action.value };
        const current = (r: (typeof editable)[number]) => (action.action === "featured" ? r.featured : action.action === "visibility" ? r.visibility : r.robotsIndex);
        const changed = editable.filter((r) => current(r) !== action.value);
        for (const r of editable) if (!changed.includes(r)) mark(r.id, "unchanged", "Already set.");
        if (!changed.length) return;
        await tx
          .update(documents)
          .set({ ...patch, updatedAt: new Date(), version: sql`${documents.version} + 1` })
          .where(inArray(documents.id, changed.map((r) => r.id)));
        for (const r of changed) {
          mark(r.id, "updated");
          out.undo.push(action.action === "featured" ? { kind: "featured", id: r.id, prev: r.featured } : action.action === "visibility" ? { kind: "visibility", id: r.id, prev: r.visibility } : { kind: "indexing", id: r.id, prev: r.robotsIndex });
          if (isAccessible(r) || (action.action === "visibility" && isAccessible({ status: r.status, visibility: action.value }))) out.affectsPublic = true;
        }
        return;
      }

      case "addTopic":
      case "removeTopic": {
        const [category] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, action.categoryId)).limit(1);
        if (!category) throw notFound("Topic");
        const ids = editable.map((r) => r.id);
        const links = ids.length ? await tx.select().from(documentCategories).where(inArray(documentCategories.documentId, ids)) : [];
        const has = new Map(links.filter((l) => l.categoryId === action.categoryId).map((l) => [l.documentId, l]));
        if (action.action === "addTopic") {
          const withAny = new Set(links.map((l) => l.documentId));
          const adding = ids.filter((id) => !has.has(id));
          for (const id of ids) if (has.has(id)) mark(id, "unchanged", "Already in this topic.");
          if (adding.length) {
            // The first topic a document gets becomes its primary topic, as in the editor.
            await tx.insert(documentCategories).values(adding.map((documentId) => ({ documentId, categoryId: action.categoryId, isPrimary: !withAny.has(documentId) }))).onConflictDoNothing();
          }
          for (const id of adding) {
            mark(id, "updated");
            out.undo.push({ kind: "topicAdded", id });
          }
          await refreshSearchExtra(tx, adding);
          await touch(adding);
        } else {
          const removing = ids.filter((id) => has.has(id));
          for (const id of ids) if (!has.has(id)) mark(id, "unchanged", "Not in this topic.");
          if (removing.length) {
            await tx.delete(documentCategories).where(and(eq(documentCategories.categoryId, action.categoryId), inArray(documentCategories.documentId, removing)));
            await repairPrimaryTopics(tx, removing);
          }
          for (const id of removing) {
            mark(id, "updated");
            out.undo.push({ kind: "topicRemoved", id, primary: has.get(id)!.isPrimary });
          }
          await refreshSearchExtra(tx, removing);
          await touch(removing);
        }
        return;
      }

      case "addTag":
      case "removeTag": {
        const [tag] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.id, action.tagId)).limit(1);
        if (!tag) throw notFound("Tag");
        const ids = editable.map((r) => r.id);
        const tagged = new Set(
          ids.length ? (await tx.select({ id: documentTags.documentId }).from(documentTags).where(and(eq(documentTags.tagId, action.tagId), inArray(documentTags.documentId, ids)))).map((r) => r.id) : [],
        );
        const changing = ids.filter((id) => (action.action === "addTag" ? !tagged.has(id) : tagged.has(id)));
        for (const id of ids) if (!changing.includes(id)) mark(id, "unchanged", action.action === "addTag" ? "Already has this tag." : "Doesn't have this tag.");
        if (changing.length) {
          if (action.action === "addTag") await tx.insert(documentTags).values(changing.map((documentId) => ({ documentId, tagId: action.tagId }))).onConflictDoNothing();
          else await tx.delete(documentTags).where(and(eq(documentTags.tagId, action.tagId), inArray(documentTags.documentId, changing)));
        }
        for (const id of changing) {
          mark(id, "updated");
          out.undo.push({ kind: action.action === "addTag" ? "tagAdded" : "tagRemoved", id });
        }
        await refreshSearchExtra(tx, changing);
        await touch(changing);
        return;
      }

      case "addToCollection":
      case "removeFromCollection": {
        const collection = await loadRow(tx, action.collectionId, { lock: true });
        if (collection.status === TRASHED) throw conflict("That collection is in the Trash.");
        const type = await requireType(tx, collection.typeId);
        if (type.template !== "collection") throw invalid("Only collection-format documents can hold items.");
        const ids = editable.map((r) => r.id);
        const members = new Map(
          (await tx.select().from(collectionItems).where(eq(collectionItems.collectionId, collection.id))).map((m) => [m.documentId, m]),
        );
        if (action.action === "addToCollection") {
          const adding = ids.filter((id) => id !== collection.id && !members.has(id));
          for (const id of ids) {
            if (id === collection.id) out.results.set(id, { id, title: known.get(id) ?? "Untitled", outcome: "failed", message: "A collection can't contain itself." });
            else if (members.has(id)) mark(id, "unchanged", "Already in this collection.");
          }
          if (adding.length) {
            const [{ last } = { last: null }] = await tx.select({ last: max(collectionItems.position) }).from(collectionItems).where(eq(collectionItems.collectionId, collection.id));
            const start = (last ?? -1) + 1;
            await tx.insert(collectionItems).values(adding.map((documentId, n) => ({ collectionId: collection.id, documentId, position: start + n }))).onConflictDoNothing();
          }
          for (const id of adding) {
            mark(id, "updated");
            out.undo.push({ kind: "itemAdded", id });
          }
        } else {
          const removing = ids.filter((id) => members.has(id));
          for (const id of ids) if (!members.has(id)) mark(id, "unchanged", "Not in this collection.");
          if (removing.length) await tx.delete(collectionItems).where(and(eq(collectionItems.collectionId, collection.id), inArray(collectionItems.documentId, removing)));
          for (const id of removing) {
            const m = members.get(id)!;
            mark(id, "updated");
            out.undo.push({ kind: "itemRemoved", id, position: m.position, groupLabel: m.groupLabel, note: m.note });
          }
        }
        if (out.undo.length) {
          await tx.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, collection.id));
          if (isAccessible(collection)) out.affectsPublic = true;
        }
        return;
      }
    }
  });
}

/** After topics are removed, a document that lost its primary topic gets its first remaining one as primary. */
async function repairPrimaryTopics(tx: Db, documentIds: string[]): Promise<void> {
  if (!documentIds.length) return;
  const list = sql.join(documentIds.map((id) => sql`${id}::uuid`), sql`, `);
  await tx.execute(sql`
    update studio.document_categories dc set is_primary = true
    from (
      select distinct on (x.document_id) x.document_id, x.category_id
      from studio.document_categories x
      where x.document_id in (${list})
      order by x.document_id, x.category_id
    ) first
    where dc.document_id = first.document_id and dc.category_id = first.category_id
      and not exists (select 1 from studio.document_categories p where p.document_id = dc.document_id and p.is_primary)`);
}

// ---------------------------------------------------------------------------
// Selection: resolve "these ids" or "everything matching this filter", with a preview
// ---------------------------------------------------------------------------

const filterSchema = z.strictObject(Object.fromEntries(FILTER_PARAMS.map((key) => [key, z.string().max(200).optional()])) as Record<(typeof FILTER_PARAMS)[number], z.ZodOptional<z.ZodString>>);

const selectSchema = z.strictObject({
  selection: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("ids"), ids: z.array(uuid).min(1).max(MAX_BULK_SELECTION) }),
    z.strictObject({ kind: z.literal("filter"), filter: filterSchema, exclude: z.array(uuid).max(MAX_BULK_SELECTION).default([]) }),
  ]),
});

export type SelectionPreview = {
  ids: string[];
  /** How many matched before the cap. */
  matched: number;
  truncated: boolean;
  byStatus: Record<string, number>;
  /** Selected documents a visitor can currently open. */
  live: number;
  /** Published documents outside the selection that link to it (they'll show broken links if it goes). */
  linkedFrom: number;
  /** Collections outside the selection that include it. */
  inCollections: number;
  /** Selected documents with staged (unpublished) edits. */
  staged: number;
};

/**
 * Resolves a selection server-side. For "all matching" the browser sends the
 * list's filter, which is validated exactly as the list validates it; only
 * ids (never document records) go back to the browser.
 */
export async function resolveSelection(actor: Actor, input: unknown): Promise<SelectionPreview> {
  assertAdmin(actor);
  const parsed = selectSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid selection.");
  const { selection } = parsed.data;
  const db = getDb();
  let ids: string[];
  let matched: number;
  if (selection.kind === "ids") {
    const found = await db.select({ id: documents.id }).from(documents).where(inArray(documents.id, [...new Set(selection.ids)]));
    ids = found.map((r) => r.id);
    matched = ids.length;
  } else {
    const exclude = new Set(selection.exclude);
    const resolved = await documentIdsMatching(actor, parseDocumentFilters(selection.filter), MAX_BULK_SELECTION + exclude.size);
    ids = resolved.ids.filter((id) => !exclude.has(id)).slice(0, MAX_BULK_SELECTION);
    matched = Math.max(0, resolved.total - exclude.size);
  }
  const empty: SelectionPreview = { ids, matched, truncated: matched > ids.length, byStatus: {}, live: 0, linkedFrom: 0, inCollections: 0, staged: 0 };
  if (!ids.length) return empty;

  const [statusRows, [links], [collections]] = await Promise.all([
    db
      .select({
        status: documents.status,
        n: count(),
        live: sql<number>`count(*) filter (where ${documents.status} in ('published', 'archived') and ${documents.visibility} in ('public', 'unlisted'))`,
        staged: sql<number>`count(*) filter (where ${documents.workingCopy} is not null)`,
      })
      .from(documents)
      .where(inArray(documents.id, ids))
      .groupBy(documents.status),
    db
      .select({ n: countDistinct(documentRelations.sourceId) })
      .from(documentRelations)
      .innerJoin(documents, eq(documents.id, documentRelations.sourceId))
      .where(and(inArray(documentRelations.targetId, ids), notInArray(documentRelations.sourceId, ids), eq(documents.status, "published"), ne(documents.visibility, "private"))),
    db
      .select({ n: countDistinct(collectionItems.collectionId) })
      .from(collectionItems)
      .where(and(inArray(collectionItems.documentId, ids), notInArray(collectionItems.collectionId, ids))),
  ]);
  return {
    ...empty,
    byStatus: Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)])),
    live: statusRows.reduce((sum, r) => sum + Number(r.live), 0),
    staged: statusRows.reduce((sum, r) => sum + Number(r.staged), 0),
    linkedFrom: Number(links?.n ?? 0),
    inCollections: Number(collections?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export type UndoResult = { operationId: string; action: BulkActionName; reverted: number; skipped: Array<{ id: string; title: string; reason: string }>; affectsPublic: boolean };

const undoSchema = z.strictObject({ operationId: uuid });

export async function undoBulkOperation(actor: Actor, input: unknown): Promise<UndoResult> {
  assertAdmin(actor);
  const parsed = undoSchema.safeParse(input);
  if (!parsed.success) throw invalid("Unknown operation.");
  const { operationId } = parsed.data;
  const db = getDb();

  // Claim the undo under an advisory lock so two clicks (or tabs) can't both run it.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bulk-undo:${operationId}`}))`);
    const all = await operationRows(tx, operationId);
    const chunks = all.filter((r) => r.action.startsWith("bulk.") && r.action !== "bulk.undo");
    if (!chunks.length) throw notFound("Operation");
    if (chunks.some((r) => r.actorId !== actor.userId)) throw new ServiceError("forbidden", "Only the person who ran an operation can undo it.");
    if (all.some((r) => r.action === "bulk.undo")) throw conflict("This operation has already been undone.");
    const name = (chunks[0]!.metadata as Partial<BulkMetadata>).action;
    if (!name || !REVERSIBLE_ACTIONS.has(name)) throw invalid("This operation can't be undone.");
    const age = Date.now() - chunks[0]!.createdAt.getTime();
    if (age > UNDO_WINDOW_MINUTES * 60_000) throw conflict(`Undo is available for ${UNDO_WINDOW_MINUTES} minutes after an operation. Make the change again instead.`);
    await tx.insert(auditLogs).values({ actorId: actor.userId, action: "bulk.undo", entityType: "document", entityId: null, summary: "Undo started", metadata: { operationId, action: name } });
    return chunks;
  });

  const meta = rows.map((r) => r.metadata as BulkMetadata);
  const action = meta[0]!.action;
  const params = meta[0]!.params;
  const entries = meta.flatMap((m) => m.undo ?? []);
  const titles = new Map(
    entries.length ? (await db.select({ id: documents.id, title: documents.title }).from(documents).where(inArray(documents.id, [...new Set(entries.map((e) => e.id))]))).map((r) => [r.id, r.title || "Untitled"]) : [],
  );
  const skipped: UndoResult["skipped"] = [];
  const skip = (id: string, reason: string) => skipped.push({ id, title: titles.get(id) ?? "(deleted)", reason });
  let reverted = 0;

  // One short transaction per document, like the operation itself.
  for (const entry of entries) {
    try {
      const done = await db.transaction(async (tx) => revertEntry(tx, entry, params));
      if (done === true) reverted++;
      else skip(entry.id, done.reason);
    } catch (error) {
      skip(entry.id, failureMessage(error));
    }
  }
  const affectsPublic = reverted > 0;

  const summary = `Undid ${BULK_ACTION_TEXT[action].verb}: ${reverted} reverted, ${skipped.length} skipped`;
  await db
    .update(auditLogs)
    .set({ summary, metadata: { operationId, action, reverted, skipped: skipped.slice(0, 200) } })
    .where(and(eq(auditLogs.action, "bulk.undo"), sql`${auditLogs.metadata}->>'operationId' = ${operationId}`));
  return { operationId, action, reverted, skipped, affectsPublic };
}

/** Reverts one entry if the document is still as the operation left it. */
async function revertEntry(tx: Db, entry: UndoEntry, params: Record<string, unknown>): Promise<true | { reason: string }> {
  const [row] = await tx.select().from(documents).where(eq(documents.id, entry.id)).limit(1).for("no key update");
  if (!row) return { reason: "It no longer exists." };
  const changedSince = { reason: "It was changed after the operation, so it was left as it is." };

  switch (entry.kind) {
    case "status": {
      if (row.status !== entry.set) return changedSince;
      if (entry.folded) return { reason: "Its staged edits were merged when it left Published; open it to review before publishing again." };
      const date = (v: string | null) => (v ? new Date(v) : null);
      await tx
        .update(documents)
        .set({
          status: entry.prev.status,
          publishedAt: date(entry.prev.publishedAt),
          modifiedAt: date(entry.prev.modifiedAt),
          trashedAt: date(entry.prev.trashedAt),
          trashedBy: entry.prev.trashedBy,
          updatedAt: new Date(),
          version: sql`${documents.version} + 1`,
        })
        .where(eq(documents.id, row.id));
      return true;
    }
    case "duplicate": {
      const [copy] = await tx.select({ version: documents.version, status: documents.status }).from(documents).where(eq(documents.id, entry.newId)).limit(1);
      if (!copy) return { reason: "The copy no longer exists." };
      if (copy.version !== 1 || copy.status !== "draft") return { reason: "The copy was edited after it was made, so it was kept." };
      await tx.delete(documents).where(and(eq(documents.id, entry.newId), eq(documents.version, 1)));
      return true;
    }
    case "featured":
    case "visibility":
    case "indexing": {
      if (row.status === TRASHED) return changedSince;
      const patch = entry.kind === "featured" ? { featured: entry.prev } : entry.kind === "visibility" ? { visibility: entry.prev } : { robotsIndex: entry.prev };
      if ((entry.kind === "featured" ? row.featured : entry.kind === "visibility" ? row.visibility : row.robotsIndex) === entry.prev) return { reason: "It already has its earlier value." };
      await tx.update(documents).set({ ...patch, updatedAt: new Date(), version: sql`${documents.version} + 1` }).where(eq(documents.id, row.id));
      return true;
    }
    case "topicAdded":
    case "topicRemoved": {
      if (row.status === TRASHED) return changedSince;
      const categoryId = String(params.categoryId);
      if (entry.kind === "topicAdded") {
        const removed = await tx.delete(documentCategories).where(and(eq(documentCategories.documentId, row.id), eq(documentCategories.categoryId, categoryId))).returning();
        if (!removed.length) return changedSince;
        await repairPrimaryTopics(tx, [row.id]);
      } else {
        const [exists] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
        if (!exists) return { reason: "The topic no longer exists." };
        const added = await tx.insert(documentCategories).values({ documentId: row.id, categoryId, isPrimary: false }).onConflictDoNothing().returning();
        if (!added.length) return changedSince;
        if (entry.primary) {
          await tx.update(documentCategories).set({ isPrimary: false }).where(eq(documentCategories.documentId, row.id));
          await tx.update(documentCategories).set({ isPrimary: true }).where(and(eq(documentCategories.documentId, row.id), eq(documentCategories.categoryId, categoryId)));
        }
      }
      await refreshSearchExtra(tx, [row.id]);
      return true;
    }
    case "tagAdded":
    case "tagRemoved": {
      if (row.status === TRASHED) return changedSince;
      const tagId = String(params.tagId);
      if (entry.kind === "tagAdded") {
        const removed = await tx.delete(documentTags).where(and(eq(documentTags.documentId, row.id), eq(documentTags.tagId, tagId))).returning();
        if (!removed.length) return changedSince;
      } else {
        const [exists] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.id, tagId)).limit(1);
        if (!exists) return { reason: "The tag no longer exists." };
        const added = await tx.insert(documentTags).values({ documentId: row.id, tagId }).onConflictDoNothing().returning();
        if (!added.length) return changedSince;
      }
      await refreshSearchExtra(tx, [row.id]);
      return true;
    }
    case "itemAdded":
    case "itemRemoved": {
      const collectionId = String(params.collectionId);
      const [collection] = await tx.select({ id: documents.id, status: documents.status }).from(documents).where(eq(documents.id, collectionId)).limit(1);
      if (!collection || collection.status === TRASHED) return { reason: "The collection is gone or in the Trash." };
      if (entry.kind === "itemAdded") {
        const removed = await tx.delete(collectionItems).where(and(eq(collectionItems.collectionId, collectionId), eq(collectionItems.documentId, row.id))).returning();
        if (!removed.length) return changedSince;
      } else {
        const added = await tx
          .insert(collectionItems)
          .values({ collectionId, documentId: row.id, position: entry.position, groupLabel: entry.groupLabel, note: entry.note })
          .onConflictDoNothing()
          .returning();
        if (!added.length) return changedSince;
      }
      await tx.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, collectionId));
      return true;
    }
  }
}

// ---------------------------------------------------------------------------
// Options for the bulk toolbar (collections to add to)
// ---------------------------------------------------------------------------

export async function collectionOptions(actor: Actor): Promise<Array<{ id: string; title: string; typeName: string }>> {
  assertAdmin(actor);
  const rows = await getDb()
    .select({ id: documents.id, title: documents.title, typeName: contentTypes.name })
    .from(documents)
    .innerJoin(contentTypes, eq(contentTypes.id, documents.typeId))
    .where(and(eq(contentTypes.template, "collection"), ne(documents.status, TRASHED)))
    .orderBy(asc(documents.title))
    .limit(500);
  return rows.map((r) => ({ ...r, title: r.title || "Untitled" }));
}
