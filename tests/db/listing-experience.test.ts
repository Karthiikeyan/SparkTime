import { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CategoryView } from "@/components/pages/category-view";
import { TagView } from "@/components/pages/tag-view";
import { TypeIndexView } from "@/components/pages/type-index-view";
import { getSiteSections } from "@/server/services/sections";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { createDocument, runDocumentAction, saveDocument, setDocumentTaxonomy } from "@/server/services/documents";
import { getCategoryPageData, getTagPageData, getTopicDirectory, getTypeIndexData, listSeries } from "@/server/services/public-content";
import { getLibraryListing, LIBRARY_PAGE_SIZE, libraryQuery, parseLibraryFilter } from "@/server/services/library";
import { listCategories, listTags } from "@/server/services/taxonomy";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

/**
 * Listing pages — topic hubs, tag pages and type indexes — as a visitor meets
 * them: every piece appears once, cards name their type once, and the heading
 * outline stays h1 → h2 → h3 however much (or little) is published.
 */

const SITE = "https://karthikeyan.example";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
});
afterAll(() => ctx.close());

async function render(element: React.ReactNode): Promise<string> {
  const { prelude } = await prerenderToNodeStream(element as React.ReactElement);
  let html = "";
  for await (const chunk of prelude) html += chunk.toString();
  // Structured data repeats every title; only what a visitor sees is asserted.
  return html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "").replace(/<!-- -->/g, "");
}

const headings = (html: string) => [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({ level: Number(m[1]), text: m[2]!.replace(/<[^>]+>/g, "").trim() }));
const occurrences = (html: string, needle: string) => html.split(needle).length - 1;

/** No heading level is ever skipped (h1 → h3 leaves screen-reader users guessing). */
function skippedLevels(html: string): string[] {
  const bad: string[] = [];
  let previous = 0;
  for (const h of headings(html)) {
    if (previous && h.level > previous + 1) bad.push(`h${previous} -> h${h.level} "${h.text}"`);
    previous = h.level;
  }
  return bad;
}

async function categoryBySlug(slug: string) {
  const found = (await listCategories()).find((c) => c.slug === slug);
  if (!found) throw new Error(`no category ${slug}`);
  return found;
}

