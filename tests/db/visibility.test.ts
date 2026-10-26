import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import type { AdminActor } from "@/server/auth/actor";
import { documents, navigationItems } from "@/server/db/schema";
import { feedItems, sitemapEntries } from "@/server/seo/discovery";
import { createDocument, runDocumentAction, saveDocument, setCollectionItems, setDocumentRelations, setDocumentTaxonomy } from "@/server/services/documents";
import { buildKnowledgeGraph } from "@/server/services/graph";
import { featurePath, getNavigation } from "@/server/services/navigation";
import {
  cardsByIds,
  getCollectionEntries,
  getConnections,
  getDocumentByTypeAndSlug,
  listPublished,
  publicTypeCounts,
  resolveReferences,
} from "@/server/services/public-content";
import { recommendFor } from "@/server/services/recommendations";
import { searchPublic } from "@/server/services/search";
import { loadAllSettings, updateSettings } from "@/server/services/settings";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

/**
 * The most important security property of the public site: a document that
 * is private, or not published, must be invisible through EVERY public
 * surface — pages, lists, search, related content, backlinks, collections,
 * mentions, graph, sitemap, RSS and navigation.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let admin: AdminActor;
const ids: Record<string, string> = {};
const SECRET = "zanzibarsecret";

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  admin = await createAdmin(ctx.db);
  const article = await typeId(ctx.db, "article");
  const collection = await typeId(ctx.db, "collection");

  const make = async (key: string, title: string, status: "published" | "draft" | "idea" | "archived", visibility: "public" | "unlisted" | "private") => {
    const { id } = await createDocument(admin, { typeId: article, title });
    await saveDocument(admin, id, { body: { content: docOf(paragraph(`${title} body about ${SECRET} and investing`)) }, settings: { visibility } });
    await setDocumentTaxonomy(admin, id, { tagNames: ["shared-tag"] });
    if (status === "published" || status === "archived") await runDocumentAction(admin, id, { action: "publish" });
    if (status !== "published" && status !== "draft") await runDocumentAction(admin, id, { action: "setStatus", status });
    ids[key] = id;
  };

  await make("public", "Public post", "published", "public");
  await make("unlisted", "Unlisted post", "published", "unlisted");
  await make("private", "Private post", "published", "private");
  await make("draft", "Draft post", "draft", "public");
  await make("idea", "Idea post", "idea", "public");
  await make("archived", "Archived post", "archived", "public");

  // Relations from/to the public doc involving hidden docs.
  await setDocumentRelations(admin, ids.public!, { relations: [{ targetId: ids.private!, kind: "related" }, { targetId: ids.draft!, kind: "references" }] });
  await setDocumentRelations(admin, ids.private!, { relations: [{ targetId: ids.public!, kind: "references" }] });
  await setDocumentRelations(admin, ids.draft!, { relations: [{ targetId: ids.public!, kind: "references" }] });

  const { id: listId } = await createDocument(admin, { typeId: collection, title: "Mixed list" });
  await setCollectionItems(admin, listId, { items: ["public", "unlisted", "private", "draft", "idea"].map((k) => ({ documentId: ids[k]! })) });
  await runDocumentAction(admin, listId, { action: "publish" });
  ids.collection = listId;
});
afterAll(() => ctx.close());

const hidden = () => [ids.private!, ids.draft!, ids.idea!];

it("keeps pagination bounded across one thousand searchable documents", async () => {
  const article = await typeId(ctx.db, "article");
  const inserted = await ctx.db.insert(documents).values(Array.from({ length: 1000 }, (_, index) => ({
    typeId: article, title: `Scalabilityquartz ${index}`, slug: `scale-fixture-${index}`,
    status: "published" as const, visibility: "public" as const, publishedAt: new Date(),
    plainText: "Local search scale fixture.",
  }))).returning({ id: documents.id });
  try {
    const timings: number[] = [];
    const seen = new Set<string>();
    for (const offset of [0, 25, 500, 975]) {
      const started = performance.now();
      const results = await searchPublic("Scalabilityquartz", { limit: 25, offset });
      timings.push(Math.round(performance.now() - started));
      expect(results).toHaveLength(25);
      for (const result of results) {
        expect(seen.has(result.id)).toBe(false);
        seen.add(result.id);
      }
    }
    expect(await searchPublic("Scalabilityquartz", { offset: 1000 })).toEqual([]);
    console.info("PGlite search, 1000 documents, offsets 0/25/500/975 (ms):", timings);
  } finally {
    await ctx.db.delete(documents).where(inArray(documents.id, inserted.map((item) => item.id)));
  }
});

it("omits externally canonical system pages from the sitemap", async () => {
  const { getRootPage } = await import("@/server/services/public-content");
  const about = await getRootPage("about");
  expect(about).not.toBeNull();
  await saveDocument(admin, about!.id, { settings: { canonicalUrl: "https://example.com/original-about" } });
  expect((await sitemapEntries()).some((entry) => entry.url.endsWith("/about"))).toBe(false);
  await saveDocument(admin, about!.id, { settings: { canonicalUrl: "" } });
});

describe("direct URLs", () => {
  it("serves public, unlisted and archived; refuses private, draft and idea", async () => {
    expect(await getDocumentByTypeAndSlug("article", "public-post")).not.toBeNull();
    expect(await getDocumentByTypeAndSlug("article", "unlisted-post")).not.toBeNull();
    expect((await getDocumentByTypeAndSlug("article", "archived-post"))?.status).toBe("archived");
    expect(await getDocumentByTypeAndSlug("article", "private-post")).toBeNull();
    expect(await getDocumentByTypeAndSlug("article", "draft-post")).toBeNull();
    expect(await getDocumentByTypeAndSlug("article", "idea-post")).toBeNull();
  });
});

describe("discovery surfaces list only public+published", () => {
  it("lists", async () => {
    const { items } = await listPublished({ limit: 100 });
    const listed = items.map((i) => i.id);
    expect(listed).toContain(ids.public);
    for (const id of [...hidden(), ids.unlisted!, ids.archived!]) expect(listed).not.toContain(id);
    expect((await publicTypeCounts()).size).toBeGreaterThan(0);
  });

  it("keeps standalone pages out of general feeds, recommendations and the graph", async () => {
    const pageType = await typeId(ctx.db, "page");
    const { id: pageId } = await createDocument(admin, { typeId: pageType, title: "Colophon" });
    await setDocumentTaxonomy(admin, pageId, { tagNames: ["shared-tag"] });
    await runDocumentAction(admin, pageId, { action: "publish" });

    expect((await listPublished({ limit: 100 })).items.map((i) => i.id)).not.toContain(pageId);
    expect((await listPublished({ limit: 100, includePages: true })).items.map((i) => i.id)).toContain(pageId);
    expect((await listPublished({ typeIds: [pageType], limit: 100 })).items.map((i) => i.id)).toContain(pageId);
    const recs = await recommendFor({ id: ids.public!, typeId: await typeId(ctx.db, "article") }, 12);
    expect(recs.map((r) => r.id)).not.toContain(pageId);
    expect((await buildKnowledgeGraph()).nodes.map((n) => n.id)).not.toContain(pageId);
    await runDocumentAction(admin, pageId, { action: "setStatus", status: "archived" });
  });

  it("search", async () => {
    const results = await searchPublic(SECRET);
    expect(results.map((r) => r.id)).toEqual([ids.public]);
    expect(results[0]).not.toHaveProperty("status");
    expect(results[0]).not.toHaveProperty("visibility");
  });

  it("paginates search without repeating matches or exposing hidden documents", async () => {
    const article = await typeId(ctx.db, "article");
    const created: string[] = [];
    for (let index = 0; index < 4; index++) {
      const { id } = await createDocument(admin, { typeId: article, title: `Pagination specimen ${index}` });
      await runDocumentAction(admin, id, { action: "publish" });
      created.push(id);
    }
    const first = await searchPublic("Pagination specimen", { limit: 2 });
    const second = await searchPublic("Pagination specimen", { limit: 2, offset: 2 });
    expect(new Set([...first, ...second].map((result) => result.id))).toEqual(new Set(created));
    expect(await searchPublic("Pagination specimen", { limit: 2, offset: 4 })).toEqual([]);
    expect(await searchPublic(SECRET, { limit: 1, offset: 1 })).toEqual([]);
    expect(await searchPublic("Pagination specimen", { categorySlug: "does-not-exist" })).toEqual([]);
  });

  it("relations and backlinks", async () => {
    const { outgoing, incoming } = await getConnections(ids.public!);
    const all = [...outgoing, ...incoming].map((c) => c.card.id);
    for (const id of hidden()) expect(all).not.toContain(id);
  });

  it("searches public collection and relationship context, never private context", async () => {
    const { id: collection } = await createDocument(admin, { typeId: await typeId(ctx.db, "collection"), title: "Contextualquartz" });
    await setCollectionItems(admin, collection, { items: [{ documentId: ids.public! }, { documentId: ids.private! }] });
    expect(await searchPublic("Contextualquartz")).toEqual([]);
    await runDocumentAction(admin, collection, { action: "publish" });
    expect((await searchPublic("Contextualquartz")).map((item) => item.id)).toEqual(expect.arrayContaining([collection, ids.public]));
    expect((await searchPublic("Contextualquartz")).map((item) => item.id)).not.toContain(ids.private);
    await saveDocument(admin, collection, { settings: { visibility: "private" } });
    expect(await searchPublic("Contextualquartz")).toEqual([]);

    const { id: project } = await createDocument(admin, { typeId: await typeId(ctx.db, "project"), title: "Contextualberyl" });
    await setDocumentRelations(admin, ids.public!, { relations: [{ targetId: project, kind: "related" }] });
    await runDocumentAction(admin, project, { action: "publish" });
    expect((await searchPublic("Contextualberyl")).map((item) => item.id)).toContain(ids.public);
    await saveDocument(admin, project, { settings: { visibility: "private" } });
    expect(await searchPublic("Contextualberyl")).toEqual([]);
  });

  it("does not reveal private collection membership through recommendation reasons", async () => {
    const { id: sibling } = await createDocument(admin, { typeId: await typeId(ctx.db, "article"), title: "A disconnected public piece" });
    await runDocumentAction(admin, sibling, { action: "publish" });
    const { id: collection } = await createDocument(admin, { typeId: await typeId(ctx.db, "collection"), title: "Private editorial plan" });
    await setCollectionItems(admin, collection, { items: [{ documentId: ids.public! }, { documentId: sibling }] });
    await saveDocument(admin, collection, { settings: { visibility: "private" } });
    await runDocumentAction(admin, collection, { action: "publish" });
    const recs = await recommendFor({ id: ids.public!, typeId: await typeId(ctx.db, "article") }, 12);
    expect(recs.find((item) => item.id === sibling)?.reasons ?? []).not.toContain("Same collection");
  });

  it("recommendations", async () => {
    const recs = await recommendFor({ id: ids.public!, typeId: await typeId(ctx.db, "article") }, 12);
    for (const id of [...hidden(), ids.unlisted!]) expect(recs.map((r) => r.id)).not.toContain(id);
  });

  it("knowledge graph", async () => {
    const graph = await buildKnowledgeGraph();
    const nodeIds = graph.nodes.map((n) => n.id);
    for (const id of [...hidden(), ids.unlisted!]) expect(nodeIds).not.toContain(id);
    expect(JSON.stringify(graph)).not.toContain("Private post");
  });

  it("sitemap and RSS", async () => {
    const urls = (await sitemapEntries()).map((e) => e.url).join("\n");
    expect(urls).toContain("/article/public-post");
    for (const slug of ["private-post", "draft-post", "idea-post", "unlisted-post", "archived-post"]) expect(urls).not.toContain(slug);
    const feed = (await feedItems()).map((i) => i.url).join("\n");
    expect(feed).toContain("public-post");
    for (const slug of ["private-post", "draft-post", "idea-post", "unlisted-post", "archived-post"]) expect(feed).not.toContain(slug);
  });
});

describe("explicit references never resolve hidden documents", () => {
  it("collections show accessible items only", async () => {
    const entries = (await getCollectionEntries(ids.collection!)).map((e) => e.card.id);
    expect(entries).toEqual([ids.public, ids.unlisted]);
  });

  it("mentions and related-content blocks", async () => {
    const refs = await resolveReferences({
      type: "doc",
      content: [{ type: "relatedContent", attrs: { documentIds: [ids.public, ids.private, ids.draft, ids.idea] } }],
    });
    expect([...refs.keys()]).toEqual([ids.public]);
    expect((await cardsByIds([ids.private!], "accessible")).length).toBe(0);
  });

  it("navigation links to hidden documents disappear", async () => {
    await ctx.db.insert(navigationItems).values({ location: "primary", label: "Secret", linkType: "document", refId: ids.private!, position: 99 });
    const nav = await getNavigation("primary");
    expect(nav.map((n) => n.label)).not.toContain("Secret");
  });

  it("navigation links to features switched off in Settings disappear, and to the retired graph always", async () => {
    const hrefs = async () => (await getNavigation("footer")).flatMap((g) => [g, ...g.children]).map((i) => i.href);
    // The seeded footer links to the library.
    expect(await hrefs()).toEqual(expect.arrayContaining(["/library"]));

    // An owner's saved menu that still links to the old graph never shows it.
    const { replaceNavigation } = await import("@/server/services/navigation");
    const saved = (await getNavigation("footer"));
    await replaceNavigation(admin, "footer", [{ label: "Old", linkType: "group", children: [{ label: "Graph", linkType: "internal", href: "/graph" }, { label: "Search", linkType: "internal", href: "/search" }, { label: "Library", linkType: "internal", href: "/library" }] }]);
    expect(await hrefs()).not.toContain("/graph");

    const features = (await loadAllSettings()).features;
    await updateSettings(admin, "features", { ...features, search: false });
    try {
      const off = await hrefs();
      expect(off).not.toContain("/search");
      expect(off).toContain("/library");
    } finally {
      await updateSettings(admin, "features", features);
    }
    expect(await hrefs()).toContain("/search");
    expect(saved.length).toBeGreaterThan(0);
  });

  it("feature paths ignore query strings, fragments and trailing slashes", () => {
    expect(featurePath("/search?q=aws#results")).toBe("/search");
    expect(featurePath("/graph/")).toBe("/graph");
    expect(featurePath("/")).toBe("/");
  });
});
