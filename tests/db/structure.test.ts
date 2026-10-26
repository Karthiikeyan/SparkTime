import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { documents, redirects } from "@/server/db/schema";
import { createContentType, deleteContentType, updateContentType, loadContentTypes } from "@/server/services/content-types";
import { createDocument, runDocumentAction, saveDocument, setDocumentTaxonomy } from "@/server/services/documents";
import { getDocumentByTypeAndSlug, getCategoryPageData } from "@/server/services/public-content";
import { recommendFor } from "@/server/services/recommendations";
import { createRedirect, resolveRedirect, upsertRedirect } from "@/server/services/redirects";
import { searchAdmin, searchPublic, HIGHLIGHT_START } from "@/server/services/search";
import { createCategory, createTag, getCategoryBySlug, listCategories, mergeTags, updateCategory } from "@/server/services/taxonomy";
import { setDocumentRelations } from "@/server/services/documents";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
});
afterAll(() => ctx.close());

async function publish(typeSlug: string, title: string, body = "", extra: { tags?: string[]; categoryIds?: string[] } = {}) {
  const { id } = await createDocument(admin, { typeId: await typeId(db, typeSlug), title });
  if (body) await saveDocument(admin, id, { body: { content: docOf(paragraph(body)) } });
  if (extra.tags || extra.categoryIds) await setDocumentTaxonomy(admin, id, { tagNames: extra.tags ?? [], categoryIds: extra.categoryIds ?? [] });
  await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

describe("redirects", () => {
  it("refuses open redirects and system paths", async () => {
    for (const toPath of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      await expect(createRedirect(admin, { fromPath: "/old", toPath })).rejects.toMatchObject({ code: "invalid" });
    }
    await expect(createRedirect(admin, { fromPath: "/admin", toPath: "/x" })).rejects.toMatchObject({ code: "invalid" });
    await expect(createRedirect(admin, { fromPath: "/same", toPath: "/same" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("prevents loops: A→B then B→A leaves only B→A", async () => {
    await db.transaction((tx) => upsertRedirect(tx, { fromPath: "/loop-a", toPath: "/loop-b" }));
    await db.transaction((tx) => upsertRedirect(tx, { fromPath: "/loop-b", toPath: "/loop-a" }));
    const rows = await db.select().from(redirects);
    expect(rows.some((r) => r.fromPath === "/loop-a")).toBe(false);
    expect(await resolveRedirect("/loop-b")).toEqual({ location: "/loop-a", permanent: true });
  });

  it("supports prefix rules for renamed content types", async () => {
    await db.transaction((tx) => upsertRedirect(tx, { fromPath: "/posts", toPath: "/article", matchType: "prefix" }));
    expect(await resolveRedirect("/posts/hello-world")).toEqual({ location: "/article/hello-world", permanent: true });
    expect(await resolveRedirect("/postsx/hello")).toBeNull();
  });
});

describe("root URL namespace", () => {
  it("prevents categories from colliding with content types, system pages and reserved routes", async () => {
    for (const slug of ["article", "about", "admin", "api", "search", "tag"]) {
      await expect(createCategory(admin, { name: slug, slug })).rejects.toBeDefined();
    }
    await expect(createContentType(admin, { name: "Money", slug: "money", template: "editorial", fields: [] })).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects category parent cycles and redirects renamed categories", async () => {
    const parent = await createCategory(admin, { name: "Parent Topic" });
    const child = await createCategory(admin, { name: "Child Topic", parentId: parent.id });
    await expect(updateCategory(admin, parent.id, { name: "Parent Topic", slug: parent.slug, parentId: child.id })).rejects.toMatchObject({ code: "invalid" });
    await updateCategory(admin, child.id, { name: "Child Topic", slug: "renamed-child", parentId: parent.id });
    expect(await resolveRedirect("/child-topic")).toEqual({ location: "/renamed-child", permanent: true });
    expect(await resolveRedirect("/child-topic/page/2")).toEqual({ location: "/renamed-child/page/2", permanent: true });
  });
});

describe("dynamic content types", () => {
  it("creates a new type without code changes and renders its documents at /{type}/{slug}", async () => {
    const type = await createContentType(admin, {
      name: "Podcast",
      slug: "podcast",
      template: "media",
      schemaType: "CreativeWork",
      icon: "mic",
      fields: [{ key: "episode", label: "Episode", type: "number" }],
    });
    const { id } = await createDocument(admin, { typeId: type.id, title: "Episode one" });
    await saveDocument(admin, id, { body: { properties: { episode: "1" } } });
    await runDocumentAction(admin, id, { action: "publish" });
    const doc = await getDocumentByTypeAndSlug("podcast", "episode-one");
    expect(doc?.properties).toEqual({ episode: 1 });
    expect(doc?.type.template).toBe("media");
  });

  it("migrates stored values when a field key is renamed, and redirects when the type slug changes", async () => {
    const type = (await loadContentTypes(db)).find((t) => t.slug === "podcast")!;
    const field = type.fields[0]!;
    await updateContentType(admin, type.id, { ...type, slug: "podcasts", fields: [{ ...field, key: "episodeNumber" }] });
    const [row] = await db.select().from(documents).where(eq(documents.slug, "episode-one"));
    expect(row!.properties).toEqual({ episodeNumber: 1 });
    expect(await resolveRedirect("/podcast/episode-one")).toEqual({ location: "/podcasts/episode-one", permanent: true });
  });

  it("refuses unknown templates (no arbitrary code) and deleting types that still have documents", async () => {
    await expect(createContentType(admin, { name: "Evil", slug: "evil", template: "<script>", fields: [] })).rejects.toMatchObject({ code: "invalid" });
    const type = (await loadContentTypes(db)).find((t) => t.slug === "podcasts")!;
    await expect(deleteContentType(admin, type.id)).rejects.toMatchObject({ code: "conflict" });
    const page = (await loadContentTypes(db)).find((t) => t.slug === "page")!;
    await expect(deleteContentType(admin, page.id)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("tags", () => {
  it("merging redirects the old tag URL", async () => {
    const a = await createTag(admin, { name: "Frugal" });
    const b = await createTag(admin, { name: "Frugality" });
    await mergeTags(admin, a.id, b.id);
    expect(await resolveRedirect("/tag/frugal")).toEqual({ location: "/tag/frugality", permanent: true });
  });
});

describe("search", () => {
  beforeAll(async () => {
    await publish("article", "Index funds for beginners", "A simple guide to low-cost index investing and compounding.", { tags: ["investing"] });
    await publish("article", "Kafka in production", "Lessons from running event streaming systems at scale.");
    await publish("guide", "Deploying Spring Boot on AWS", "Step by step: packaging, ECS and monitoring.");
  });

  it("finds by title, body, prefix and taxonomy, ranking title matches first", async () => {
    expect((await searchPublic("index funds"))[0]?.title).toBe("Index funds for beginners");
    expect((await searchPublic("compound"))[0]?.title).toBe("Index funds for beginners");
    expect((await searchPublic("spri"))[0]?.title).toBe("Deploying Spring Boot on AWS");
    expect((await searchPublic("investing")).map((r) => r.title)).toContain("Index funds for beginners");
  });

  it("filters by type and highlights matches with safe sentinels", async () => {
    const results = await searchPublic("aws", { typeSlug: "guide" });
    expect(results.map((r) => r.typeSlug)).toEqual(["guide"]);
    const [hit] = await searchPublic("streaming");
    expect(hit?.snippet).toContain(HIGHLIGHT_START);
    expect(hit?.snippet).not.toContain("<");
  });

  it("tolerates hostile input without errors", async () => {
    for (const q of ["'; drop table x; --", "a & | ! ( ) : *", "%_\\", "<script>", "🙂"]) {
      await expect(searchPublic(q)).resolves.toBeDefined();
    }
  });

  it("admin search includes drafts; public search never does", async () => {
    await createDocument(admin, { typeId: await typeId(db, "article"), title: "Unpublished kafka notes" });
    expect((await searchPublic("unpublished")).length).toBe(0);
    expect((await searchAdmin(admin, "unpublished")).map((r) => r.title)).toContain("Unpublished kafka notes");
  });
});

describe("recommendations", () => {
  it("orders by explicit relation, then shared topic, then shared tag", async () => {
    const cats = await listCategories();
    const money = cats.find((c) => c.slug === "money")!.id;
    const source = await publish("article", "Rec source", "x", { tags: ["fire"], categoryIds: [money] });
    const tagOnly = await publish("article", "Shares a tag", "x", { tags: ["fire"] });
    const catOnly = await publish("article", "Shares a topic", "x", { categoryIds: [money] });
    const related = await publish("project", "Explicitly related", "x");
    await publish("article", "Unrelated", "x");
    await setDocumentRelations(admin, source, { relations: [{ targetId: related, kind: "related" }] });
    const recs = await recommendFor({ id: source, typeId: await typeId(db, "article") }, 4);
    expect(recs.slice(0, 3).map((r) => r.id)).toEqual([related, catOnly, tagOnly]);
    expect(recs[0]!.reasons).toContain("Connected");
  });

  it("category pages aggregate sub-categories", async () => {
    const cats = await listCategories();
    const investing = cats.find((c) => c.slug === "investing")!.id;
    await publish("article", "Child category post", "x", { categoryIds: [investing] });
    const money = (await getCategoryBySlug("money"))!;
    const data = await getCategoryPageData(money);
    expect(data.latest.map((c) => c.title)).toContain("Child category post");
  });

  it("'By format' only offers content types that have an index page", async () => {
    const money = (await getCategoryBySlug("money"))!;
    await publish("page", "Money principles", "x", { categoryIds: [money.id] });
    const data = await getCategoryPageData(money);
    expect(data.byType.length).toBeGreaterThan(0);
    // A standalone page type has no /page index; linking it would 404.
    expect(data.byType.every((r) => r.type.routing === "type")).toBe(true);
  });
});