async function make(typeSlug: string, title: string, o: { categories?: string[]; tags?: string[]; featured?: boolean } = {}) {
  const { id } = await createDocument(admin, { typeId: await typeId(db, typeSlug), title });
  await saveDocument(admin, id, {
    body: { content: docOf(paragraph(`${title} body.`)), excerpt: "A short standing-in summary.", properties: {} },
    settings: o.featured ? { featured: true } : {},
  });
  const categoryIds = await Promise.all((o.categories ?? []).map(async (s) => (await categoryBySlug(s)).id));
  if (categoryIds.length || o.tags) {
    await setDocumentTaxonomy(admin, id, { categoryIds, primaryCategoryId: categoryIds[0] ?? null, tagNames: o.tags ?? [] });
  }
  await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

async function renderCategory(slug: string) {
  const category = await categoryBySlug(slug);
  return render(await CategoryView({ data: await getCategoryPageData(category), siteUrl: SITE }));
}

describe("topic hubs show each piece once", () => {
  it("does not repeat the list when every piece in the topic is featured", async () => {
    await make("note", "Only piece alpha", { categories: ["life"], featured: true });
    await make("note", "Only piece beta", { categories: ["life"], featured: true });

    const html = await renderCategory("life");

    expect(html).toContain("Latest in Life");
    // Each piece is listed once, however many times it is featured.
    expect(occurrences(html, "Only piece alpha")).toBe(1);
    expect(occurrences(html, "Only piece beta")).toBe(1);
  });

  it("lists featured and ordinary pieces together, once each", async () => {
    await make("note", "Learning featured piece", { categories: ["learning"], featured: true });
    await make("note", "Learning ordinary piece", { categories: ["learning"] });

    const html = await renderCategory("learning");

    expect(html).toContain("Latest in Learning");
    expect(occurrences(html, "Learning featured piece")).toBe(1);
    expect(occurrences(html, "Learning ordinary piece")).toBe(1);
  });

  it("keeps the heading outline unbroken", async () => {
    expect(skippedLevels(await renderCategory("life"))).toEqual([]);
    expect(skippedLevels(await renderCategory("learning"))).toEqual([]);
  });

  it("labels pieces by topic; an ordinary piece of writing never shows its internal format", async () => {
    const html = await renderCategory("learning");
    expect(html).toContain("Learning");
    expect(html).not.toContain(">Note<");
  });
});

describe("forms are named only when they change what the reader gets", () => {
  it("names a project once, beside its topic", async () => {
    await make("project", "A project without a picture", { categories: ["technology"], featured: true });

    const html = await renderCategory("technology");

    expect(html).toContain("A project without a picture");
    expect(occurrences(html, ">Project<")).toBe(1);
  });
});

describe("tag pages", () => {
  it("keeps the heading outline unbroken between the page title and its cards", async () => {
    await make("note", "Tagged piece one", { tags: ["auditing"] });
    await make("note", "Tagged piece two", { tags: ["auditing"] });
    const tag = (await listTags()).find((t) => t.slug === "auditing");
    expect(tag).toBeDefined();

    const html = await render(createElement(TagView, { tag: tag!, data: await getTagPageData(tag!), siteUrl: SITE }));

    expect(skippedLevels(html)).toEqual([]);
    expect(headings(html)[0]?.level).toBe(1);
    expect(occurrences(html, "Tagged piece one")).toBe(1);
  });

  it("still reads cleanly with nothing published under the tag", async () => {
    const { id } = await createDocument(admin, { typeId: await typeId(db, "note"), title: "Draft only" });
    await setDocumentTaxonomy(admin, id, { categoryIds: [], tagNames: ["quiet"] });
    const tag = (await listTags()).find((t) => t.slug === "quiet");

    const html = await render(createElement(TagView, { tag: tag!, data: await getTagPageData(tag!), siteUrl: SITE }));

    expect(html).toContain("Nothing public with this tag yet");
    expect(html).not.toContain("Draft only");
    expect(skippedLevels(html)).toEqual([]);
  });
});

describe("type indexes", () => {
  it("keeps the heading outline unbroken", async () => {
    const type = (await import("@/server/services/content-types")).listContentTypes;
    const noteType = (await type()).find((t) => t.slug === "note")!;
    const data = await getTypeIndexData(noteType, 1);
    const section = (await getSiteSections()).sectionOfType(noteType.id);
    const html = await render(createElement(TypeIndexView, { type: noteType, items: data.items, total: data.total, page: 1, perPage: data.perPage, siteUrl: SITE, section }));

    expect(skippedLevels(html)).toEqual([]);
    // A format's index is a filtered view of its section: the section is named, and one click away.
    expect(section.label).toBe("Library");
    expect(html).toContain('href="/library"');
  });
});

describe("the studio flags content that would make the site look unfinished", () => {
  it("preserves incomplete drafts but refuses to publish explicit placeholder prompts", async () => {
    const { id } = await createDocument(admin, { typeId: await typeId(db, "article"), title: "Work in progress" });
    await saveDocument(admin, id, { body: { content: docOf(paragraph("[ADD SCREENSHOT] The final interface")) } });
    await expect(runDocumentAction(admin, id, { action: "publish" })).rejects.toThrow("isn't ready to publish");
    await saveDocument(admin, id, { body: { content: docOf({ type: "codeBlock", content: [{ type: "text", text: "[TODO] is valid example code" }] }, { type: "blockquote", content: [paragraph("[TODO] A quoted editorial prompt")] }, paragraph("A complete explanation of TODO markers.")) } });
    await expect(runDocumentAction(admin, id, { action: "publish" })).resolves.toHaveProperty("id", id);
  });

  it("names a published document titled after its own type, and leaves real titles alone", async () => {
    const { placeholderDocuments } = await import("@/server/services/documents");

    // The shape a template test leaves behind: a published document called "Guide".
    await make("guide", "Guide");
    // Same title, but never published — harmless, and not worth nagging about.
    const draft = await createDocument(admin, { typeId: await typeId(db, "note"), title: "Note" });
    expect(draft.id).toBeTruthy();
    await make("guide", "How to prepare for a system design interview");

    const flagged = await placeholderDocuments(admin);
    const demo = flagged.filter((d) => d.reason === "demo").map((d) => d.title);

    expect(demo).toContain("Guide");
    expect(demo).not.toContain("Note");
    expect(demo).not.toContain("How to prepare for a system design interview");
  });
});

describe("the library", () => {
  it("filters by kind and topic, newest first, and says when a topic is unknown", async () => {
    await make("article", "Library Zebra", { categories: ["career"], featured: true });
    await make("article", "Library Alpha", { categories: ["career"] });
    const guides = await getLibraryListing({ kind: "guide", topic: "career", sort: "newest" }, 1);
    const titles = guides.rows.map((r) => r.card.title);
    expect(titles).toEqual(expect.arrayContaining(["Library Zebra", "Library Alpha"]));
    expect(guides.topicName).toBe("Career");
    expect(guides.counts.all).toBeGreaterThanOrEqual(guides.counts.guide);
    // No courses are published, so that filter is honestly empty rather than showing everything.
    expect((await getLibraryListing({ kind: "course", topic: null, sort: "newest" }, 1)).rows).toEqual([]);
    const unknown = await getLibraryListing({ kind: "all", topic: "no-such-topic", sort: "newest" }, 1);
    expect(unknown.rows).toEqual([]);
    expect(unknown.topicKnown).toBe(false);
  });

  it("parses filters from the address and drops anything unrecognised", () => {
    expect(parseLibraryFilter({ type: "course", topic: "technology", sort: "short" })).toEqual({ kind: "course", topic: "technology", sort: "short" });
    expect(parseLibraryFilter({ type: "<script>", topic: "Not A Slug!", sort: "x" })).toEqual({ kind: "all", topic: null, sort: "newest" });
    expect(libraryQuery({ kind: "all", topic: null, sort: "newest" })).toBe("");
    expect(libraryQuery({ kind: "guide", topic: "career", sort: "short" })).toBe("?type=guide&topic=career&sort=short");
  });

  it("has no rows past the last page", async () => {
    expect((await getLibraryListing({ kind: "all", topic: null, sort: "newest" }, 9999)).rows).toEqual([]);
  });

  it("reaches every listed piece across pages without repeats", async () => {
    const filter = { kind: "all" as const, topic: null, sort: "newest" as const };
    for (let index = 0; index < LIBRARY_PAGE_SIZE; index++) await make("article", `Shelf ${String(index).padStart(2, "0")}`, { categories: ["money"] });
    const first = await getLibraryListing(filter, 1);
    const pages = [first];
    for (let n = 2; n <= first.pages; n++) pages.push(await getLibraryListing(filter, n));
    const ids = pages.flatMap((p) => p.rows.map((r) => r.card.id));
    expect(first.rows).toHaveLength(LIBRARY_PAGE_SIZE);
    expect(ids).toHaveLength(first.total);
    expect(new Set(ids).size).toBe(first.total);
  });

  it("lists topics as a tree with rolled-up counts", async () => {
    const directory = await getTopicDirectory();
    const money = directory.find((d) => d.topic.slug === "money");
    expect(money?.topic.count).toBeGreaterThanOrEqual(LIBRARY_PAGE_SIZE);
    expect(directory.every((d) => d.topic.parentId === null)).toBe(true);
  });

  it("summarises series with their readable parts only", async () => {
    const part = await make("article", "Series part one", { categories: ["career"] });
    const hidden = (await createDocument(admin, { typeId: await typeId(db, "article"), title: "Series draft part" })).id;
    const { id: series } = await createDocument(admin, { typeId: await typeId(db, "collection"), title: "Specimen series" });
    const { setCollectionItems } = await import("@/server/services/documents");
    await setCollectionItems(admin, series, { items: [{ documentId: part }, { documentId: hidden }] });
    await runDocumentAction(admin, series, { action: "publish" });
    const found = (await listSeries({ limit: 20 })).find((s) => s.id === series);
    expect(found?.parts).toBe(1);
  });
});
