import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PERMANENT_DELETE_TOKEN } from "@/lib/content/bulk-actions";
import { PUBLIC_ACTOR, type AdminActor } from "@/server/auth/actor";
import { setDbForTesting, type Db } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { auditLogs, categories, collectionItems, documentCategories, documentRelations, documents, documentTags, navigationItems, redirects, tags } from "@/server/db/schema";
import { listActivity } from "@/server/services/audit";
import { resolveSelection, runBulkChunk, undoBulkOperation, type BulkRunResult } from "@/server/services/content-ops";
import {
  createDocument,
  deleteDocument,
  getDocumentForEdit,
  listDocuments,
  lookupDocuments,
  runDocumentAction,
  saveDocument,
  setDocumentTaxonomy,
} from "@/server/services/documents";
import { exportManifest } from "@/server/services/portable-export";
import { getDocumentByTypeAndSlug } from "@/server/services/public-content";
import { searchAdmin, searchPublic } from "@/server/services/search";
import { createTag, mergeCategories } from "@/server/services/taxonomy";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;
let other: AdminActor;
let articleType: string;
let collectionType: string;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
  other = await createAdmin(db, { githubId: 515151, githubLogin: "second-owner" });
  articleType = await typeId(db, "article");
  collectionType = await typeId(db, "collection");
});
afterAll(() => ctx.close());

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

async function draft(title: string, text = "A short but real body for testing bulk operations.") {
  const { id } = await createDocument(admin, { typeId: articleType, title });
  const doc = await getDocumentForEdit(admin, id);
  await saveDocument(admin, id, { expectedVersion: doc.version, body: { content: docOf(paragraph(text)), excerpt: `${title} excerpt` } });
  return id;
}

