import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_ACTOR, type AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { documentRelations, documents, redirects } from "@/server/db/schema";
import { ServiceError } from "@/server/errors";
import {
  createDocument,
  deleteDocument,
  getDocumentForEdit,
  runDocumentAction,
  saveDocument,
  setCollectionItems,
  setDocumentRelations,
  setDocumentTaxonomy,
} from "@/server/services/documents";
import { runBulkChunk } from "@/server/services/content-ops";
import { getDocumentByTypeAndSlug } from "@/server/services/public-content";
import { resolveRedirect } from "@/server/services/redirects";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;
let articleType: string;
let projectType: string;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
  articleType = await typeId(db, "article");
  projectType = await typeId(db, "project");
});
afterAll(() => ctx.close());

async function newArticle(title: string) {
  const { id } = await createDocument(admin, { typeId: articleType, title });
  return id;
}

describe("service-level authorization", () => {
  it("refuses every mutation without an admin actor", async () => {
    const id = await newArticle("Guarded");
    const attempts: Array<() => Promise<unknown>> = [
      () => createDocument(PUBLIC_ACTOR, { typeId: articleType, title: "x" }),
      () => saveDocument(PUBLIC_ACTOR, id, { body: { title: "hacked" } }),
      () => runDocumentAction(PUBLIC_ACTOR, id, { action: "publish" }),
      () => deleteDocument(PUBLIC_ACTOR, id, "guarded"),
      () => getDocumentForEdit(PUBLIC_ACTOR, id),
      () => setDocumentRelations(PUBLIC_ACTOR, id, { relations: [] }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});

describe("create → autosave → publish", () => {
  it("creates with a unique slug and derives search/plain text on save", async () => {
    const a = await newArticle("How I Built It");
    const b = await newArticle("How I Built It");
    const [ra, rb] = await Promise.all([getDocumentForEdit(admin, a), getDocumentForEdit(admin, b)]);
    expect(ra.slug).toBe("how-i-built-it");
    expect(rb.slug).toBe("how-i-built-it-2");

    const result = await saveDocument(admin, a, { expectedVersion: ra.version, body: { content: docOf(paragraph("Index funds and savings rate.")) } });
    expect(result.stagedChanges).toBe(false);
    const [row] = await db.select().from(documents).where(eq(documents.id, a));
    expect(row!.plainText).toBe("Index funds and savings rate.");
    expect(row!.wordCount).toBe(5);
  });

  it("rejects stale autosaves (optimistic concurrency)", async () => {
    const id = await newArticle("Two tabs");
    const doc = await getDocumentForEdit(admin, id);
    await saveDocument(admin, id, { expectedVersion: doc.version, body: { title: "Tab one" } });
    await expect(saveDocument(admin, id, { expectedVersion: doc.version, body: { title: "Tab two" } })).rejects.toMatchObject({ code: "conflict" });
  });

  it("sanitizes hostile editor JSON before storing it", async () => {
    const id = await newArticle("Hostile");
    await saveDocument(admin, id, {
      body: { content: docOf({ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }, { type: "script", content: [] }) },
    });
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(JSON.stringify(row!.content)).not.toMatch(/javascript|script/);
  });

  it("requires a title (and required properties) to publish", async () => {
    const { id } = await createDocument(admin, { typeId: articleType, title: "" });
    await expect(runDocumentAction(admin, id, { action: "publish" })).rejects.toMatchObject({ code: "invalid" });
    const reviewType = await typeId(db, "book-review");
    const { id: reviewId } = await createDocument(admin, { typeId: reviewType, title: "A review" });
    await expect(runDocumentAction(admin, reviewId, { action: "publish" })).rejects.toMatchObject({ details: { bookTitle: expect.any(String) } });
  });

  it("stages edits to a published document until 'publish changes'", async () => {
    const id = await newArticle("Live article");
    await saveDocument(admin, id, { body: { content: docOf(paragraph("Original body.")) } });
    await runDocumentAction(admin, id, { action: "publish" });
    const first = await getDocumentByTypeAndSlug("article", "live-article");
    expect(first?.title).toBe("Live article");

    const save = await saveDocument(admin, id, { body: { title: "Edited title", content: docOf(paragraph("Draft rewrite.")) } });
    expect(save.stagedChanges).toBe(true);
    const stillLive = await getDocumentByTypeAndSlug("article", "live-article");
    expect(stillLive?.title).toBe("Live article");
    expect(JSON.stringify(stillLive?.content)).toContain("Original body.");

    await runDocumentAction(admin, id, { action: "publish" });
    const updated = await getDocumentByTypeAndSlug("article", "live-article");
    expect(updated?.title).toBe("Edited title");
    expect(updated?.modifiedAt).not.toBeNull();
    expect((await getDocumentForEdit(admin, id)).workingCopy).toBeNull();
  });

  it("lifecycle actions return the version the editor's next autosave must send", async () => {
    const id = await newArticle("Keep editing after publish");
    let { version } = await saveDocument(admin, id, { body: { excerpt: "Before publishing." } });
    const actions = [
      { action: "publish" },
      { action: "discardChanges" },
      { action: "changeSlug", slug: "keep-editing-renamed" },
      { action: "setStatus", status: "draft" },
      { action: "setStatus", status: "published" },
    ];
    for (const action of actions) {
      const result = await runDocumentAction(admin, id, action);
      expect(result.version).toBeGreaterThan(version);
      // The pre-action version is stale: the concurrency guard still holds.
      await expect(saveDocument(admin, id, { expectedVersion: version, body: { excerpt: "stale" } })).rejects.toMatchObject({ code: "conflict" });
      ({ version } = await saveDocument(admin, id, { expectedVersion: result.version, body: { excerpt: `After ${action.action}.` } }));
    }
  });

  it("discarding staged changes restores the live version in the editor", async () => {
    const id = await newArticle("Discard me");
    await runDocumentAction(admin, id, { action: "publish" });
    await saveDocument(admin, id, { body: { title: "Temporary" } });
    await runDocumentAction(admin, id, { action: "discardChanges" });
    const doc = await getDocumentForEdit(admin, id);
    expect(doc.workingCopy).toBeNull();
    expect(doc.title).toBe("Discard me");
  });
});

describe("slugs, conversion and redirects", () => {
  it("creates a permanent redirect when a published slug changes", async () => {
    const id = await newArticle("Old name");
    await runDocumentAction(admin, id, { action: "publish" });
    await runDocumentAction(admin, id, { action: "changeSlug", slug: "new-name" });
    expect(await resolveRedirect("/article/old-name")).toEqual({ location: "/article/new-name", permanent: true });
    // Renaming again flattens the chain instead of hopping twice.
    await runDocumentAction(admin, id, { action: "changeSlug", slug: "newest-name" });
    expect(await resolveRedirect("/article/old-name")).toEqual({ location: "/article/newest-name", permanent: true });
    expect(await resolveRedirect("/article/new-name")).toEqual({ location: "/article/newest-name", permanent: true });
  });

  it("does not create redirects for never-published drafts", async () => {
    const id = await newArticle("Draft rename");
    await runDocumentAction(admin, id, { action: "changeSlug", slug: "draft-renamed" });
    expect(await resolveRedirect("/article/draft-rename")).toBeNull();
  });

  it("replaces a placeholder slug with one from the title on first publish only", async () => {
    // Created untitled (the usual "New" flow), titled later, then published.
    const id = await newArticle("");
    const created = await getDocumentForEdit(admin, id);
    expect(created.slug).toMatch(/^untitled-[a-z0-9]+$/);
    await saveDocument(admin, id, { body: { title: "My Graduation" } });
    // The editor updates its links from this response, before any refresh.
    expect(await runDocumentAction(admin, id, { action: "publish" })).toMatchObject({ slug: "my-graduation", path: "/article/my-graduation" });
    const published = await getDocumentForEdit(admin, id);
    expect(published.slug).toBe("my-graduation");
    expect(await getDocumentByTypeAndSlug("article", "my-graduation")).not.toBeNull();
    // The placeholder URL was never public, so nothing redirects from it.
    expect(await resolveRedirect(`/article/${created.slug}`)).toBeNull();

    // Once public, the URL is stable: retitling and republishing keep it.
    await saveDocument(admin, id, { body: { title: "Graduation day" } });
    await runDocumentAction(admin, id, { action: "publish" });
    expect((await getDocumentForEdit(admin, id)).slug).toBe("my-graduation");
  });

  it("keeps slugs the owner chose, and placeholders when the title has no Latin letters", async () => {
    const chosen = await newArticle("");
    await runDocumentAction(admin, chosen, { action: "changeSlug", slug: "hand-picked" });
    await saveDocument(admin, chosen, { body: { title: "Something else entirely" } });
    await runDocumentAction(admin, chosen, { action: "publish" });
    expect((await getDocumentForEdit(admin, chosen)).slug).toBe("hand-picked");

    const tamil = await newArticle("");
    const before = (await getDocumentForEdit(admin, tamil)).slug;
    await saveDocument(admin, tamil, { body: { title: "தமிழ் கட்டுரை" } });
    await runDocumentAction(admin, tamil, { action: "publish" });
    expect((await getDocumentForEdit(admin, tamil)).slug).toBe(before);
  });

  it("rejects malicious and duplicate slugs", async () => {
    const id = await newArticle("Slug target");
    for (const slug of ["../../admin", "a/b", "UPPER", "", "x".repeat(97)]) {
      await expect(runDocumentAction(admin, id, { action: "changeSlug", slug })).rejects.toBeInstanceOf(ServiceError);
    }
    await newArticle("Taken slug");
    await expect(runDocumentAction(admin, id, { action: "changeSlug", slug: "taken-slug" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("converts an idea into another type without duplicating it, redirecting public URLs", async () => {
    const { id } = await createDocument(admin, { typeId: articleType, title: "Budget tracker", status: "idea", thought: "Build a tiny tracker." });
    await runDocumentAction(admin, id, { action: "convert", typeId: projectType });
    const doc = await getDocumentForEdit(admin, id);
    expect(doc.type.slug).toBe("project");
    expect(doc.status).toBe("draft");
    expect(JSON.stringify(doc.content)).toContain("Build a tiny tracker.");
    const count = await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, "budget-tracker"));
    expect(count).toHaveLength(1);
  });

  it("derives a new document linked back to its source", async () => {
    const source = await newArticle("Talk-worthy essay");
    const talkType = await typeId(db, "talk");
    const { id: derived } = await runDocumentAction(admin, source, { action: "derive", typeId: talkType });
    const rel = await db.select().from(documentRelations).where(eq(documentRelations.sourceId, derived));
    expect(rel).toMatchObject([{ targetId: source, kind: "derived_from" }]);
  });
});

describe("relationships, taxonomy and collections", () => {
  it("rejects forged, self-referencing and unknown-kind relationships", async () => {
    const a = await newArticle("Relation source");
    const b = await newArticle("Relation target");
    await expect(setDocumentRelations(admin, a, { relations: [{ targetId: "99999999-9999-4999-8999-999999999999", kind: "related" }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(setDocumentRelations(admin, a, { relations: [{ targetId: a, kind: "related" }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(setDocumentRelations(admin, a, { relations: [{ targetId: b, kind: "owns" }] })).rejects.toMatchObject({ code: "invalid" });
    await setDocumentRelations(admin, a, { relations: [{ targetId: b, kind: "expands_on", note: "context" }] });
    const edit = await getDocumentForEdit(admin, b);
    expect(edit.backlinks).toMatchObject([{ sourceId: a, kind: "expands_on" }]);
  });

  it("builds automatic backlinks from mentions and internal links in the live body", async () => {
    const target = await newArticle("Mentioned piece");
    const linker = await newArticle("Linking piece");
    await saveDocument(admin, linker, {
      body: {
        content: docOf({
          type: "paragraph",
          content: [
            { type: "docRef", attrs: { documentId: target, label: "Mentioned piece" } },
            { type: "text", text: " and ", marks: [] },
            { type: "text", text: "a link", marks: [{ type: "link", attrs: { href: "/article/mentioned-piece" } }] },
          ],
        }),
      },
    });
    const rows = await db.select().from(documentRelations).where(eq(documentRelations.sourceId, linker));
    expect(rows).toMatchObject([{ targetId: target, kind: "references", origin: "content" }]);
  });

  it("rejects forged category and tag ids but creates tags by name", async () => {
    const id = await newArticle("Tagged");
    await expect(setDocumentTaxonomy(admin, id, { categoryIds: ["99999999-9999-4999-8999-999999999999"] })).rejects.toMatchObject({ code: "invalid" });
    await setDocumentTaxonomy(admin, id, { tagNames: ["FIRE", "Index Funds", "FIRE"] });
    const doc = await getDocumentForEdit(admin, id);
    expect(doc.tags.map((t) => t.slug).sort()).toEqual(["fire", "index-funds"]);
  });

  it("only collection-template documents hold items, and items must exist", async () => {
    const collectionType = await typeId(db, "collection");
    const { id: collection } = await createDocument(admin, { typeId: collectionType, title: "Reading list" });
    const item = await newArticle("Item one");
    await setCollectionItems(admin, collection, { items: [{ documentId: item, groupLabel: "Start", note: "Read first" }] });
    expect((await getDocumentForEdit(admin, collection)).collectionItems).toMatchObject([{ documentId: item, groupLabel: "Start" }]);
    await expect(setCollectionItems(admin, item, { items: [] })).rejects.toMatchObject({ code: "invalid" });
    await expect(setCollectionItems(admin, collection, { items: [{ documentId: "99999999-9999-4999-8999-999999999999" }] })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("deletion", () => {
  it("requires the Trash first, then typing the slug to delete permanently", async () => {
    const id = await newArticle("Delete me");
    await expect(deleteDocument(admin, id, "delete-me")).rejects.toMatchObject({ code: "conflict" });
    await runBulkChunk(admin, { operationId: "33333333-3333-4333-8333-333333333333", ids: [id], action: { action: "trash" } });
    await expect(deleteDocument(admin, id, "DELETE")).rejects.toMatchObject({ code: "invalid" });
    await deleteDocument(admin, id, "delete-me");
    await expect(getDocumentForEdit(admin, id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("unknown ids are 'not found', never a crash", async () => {
    await expect(getDocumentForEdit(admin, "not-a-uuid")).rejects.toMatchObject({ code: "not_found" });
    await expect(getDocumentForEdit(admin, "99999999-9999-4999-8999-999999999999")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("redirect table invariants", () => {
  it("keeps no self-redirects", async () => {
    const rows = await db.select().from(redirects);
    for (const r of rows) expect(r.fromPath).not.toBe(r.toPath);
  });
});
