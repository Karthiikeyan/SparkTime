import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import { loadDocumentPage } from "@/server/services/document-page";
import { createDocument, runDocumentAction, saveDocument, setCollectionItems, setDocumentTaxonomy } from "@/server/services/documents";
import {
  getAdjacent,
  getCategoryPageData,
  getCollectionsContaining,
  getDocumentByTypeAndSlug,
  getSeriesPosition,
  getTagPageData,
  TAXONOMY_PAGE_SIZE,
} from "@/server/services/public-content";
import { createCategory, getCategoryBySlug, getTagBySlug } from "@/server/services/taxonomy";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

/**
 * How a reader moves through the site: series order, narrative order and
 * paging through busy topics and tags.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
});
afterAll(() => ctx.close());

async function make(typeSlug: string, title: string, options: { properties?: Record<string, unknown>; publish?: boolean; visibility?: string; featured?: boolean } = {}) {
  const { id } = await createDocument(admin, { typeId: await typeId(db, typeSlug), title });
  await saveDocument(admin, id, {
    body: { content: docOf(paragraph(`${title} body.`)), properties: options.properties ?? {} },
    settings: { ...(options.visibility ? { visibility: options.visibility } : {}), ...(options.featured ? { featured: true } : {}) },
  });
  if (options.publish !== false) await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

async function collectionOf(title: string, itemIds: string[], options: { publish?: boolean; featured?: boolean } = {}) {
  const id = await make("collection", title, { publish: false, featured: options.featured });
  await setCollectionItems(admin, id, { items: itemIds.map((documentId) => ({ documentId })) });
  if (options.publish !== false) await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

async function pageFor(typeSlug: string, id: string) {
  const [row] = await db.select({ slug: documents.slug }).from(documents).where(eq(documents.id, id));
  const doc = await getDocumentByTypeAndSlug(typeSlug, row!.slug);
  return loadDocumentPage(doc!);
}

describe("series navigation", () => {
  let parts: string[];
  let path: string;

  beforeAll(async () => {
    // Published out of order on purpose: the path's order, not publish order, must win.
    const third = await make("guide", "Path part three");
    const first = await make("guide", "Path part one");
    const second = await make("guide", "Path part two");
    parts = [first, second, third];
    path = await collectionOf("A learning path", parts);
  });

  it("knows the position and neighbours in the collection's own order", async () => {
    const collections = await getCollectionsContaining(parts[1]!);
    const series = await getSeriesPosition(parts[1]!, collections);
    expect(series).toMatchObject({ position: 2, total: 3 });
    expect(series?.collection.id).toBe(path);
    expect(series?.previous?.id).toBe(parts[0]);
    expect(series?.next?.id).toBe(parts[2]);
  });

  it("has no previous at the start and no next at the end", async () => {
    const start = await getSeriesPosition(parts[0]!, await getCollectionsContaining(parts[0]!));
    const end = await getSeriesPosition(parts[2]!, await getCollectionsContaining(parts[2]!));
    expect(start?.previous).toBeNull();
    expect(start?.next?.id).toBe(parts[1]);
    expect(end?.next).toBeNull();
  });

  it("replaces date-based previous/next on the page and isn't repeated under Connected", async () => {
    const data = await pageFor("guide", parts[1]!);
    expect(data.series?.position).toBe(2);
    expect(data.collections.map((c) => c.id)).not.toContain(path);
    const recommended = data.recommendations.map((r) => r.id);
    expect(recommended).not.toContain(parts[0]);
    expect(recommended).not.toContain(parts[2]);
  });

  it("numbers only what the collection page shows: private items are skipped", async () => {
    const a = await make("guide", "Visible step A");
    const hidden = await make("guide", "Private step", { visibility: "private" });
    const b = await make("guide", "Visible step B");
    await collectionOf("Path with a private step", [a, hidden, b]);
    const series = await getSeriesPosition(b, await getCollectionsContaining(b));
    expect(series).toMatchObject({ position: 2, total: 2 });
    expect(series?.previous?.id).toBe(a);
  });

  it("ignores collections that aren't public, and single-item collections", async () => {
    const lone = await make("guide", "Only child");
    await collectionOf("Draft path", [lone, parts[0]!], { publish: false });
    await collectionOf("Solo collection", [lone]);
    expect(await getSeriesPosition(lone, await getCollectionsContaining(lone))).toBeNull();
  });

  it("prefers the most curated collection when a piece is in several", async () => {
    const shared = await make("guide", "Shared step");
    const other = await make("guide", "Other step");
    await collectionOf("Ordinary path", [shared, other]);
    const featuredPath = await collectionOf("Featured path", [other, shared], { featured: true });
    const series = await getSeriesPosition(shared, await getCollectionsContaining(shared));
    expect(series?.collection.id).toBe(featuredPath);
    expect(series?.position).toBe(2);
  });
});

describe("narrative order for previous/next", () => {
  it("journey chapters follow their start dates, not publish order", async () => {
    const later = await make("journey", "Chapter: founding", { properties: { startDate: "2023-01-01" } });
    const earliest = await make("journey", "Chapter: college", { properties: { startDate: "2015-06-01" } });
    const middle = await make("journey", "Chapter: first job", { properties: { startDate: "2019-07-01" } });
    const data = await pageFor("journey", middle);
    expect(data.previous?.id).toBe(earliest);
    expect(data.next?.id).toBe(later);
  });

  it("talks listed newest-first still read previous = the earlier event", async () => {
    const recent = await make("talk", "Recent talk", { properties: { eventDate: "2026-03-01" } });
    const old = await make("talk", "Old talk", { properties: { eventDate: "2024-03-01" } });
    const mid = await make("talk", "Middle talk", { properties: { eventDate: "2025-03-01" } });
    const doc = (await pageFor("talk", mid)).doc;
    const adjacent = await getAdjacent(doc);
    expect(adjacent.previous?.id).toBe(old);
    expect(adjacent.next?.id).toBe(recent);
  });

  it("everything else stays in publish order", async () => {
    const one = await make("note", "Note one");
    const two = await make("note", "Note two");
    const three = await make("note", "Note three");
    await saveDocument(admin, one, { settings: { publishedAt: "2026-01-01T00:00:00.000Z" } });
    await saveDocument(admin, two, { settings: { publishedAt: "2026-02-01T00:00:00.000Z" } });
    await saveDocument(admin, three, { settings: { publishedAt: "2026-03-01T00:00:00.000Z" } });
    const data = await pageFor("note", two);
    expect(data.previous?.id).toBe(one);
    expect(data.next?.id).toBe(three);
  });
});

describe("paging through topics and tags", () => {
  const extra = 3;
  let categoryId: string;

  beforeAll(async () => {
    categoryId = (await createCategory(admin, { name: "Busy topic" })).id;
    for (let i = 0; i < TAXONOMY_PAGE_SIZE + extra; i++) {
      const id = await make("note", `Busy note ${i}`);
      await setDocumentTaxonomy(admin, id, { categoryIds: [categoryId], tagNames: ["busy"] });
    }
  });

  it("a topic's later pages hold the pieces beyond the first page", async () => {
    const busy = (await getCategoryBySlug("busy-topic"))!;
    const first = await getCategoryPageData(busy, 1);
    const second = await getCategoryPageData(busy, 2);
    expect(first.total).toBe(TAXONOMY_PAGE_SIZE + extra);
    expect(first.latest).toHaveLength(TAXONOMY_PAGE_SIZE);
    expect(second.page).toBe(2);
    expect(second.latest).toHaveLength(extra);
    const firstIds = new Set(first.latest.map((c) => c.id));
    expect(second.latest.some((c) => firstIds.has(c.id))).toBe(false);
    expect((await getCategoryPageData(busy, 3)).latest).toHaveLength(0);
  });

  it("a tag's later pages do the same", async () => {
    const tag = (await getTagBySlug("busy"))!;
    const second = await getTagPageData(tag, 2);
    expect(second.total).toBe(TAXONOMY_PAGE_SIZE + extra);
    expect(second.items).toHaveLength(extra);
    expect(second.perPage).toBe(TAXONOMY_PAGE_SIZE);
  });

  it("pages never include private documents", async () => {
    const hidden = await make("note", "Hidden busy note", { visibility: "private" });
    await setDocumentTaxonomy(admin, hidden, { categoryIds: [categoryId], tagNames: ["busy"] });
    const tag = (await getTagBySlug("busy"))!;
    const all = [...(await getTagPageData(tag, 1)).items, ...(await getTagPageData(tag, 2)).items];
    expect(all.map((c) => c.id)).not.toContain(hidden);
    expect(all).toHaveLength(TAXONOMY_PAGE_SIZE + extra);
  });
});