async function published(title: string, text?: string) {
  const id = await draft(title, text);
  await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

async function run(action: Record<string, unknown>, ids: string[], operationId = randomUUID(), as: AdminActor = admin): Promise<BulkRunResult> {
  return runBulkChunk(as, { operationId, ids, action });
}

async function row(id: string) {
  const [r] = await db.select().from(documents).where(eq(documents.id, id));
  return r;
}

describe("authorization and input validation", () => {
  it("refuses every bulk entry point without an admin actor", async () => {
    const id = await draft("Guarded bulk");
    await expect(run({ action: "trash" }, [id], randomUUID(), PUBLIC_ACTOR as unknown as AdminActor)).rejects.toMatchObject({ code: "forbidden" });
    await expect(resolveSelection(PUBLIC_ACTOR, { selection: { kind: "ids", ids: [id] } })).rejects.toMatchObject({ code: "forbidden" });
    await expect(undoBulkOperation(PUBLIC_ACTOR, { operationId: randomUUID() })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("accepts only allowlisted actions and never a client-supplied status or actor (no mass assignment)", async () => {
    const id = await draft("Mass assignment");
    await expect(run({ action: "draft", status: "published" }, [id])).rejects.toMatchObject({ code: "invalid" });
    await expect(run({ action: "setStatus", status: "published" }, [id])).rejects.toMatchObject({ code: "invalid" });
    await expect(runBulkChunk(admin, { operationId: randomUUID(), ids: [id], action: { action: "trash" }, actorId: other.userId })).rejects.toMatchObject({ code: "invalid" });
    expect((await row(id))!.status).toBe("draft");
  });

  it("bounds a request: ids must be uuids, at most 100, and permanent deletion needs its token", async () => {
    await expect(run({ action: "trash" }, ["not-a-uuid"])).rejects.toMatchObject({ code: "invalid" });
    await expect(run({ action: "trash" }, Array.from({ length: 101 }, () => randomUUID()))).rejects.toMatchObject({ code: "invalid" });
    await expect(run({ action: "trash" }, [])).rejects.toMatchObject({ code: "invalid" });
    await expect(run({ action: "delete" }, [randomUUID()])).rejects.toMatchObject({ code: "invalid" });
    await expect(run({ action: "delete", confirm: "yes" }, [randomUUID()])).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("bulk state changes", () => {
  it("moves a mixed selection to Draft, reporting unchanged and missing items", async () => {
    const live = await published("Bulk live one");
    const already = await draft("Bulk already draft");
    const missing = randomUUID();
    const result = await run({ action: "draft" }, [live, already, missing]);
    expect(result).toMatchObject({ requested: 3, updated: 1, unchanged: 1, failed: 1, undoable: true, affectsPublic: true });
    expect(result.items.find((i) => i.id === missing)).toMatchObject({ outcome: "failed", message: expect.stringMatching(/not found/i) });
    expect((await row(live))!.status).toBe("draft");
    // Idempotent: running it again changes nothing.
    expect(await run({ action: "draft" }, [live, already])).toMatchObject({ updated: 0, unchanged: 2, failed: 0, undoable: false });
  });

  it("publishes what is ready and reports why the rest isn't (partial failure)", async () => {
    const ready = await draft("Ready to go");
    const todo = await draft("Has placeholder", "[TODO] write this section");
    const untitled = (await createDocument(admin, { typeId: articleType, title: "" })).id;
    const result = await run({ action: "publish" }, [ready, todo, untitled]);
    expect(result).toMatchObject({ updated: 1, failed: 2 });
    expect(result.items.find((i) => i.id === todo)!.message).toMatch(/TODO/);
    expect(result.items.find((i) => i.id === untitled)!.message).toMatch(/title/i);
    expect((await row(ready))!.status).toBe("published");
    expect((await row(todo))!.status).toBe("draft");
  });

  it("never applies staged edits of an already-published document", async () => {
    const id = await published("Staged and live");
    const doc = await getDocumentForEdit(admin, id);
    await saveDocument(admin, id, { expectedVersion: doc.version, body: { title: "Staged title" } });
    const result = await run({ action: "publish" }, [id]);
    expect(result.items[0]).toMatchObject({ outcome: "unchanged", message: expect.stringMatching(/staged edits were left/) });
    expect((await row(id))!.title).toBe("Staged and live");
  });

  it("archives and restores (archive → draft)", async () => {
    const id = await published("Archive me");
    expect(await run({ action: "archive" }, [id])).toMatchObject({ updated: 1 });
    expect((await row(id))!.status).toBe("archived");
    expect(await run({ action: "draft" }, [id])).toMatchObject({ updated: 1 });
    expect((await row(id))!.status).toBe("draft");
  });

  it("changes featured and visibility set-based, and reports already-set items as unchanged", async () => {
    const a = await published("Feature A");
    const b = await published("Feature B");
    expect(await run({ action: "featured", value: true }, [a, b])).toMatchObject({ updated: 2 });
    expect(await run({ action: "featured", value: true }, [a, b])).toMatchObject({ updated: 0, unchanged: 2 });
    expect(await run({ action: "visibility", value: "private" }, [a])).toMatchObject({ updated: 1, affectsPublic: true });
    expect((await row(a))!.visibility).toBe("private");
    expect(await getDocumentByTypeAndSlug("article", (await row(a))!.slug)).toBeNull();
  });
});

describe("trash lifecycle", () => {
  it("trash hides a document everywhere public, freezes it, and restore brings it back as a draft", async () => {
    const id = await published("Trash candidate unique words zebrafish");
    const slug = (await row(id))!.slug;
    expect(await getDocumentByTypeAndSlug("article", slug)).not.toBeNull();

    const trashed = await run({ action: "trash" }, [id]);
    expect(trashed).toMatchObject({ updated: 1, affectsPublic: true });
    const r = (await row(id))!;
    expect(r).toMatchObject({ status: "trashed", trashedBy: admin.userId });
    expect(r.trashedAt).toBeInstanceOf(Date);

    // Public reads, public search, admin search, pickers and the default list all skip it.
    expect(await getDocumentByTypeAndSlug("article", slug)).toBeNull();
    expect((await searchPublic("zebrafish")).map((s) => s.id)).not.toContain(id);
    expect((await searchAdmin(admin, "zebrafish")).map((s) => s.id)).not.toContain(id);
    expect((await lookupDocuments(admin, "zebrafish")).map((s) => s.id)).not.toContain(id);
    expect((await listDocuments(admin, { q: "zebrafish" })).total).toBe(0);
    expect((await listDocuments(admin, { q: "zebrafish", status: "trashed" })).items[0]).toMatchObject({ id, trashedBy: "karthikeyan-test" });

    // Frozen: no edits, publishing or taxonomy changes until restored.
    await expect(saveDocument(admin, id, { body: { title: "edit" } })).rejects.toMatchObject({ code: "conflict" });
    await expect(runDocumentAction(admin, id, { action: "publish" })).rejects.toMatchObject({ code: "conflict" });
    await expect(setDocumentTaxonomy(admin, id, { tagNames: ["x"] })).rejects.toMatchObject({ code: "conflict" });
    expect(await run({ action: "addTag", tagId: (await createTag(admin, { name: "Frozen tag" })).id }, [id])).toMatchObject({ failed: 1 });
    expect(await run({ action: "trash" }, [id])).toMatchObject({ unchanged: 1 });

    const restored = await run({ action: "restore" }, [id]);
    expect(restored).toMatchObject({ updated: 1 });
    expect(await row(id)).toMatchObject({ status: "draft", trashedAt: null, trashedBy: null, slug });
  });

  it("keeps relations, topics and collection places while in the Trash", async () => {
    const target = await published("Linked target");
    const source = await draft("Linking source");
    await db.insert(documentRelations).values({ sourceId: source, targetId: target, kind: "related", origin: "manual" });
    const [topic] = await db.select().from(categories).limit(1);
    await db.insert(documentCategories).values({ documentId: target, categoryId: topic!.id, isPrimary: true });
    await run({ action: "trash" }, [target]);
    await run({ action: "restore" }, [target]);
    expect(await db.select().from(documentRelations).where(eq(documentRelations.targetId, target))).toHaveLength(1);
    expect(await db.select().from(documentCategories).where(eq(documentCategories.documentId, target))).toHaveLength(1);
  });

  it("permanently deletes only from the Trash, cascades dependants, and is deterministic on retry", async () => {
    const active = await draft("Still active");
    const doomed = await published("Doomed");
    const collection = (await createDocument(admin, { typeId: collectionType, title: "Holds doomed" })).id;
    await db.insert(collectionItems).values({ collectionId: collection, documentId: doomed, position: 0 });
    await db.insert(documentRelations).values({ sourceId: active, targetId: doomed, kind: "related", origin: "manual" });
    await run({ action: "trash" }, [doomed]);

    const confirm = { action: "delete", confirm: PERMANENT_DELETE_TOKEN };
    const result = await run(confirm, [active, doomed]);
    expect(result).toMatchObject({ updated: 1, failed: 1, undoable: false });
    expect(result.items.find((i) => i.id === active)!.message).toMatch(/Move it to the Trash/);
    expect(await row(doomed)).toBeUndefined();
    expect(await row(active)).toBeDefined();
    expect(await db.select().from(collectionItems).where(eq(collectionItems.documentId, doomed))).toHaveLength(0);
    expect(await db.select().from(documentRelations).where(eq(documentRelations.targetId, doomed))).toHaveLength(0);

    expect(await run(confirm, [doomed])).toMatchObject({ unchanged: 1, failed: 0 });
  });

  it("single-document permanent delete also requires the Trash", async () => {
    const id = await draft("Single delete");
    await expect(deleteDocument(admin, id, "single-delete")).rejects.toMatchObject({ code: "conflict" });
    await run({ action: "trash" }, [id]);
    await expect(deleteDocument(admin, id, "wrong")).rejects.toMatchObject({ code: "invalid" });
    await deleteDocument(admin, id, "single-delete");
    expect(await row(id)).toBeUndefined();
  });

  it("is excluded from exports", async () => {
    const id = await draft("Never exported");
    await run({ action: "trash" }, [id]);
    await expect(exportManifest(admin, { scope: { kind: "documents", ids: [id] }, format: "manifest" })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("taxonomy and collections in bulk", () => {
  it("adds and removes a topic, keeping exactly one primary topic per document", async () => {
    const [first, second] = await db.select().from(categories).limit(2);
    const a = await draft("Topic A");
    const b = await draft("Topic B");
    await db.insert(documentCategories).values({ documentId: b, categoryId: first!.id, isPrimary: true });

    expect(await run({ action: "addTopic", categoryId: second!.id }, [a, b])).toMatchObject({ updated: 2 });
    const links = await db.select().from(documentCategories).where(inArray(documentCategories.documentId, [a, b]));
    expect(links.find((l) => l.documentId === a)).toMatchObject({ categoryId: second!.id, isPrimary: true });
    expect(links.find((l) => l.documentId === b && l.categoryId === second!.id)!.isPrimary).toBe(false);

    expect(await run({ action: "removeTopic", categoryId: first!.id }, [a, b])).toMatchObject({ updated: 1, unchanged: 1 });
    const left = await db.select().from(documentCategories).where(eq(documentCategories.documentId, b));
    expect(left).toEqual([expect.objectContaining({ categoryId: second!.id, isPrimary: true })]);
    // Search text follows the taxonomy.
    expect((await row(b))!.searchExtra).toContain(second!.name);
  });

  it("refuses an unknown topic, tag or collection for the whole request", async () => {
    const a = await draft("Unknown refs");
    await expect(run({ action: "addTopic", categoryId: randomUUID() }, [a])).rejects.toMatchObject({ code: "not_found" });
    await expect(run({ action: "addTag", tagId: randomUUID() }, [a])).rejects.toMatchObject({ code: "not_found" });
    await expect(run({ action: "addToCollection", collectionId: a }, [a])).rejects.toMatchObject({ code: "invalid" });
  });

  it("adds and removes tags", async () => {
    const tag = await createTag(admin, { name: "Bulk tag" });
    const a = await draft("Tag A");
    expect(await run({ action: "addTag", tagId: tag.id }, [a])).toMatchObject({ updated: 1 });
    expect(await run({ action: "addTag", tagId: tag.id }, [a])).toMatchObject({ unchanged: 1 });
    expect(await run({ action: "removeTag", tagId: tag.id }, [a])).toMatchObject({ updated: 1 });
    expect(await db.select().from(documentTags).where(eq(documentTags.documentId, a))).toHaveLength(0);
  });

  it("appends to a collection after existing items and never adds a collection to itself", async () => {
    const collection = (await createDocument(admin, { typeId: collectionType, title: "Bulk course" })).id;
    const a = await draft("Lesson A");
    const b = await draft("Lesson B");
    await db.insert(collectionItems).values({ collectionId: collection, documentId: a, position: 4 });
    const result = await run({ action: "addToCollection", collectionId: collection }, [a, b, collection]);
    expect(result).toMatchObject({ updated: 1, unchanged: 1, failed: 1 });
    const items = await db.select().from(collectionItems).where(eq(collectionItems.collectionId, collection));
    expect(items.find((i) => i.documentId === b)!.position).toBe(5);
    expect(await run({ action: "removeFromCollection", collectionId: collection }, [a, b])).toMatchObject({ updated: 2 });
  });
});

describe("duplicate", () => {
  it("creates drafts without the source's SEO identity, and a replayed chunk doesn't copy twice", async () => {
    const id = await published("Original piece");
    await db.update(documents).set({ canonicalUrl: "https://elsewhere.example/original", seoTitle: "SEO", seoDescription: "Desc", featured: true }).where(eq(documents.id, id));
    const operationId = randomUUID();
    const first = await run({ action: "duplicate" }, [id], operationId);
    expect(first).toMatchObject({ updated: 1 });
    const copies = await db.select().from(documents).where(like(documents.title, "Original piece (copy)%"));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ status: "draft", canonicalUrl: null, seoTitle: null, seoDescription: null, featured: false, publishedAt: null });
    expect(copies[0]!.slug).not.toBe((await row(id))!.slug);

    expect(await run({ action: "duplicate" }, [id], operationId)).toMatchObject({ updated: 0, unchanged: 1 });
    expect(await db.select().from(documents).where(like(documents.title, "Original piece (copy)%"))).toHaveLength(1);
  });
});

describe("undo", () => {
  it("reverts a Move to Draft exactly, including publication dates", async () => {
    const id = await published("Undo draft");
    const before = (await row(id))!;
    const { operationId } = await run({ action: "draft" }, [id]);
    const undone = await undoBulkOperation(admin, { operationId });
    expect(undone).toMatchObject({ reverted: 1, skipped: [] });
    const after = (await row(id))!;
    expect(after.status).toBe("published");
    expect(after.publishedAt?.toISOString()).toBe(before.publishedAt?.toISOString());
  });

  it("reverts a publish of a never-published draft back to an unpublished draft", async () => {
    const id = await draft("Undo publish");
    const { operationId } = await run({ action: "publish" }, [id]);
    await undoBulkOperation(admin, { operationId });
    expect(await row(id)).toMatchObject({ status: "draft", publishedAt: null });
  });

  it("restores trashed documents to their exact previous state", async () => {
    const id = await published("Undo trash");
    const { operationId } = await run({ action: "trash" }, [id]);
    await undoBulkOperation(admin, { operationId });
    expect(await row(id)).toMatchObject({ status: "published", trashedAt: null, trashedBy: null });
  });

  it("skips documents changed after the operation instead of overwriting them", async () => {
    const a = await published("Undo concurrent A");
    const b = await published("Undo concurrent B");
    const { operationId } = await run({ action: "draft" }, [a, b]);
    await runDocumentAction(admin, b, { action: "setStatus", status: "archived" });
    const undone = await undoBulkOperation(admin, { operationId });
    expect(undone.reverted).toBe(1);
    expect(undone.skipped).toEqual([expect.objectContaining({ id: b, reason: expect.stringMatching(/changed after/) })]);
    expect((await row(b))!.status).toBe("archived");
  });

  it("does not undo a published document whose staged edits were merged when it left Published", async () => {
    const id = await published("Folded");
    const doc = await getDocumentForEdit(admin, id);
    await saveDocument(admin, id, { expectedVersion: doc.version, body: { title: "Folded, edited" } });
    const result = await run({ action: "draft" }, [id]);
    expect(result.items[0]!.message).toMatch(/staged edits were merged/);
    const undone = await undoBulkOperation(admin, { operationId: result.operationId });
    expect(undone).toMatchObject({ reverted: 0 });
    expect(undone.skipped[0]!.reason).toMatch(/staged edits were merged/);
    expect((await row(id))!.status).toBe("draft");
  });

  it("reverts taxonomy, collection, featured and duplicate operations", async () => {
    const [topic] = await db.select().from(categories).limit(1);
    const tag = await createTag(admin, { name: "Undo tag" });
    const collection = (await createDocument(admin, { typeId: collectionType, title: "Undo collection" })).id;
    const a = await draft("Undo many");

    for (const action of [
      { action: "addTopic", categoryId: topic!.id },
      { action: "addTag", tagId: tag.id },
      { action: "addToCollection", collectionId: collection },
      { action: "featured", value: true },
    ]) {
      const { operationId } = await run(action, [a]);
      expect((await undoBulkOperation(admin, { operationId })).reverted).toBe(1);
    }
    expect(await db.select().from(documentCategories).where(eq(documentCategories.documentId, a))).toHaveLength(0);
    expect(await db.select().from(documentTags).where(eq(documentTags.documentId, a))).toHaveLength(0);
    expect(await db.select().from(collectionItems).where(eq(collectionItems.documentId, a))).toHaveLength(0);
    expect((await row(a))!.featured).toBe(false);

    const dup = await run({ action: "duplicate" }, [a]);
    expect((await undoBulkOperation(admin, { operationId: dup.operationId })).reverted).toBe(1);
    expect(await db.select().from(documents).where(like(documents.title, "Undo many (copy)%"))).toHaveLength(0);
  });

  it("re-adds removed topics with their primary flag", async () => {
    const [topic, otherTopic] = await db.select().from(categories).limit(2);
    const a = await draft("Undo remove topic");
    await db.insert(documentCategories).values([
      { documentId: a, categoryId: topic!.id, isPrimary: true },
      { documentId: a, categoryId: otherTopic!.id, isPrimary: false },
    ]);
    const { operationId } = await run({ action: "removeTopic", categoryId: topic!.id }, [a]);
    expect((await db.select().from(documentCategories).where(eq(documentCategories.documentId, a))).find((l) => l.categoryId === otherTopic!.id)!.isPrimary).toBe(true);
    await undoBulkOperation(admin, { operationId });
    const links = await db.select().from(documentCategories).where(eq(documentCategories.documentId, a));
    expect(links.filter((l) => l.isPrimary).map((l) => l.categoryId)).toEqual([topic!.id]);
  });

  it("refuses a second undo, someone else's operation, an expired one, and permanent deletion", async () => {
    const id = await published("Undo rules");
    const { operationId } = await run({ action: "draft" }, [id]);
    await expect(undoBulkOperation(other, { operationId })).rejects.toMatchObject({ code: "forbidden" });
    await undoBulkOperation(admin, { operationId });
    await expect(undoBulkOperation(admin, { operationId })).rejects.toMatchObject({ code: "conflict" });

    const late = await run({ action: "draft" }, [id]);
    await db.update(auditLogs).set({ createdAt: new Date(Date.now() - 31 * 60_000) }).where(sql`${auditLogs.metadata}->>'operationId' = ${late.operationId}`);
    await expect(undoBulkOperation(admin, { operationId: late.operationId })).rejects.toMatchObject({ code: "conflict" });

    const gone = await draft("Undo delete");
    await run({ action: "trash" }, [gone]);
    const del = await run({ action: "delete", confirm: PERMANENT_DELETE_TOKEN }, [gone]);
    await expect(undoBulkOperation(admin, { operationId: del.operationId })).rejects.toMatchObject({ code: "invalid" });
    await expect(undoBulkOperation(admin, { operationId: randomUUID() })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("selection", () => {
  it("resolves 'all matching' from the list filter across pages, minus exclusions", async () => {
    const marker = `sel${Date.now()}`;
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await draft(`${marker} item ${i}`));
    // Page 1 of 3 at 3 per page shows only three of them.
    expect((await listDocuments(admin, { q: marker, limit: 3 })).items).toHaveLength(3);
    const all = await resolveSelection(admin, { selection: { kind: "filter", filter: { q: marker }, exclude: [ids[0]] } });
    expect(all).toMatchObject({ matched: 6, truncated: false });
    expect(new Set(all.ids)).toEqual(new Set(ids.slice(1)));
    expect(all.byStatus).toEqual({ draft: 6 });
  });

  it("validates the filter exactly as the list does (garbage is ignored, never injected)", async () => {
    const result = await resolveSelection(admin, { selection: { kind: "filter", filter: { status: "published'; drop table studio.documents; --", type: "x", stale: "-1", health: "nope" } } });
    expect(result.matched).toBe((await listDocuments(admin, {})).total);
    await expect(resolveSelection(admin, { selection: { kind: "filter", filter: { status: "draft", extra: "x" } } })).rejects.toMatchObject({ code: "invalid" });
  });

  it("previews what an operation will affect: live pages and inbound links", async () => {
    const target = await published("Preview target");
    const linker = await published("Preview linker");
    await db.insert(documentRelations).values({ sourceId: linker, targetId: target, kind: "references", origin: "content" });
    const preview = await resolveSelection(admin, { selection: { kind: "ids", ids: [target, randomUUID()] } });
    expect(preview).toMatchObject({ ids: [target], live: 1, linkedFrom: 1, byStatus: { published: 1 } });
  });

  it("selects the Trash only when asked", async () => {
    const id = await draft(`trashsel${Date.now()}`);
    await run({ action: "trash" }, [id]);
    const q = (await row(id))!.title;
    expect((await resolveSelection(admin, { selection: { kind: "filter", filter: { q } } })).ids).toEqual([]);
    expect((await resolveSelection(admin, { selection: { kind: "filter", filter: { q, status: "trashed" } } })).ids).toEqual([id]);
  });
});

describe("audit trail", () => {
  it("records actor, counts, failures and the operation id for every chunk", async () => {
    const ok = await draft("Audited");
    const missing = randomUUID();
    const { operationId } = await run({ action: "trash" }, [ok, missing]);
    const [entry] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "bulk.trash"), sql`${auditLogs.metadata}->>'operationId' = ${operationId}`));
    expect(entry).toMatchObject({ actorId: admin.userId, entityType: "document" });
    expect(entry!.metadata).toMatchObject({ operationId, action: "trash", requested: 2, updated: 1, failed: 1, failures: [expect.objectContaining({ id: missing })] });
    // Undo data is ids and scalar state, never document bodies.
    expect(JSON.stringify(entry!.metadata)).not.toContain("A short but real body");

    const activity = await listActivity(admin, { scope: "bulk", limit: 5 });
    expect(activity.entries[0]).toMatchObject({ action: "bulk.trash", actor: "karthikeyan-test" });
  });
});

describe("performance", () => {
  it("set-based actions issue the same number of statements for 5 or 50 documents (no N+1)", async () => {
    const tag = await createTag(admin, { name: "Statement count" });
    const make = async (n: number) => Promise.all(Array.from({ length: n }, (_, i) => createDocument(admin, { typeId: articleType, title: `count ${n} ${i}` }).then((r) => r.id)));
    const small = await make(5);
    const large = await make(50);
    let statements = 0;
    const counting = drizzle(ctx.client, { schema, logger: { logQuery: () => void statements++ } }) as unknown as Db;
    const measure = async (ids: string[], action: Record<string, unknown>) => {
      statements = 0;
      setDbForTesting(counting);
      try {
        await run(action, ids);
      } finally {
        setDbForTesting(db);
      }
      return statements;
    };
    for (const action of [{ action: "featured", value: true }, { action: "visibility", value: "unlisted" }, { action: "removeTag", tagId: tag.id }]) {
      expect(await measure(large, action)).toBe(await measure(small, action));
    }
  });
});

describe("merge topics", () => {
  it("moves documents (keeping primaries), sub-topics and menu links, redirects the old URL, and removes the source", async () => {
    const [a] = await db.insert(categories).values({ name: "Merge source", slug: "merge-source" }).returning();
    const [b] = await db.insert(categories).values({ name: "Merge target", slug: "merge-target" }).returning();
    const [child] = await db.insert(categories).values({ name: "Merge child", slug: "merge-child", parentId: a!.id }).returning();
    const d1 = await draft("Merged doc one");
    const d2 = await draft("Merged doc two");
    await db.insert(documentCategories).values([
      { documentId: d1, categoryId: a!.id, isPrimary: true },
      { documentId: d2, categoryId: a!.id, isPrimary: true },
      { documentId: d2, categoryId: b!.id, isPrimary: false },
    ]);
    await db.insert(navigationItems).values({ location: "primary", label: "Source", linkType: "category", refId: a!.id });

    expect(await mergeCategories(admin, a!.id, b!.id)).toEqual({ documents: 2, subtopics: 1 });
    const links = await db.select().from(documentCategories).where(inArray(documentCategories.documentId, [d1, d2]));
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.categoryId === b!.id && l.isPrimary)).toBe(true);
    expect((await db.select().from(categories).where(eq(categories.id, child!.id)))[0]!.parentId).toBe(b!.id);
    expect(await db.select().from(categories).where(eq(categories.id, a!.id))).toHaveLength(0);
    expect((await db.select().from(navigationItems).where(eq(navigationItems.label, "Source")))[0]!.refId).toBe(b!.id);
    expect(await db.select().from(redirects).where(eq(redirects.fromPath, "/merge-source"))).toEqual([expect.objectContaining({ toPath: "/merge-target", matchType: "prefix" })]);
  });

  it("refuses merging a topic into its own sub-topic", async () => {
    const [p] = await db.insert(categories).values({ name: "Parent X", slug: "parent-x" }).returning();
    const [c] = await db.insert(categories).values({ name: "Child X", slug: "child-x", parentId: p!.id }).returning();
    await expect(mergeCategories(admin, p!.id, c!.id)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("tags are preserved", () => {
  it("bulk tag changes leave other tags alone", async () => {
    const keep = await createTag(admin, { name: "Keep me" });
    const drop = await createTag(admin, { name: "Drop me" });
    const id = await draft("Two tags");
    await db.insert(documentTags).values([{ documentId: id, tagId: keep.id }, { documentId: id, tagId: drop.id }]);
    await run({ action: "removeTag", tagId: drop.id }, [id]);
    expect((await db.select().from(documentTags).where(eq(documentTags.documentId, id))).map((t) => t.tagId)).toEqual([keep.id]);
    expect(await db.select().from(tags).where(eq(tags.id, drop.id))).toHaveLength(1);
  });
});

void words;
