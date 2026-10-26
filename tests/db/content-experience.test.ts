import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocumentView } from "@/components/templates/document-view";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { documents, media } from "@/server/db/schema";
import { buildObjectKey } from "@/server/media/validation";
import { feedItems, sitemapEntries } from "@/server/seo/discovery";
import { loadDocumentPage, type DocumentPageData } from "@/server/services/document-page";
import { createDocument, runDocumentAction, saveDocument, setCollectionItems, setDocumentTaxonomy } from "@/server/services/documents";
import { getDocumentByTypeAndSlug } from "@/server/services/public-content";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

/**
 * Does each kind of content get the experience it needs? Every seeded type is
 * rendered with all of its fields filled in, and every value must be visible
 * somewhere on the page — a field the studio asks for is never silently dropped.
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

async function make(typeSlug: string, title: string, o: { properties?: Record<string, unknown>; body?: string; tags?: string[]; publish?: boolean } = {}) {
  const { id } = await createDocument(admin, { typeId: await typeId(db, typeSlug), title });
  await saveDocument(admin, id, { body: { content: docOf(paragraph(o.body ?? `${title} body.`)), properties: o.properties ?? {} } });
  if (o.tags) await setDocumentTaxonomy(admin, id, { categoryIds: [], tagNames: o.tags });
  if (o.publish !== false) await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

async function pageOf(typeSlug: string, id: string): Promise<DocumentPageData> {
  const [row] = await db.select({ slug: documents.slug }).from(documents).where(eq(documents.id, id));
  const doc = await getDocumentByTypeAndSlug(typeSlug, row!.slug);
  return loadDocumentPage(doc!);
}

async function render(data: DocumentPageData): Promise<string> {
  const { prelude } = await prerenderToNodeStream(createElement(DocumentView, { data }));
  let html = "";
  for await (const chunk of prelude) html += chunk.toString();
  // Only what a visitor sees: structured data would satisfy these assertions on its own.
  // React separates adjacent text nodes with empty comments ("4<!-- -->/5").
  return html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "").replace(/<!-- -->/g, "");
}

async function coverImage() {
  const id = randomUUID();
  const [row] = await db
    .insert(media)
    .values({ id, kind: "image", storageKey: buildObjectKey("image", id, "webp"), mimeType: "image/webp", originalName: "cover.webp", sizeBytes: 1000, width: 600, height: 900, variants: [] })
    .returning();
  return row!.id;
}

describe("every field a type defines is visible on its page", () => {
  // [type, properties, strings that must appear]
  const cases: Array<[string, Record<string, unknown>, string[]]> = [
    ["article", { takeaways: "Retries are normal", audience: "Backend engineers", difficulty: "beginner", prerequisites: "Some SQL", sources: "Kleppmann https://dataintensive.net" }, ["Retries are normal", "Backend engineers", "Beginner", "Some SQL", "Kleppmann"]],
    ["guide", { audience: "First-time deployers", difficulty: "advanced", prerequisites: "An AWS account", takeaways: "Ship a jar" }, ["First-time deployers", "Advanced", "An AWS account", "Ship a jar"]],
    ["note", { source: "https://boringtechnology.club/" }, ["boringtechnology.club"]],
    [
      "project",
      { liveUrl: "https://studio.example", repositoryUrl: "https://github.com/example/studio", status: "live", techStack: ["Postgres", "Next.js"], myRole: "Everything", startDate: "2026-06-01", endDate: "2026-08-01" },
      ["https://studio.example", "https://github.com/example/studio", "Live", "Postgres", "Next.js", "Everything", "1 June 2026", "1 August 2026"],
    ],
    ["video", { youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", duration: "12:40", transcript: "Hello and welcome" }, ["dQw4w9WgXcQ", "12:40", "Hello and welcome"]],
    [
      "talk",
      { eventName: "Chennai JUG", eventDate: "2026-02-21", location: "Chennai", audience: "Backend engineers", youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", slidesUrl: "https://slides.example/deck.pdf" },
      ["Chennai JUG", "21 February 2026", "Chennai", "Backend engineers", "dQw4w9WgXcQ", "https://slides.example/deck.pdf"],
    ],
    ["course", { level: "intermediate", duration: "12 days", prerequisites: "One backend language", courseUrl: "https://learn.example/course" }, ["Intermediate", "12 days", "One backend language", "https://learn.example/course"]],
    ["resource", { url: "https://www.jetbrains.com/idea/", kind: "tool", audience: "Java developers", pricing: "freemium" }, ["https://www.jetbrains.com/idea/", "Tool", "Java developers", "Freemium"]],
    [
      "experiment",
      { hypothesis: "Daily notes make essays easier", status: "concluded", result: "27 of 30 days", lessons: "Lower the bar", startDate: "2026-05-01", endDate: "2026-05-30" },
      ["Daily notes make essays easier", "Concluded", "27 of 30 days", "Lower the bar", "May 2026"],
    ],
    ["book-review", { bookTitle: "Deep Work", bookAuthor: "Cal Newport", rating: 4, isbn: "9781455586691", purchaseUrl: "https://books.example/deep-work", takeaways: "Depth is trainable" }, ["Deep Work", "Cal Newport", "4/5", "9781455586691", "https://books.example/deep-work", "Depth is trainable"]],
    ["journey", { period: "2019 – 2021", startDate: "2019-07-01", endDate: "2021-06-30", turningPoint: "Getting paged at 3am", lessons: "Production teaches" }, ["2019 – 2021", "Getting paged at 3am", "Production teaches"]],
  ];

  for (const [type, properties, expected] of cases) {
    it(`${type}: shows ${expected.length} values`, async () => {
      const id = await make(type, `A ${type} with every field`, { properties });
      const html = await render(await pageOf(type, id));
      for (const text of expected) expect(html, `${type} is missing "${text}"`).toContain(text);
    });
  }

  it("a book cover is shown at book size beside the review, not stretched into a hero", async () => {
    const cover = await coverImage();
    const id = await make("book-review", "Cover test", { properties: { bookTitle: "Cover Book", cover } });
    const html = await render(await pageOf("book-review", id));
    expect(html).toContain('alt="Cover of Cover Book"');
    expect(html).toContain('aria-label="About Cover Book"');
    expect(html).not.toContain("(min-width: 1216px) 1152px");
  });
});

describe("presentation fits the kind of content", () => {
  it("claims authorship only where it's true", async () => {
    const cases: Array<[string, string | null]> = [
      ["article", "Written by"],
      ["journey", "Written by"],
      ["project", "Built by"],
      ["note", null],
      ["resource", null],
      ["video", null],
    ];
    for (const [type, label] of cases) {
      const id = await make(type, `Authorship ${type}`, { properties: type === "resource" ? { url: "https://tool.example" } : type === "video" ? { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" } : {} });
      const html = await render(await pageOf(type, id));
      if (label) expect(html, type).toContain(label);
      else expect(html, type).not.toContain('aria-label="About the author"');
    }
  });

  it("a talk offers organisers a way to invite me, and states the event once", async () => {
    const id = await make("talk", "Talk once", { properties: { eventName: "DevFest", eventDate: "2026-03-01", location: "Madurai" } });
    const html = await render(await pageOf("talk", id));
    expect(html).toContain("Invite me to speak");
    expect(html).not.toContain('aria-label="About the author"');
    expect(html.match(/Madurai/g)).toHaveLength(1);
  });

  it("an experiment states its hypothesis and result before the story, with an honest period", async () => {
    const id = await make("experiment", "Order test", { body: "THE-STORY-BODY", properties: { hypothesis: "THE-HYPOTHESIS", result: "THE-RESULT", startDate: "2026-05-01", endDate: "2026-05-30" } });
    const html = await render(await pageOf("experiment", id));
    const story = html.indexOf('<div class="prose');
    expect(story).toBeGreaterThan(-1);
    expect(html.indexOf("THE-HYPOTHESIS")).toBeLessThan(story);
    expect(html.indexOf("THE-RESULT")).toBeLessThan(story);
    expect(html).toContain("May 2026");
    expect(html).not.toContain("2026 – 2026");
  });

  it("a note with no minutes to speak of doesn't announce a reading time", async () => {
    const id = await make("note", "Tiny note");
    expect(await render(await pageOf("note", id))).not.toContain("min read");
  });

  it("a journey chapter knows its place in the story", async () => {
    await make("journey", "Chapter one", { properties: { startDate: "2010-01-01" } });
    const two = await make("journey", "Chapter two", { properties: { startDate: "2011-01-01" } });
    await make("journey", "Chapter three", { properties: { startDate: "2012-01-01" } });
    const data = await pageOf("journey", two);
    expect(data.place).toMatchObject({ position: 2, title: "Journey", href: "/journey" });
    expect(data.place!.total).toBeGreaterThanOrEqual(3);
  });
});

describe("what next: the end of a page never repeats what it already offers", () => {
  let lessons: string[];
  let course: string;

  beforeAll(async () => {
    lessons = [];
    for (const n of [1, 2, 3, 4]) lessons.push(await make("guide", `Lesson ${n}`, { tags: ["paths"] }));
    await make("article", "Something else on paths", { tags: ["paths"] });
    course = await make("course", "A course", { publish: false });
    await setDocumentTaxonomy(admin, course, { categoryIds: [], tagNames: ["paths"] });
    await setCollectionItems(admin, course, { items: lessons.map((documentId) => ({ documentId })) });
    await runDocumentAction(admin, course, { action: "publish" });
  });

  it("a course doesn't recommend its own lessons", async () => {
    const data = await pageOf("course", course);
    const ids = data.recommendations.map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const lesson of lessons) expect(ids).not.toContain(lesson);
  });

  it("a lesson doesn't recommend its course or the other lessons", async () => {
    const data = await pageOf("guide", lessons[1]!);
    expect(data.series?.collection.id).toBe(course);
    const ids = data.recommendations.map((r) => r.id);
    expect(ids).not.toContain(course);
    for (const lesson of lessons) expect(ids).not.toContain(lesson);
    expect(data.recommendations.some((r) => r.title === "Something else on paths")).toBe(true);
  });

  it("a chapter doesn't recommend the chapters its previous/next already link to", async () => {
    const a = await make("journey", "Adjacent A", { properties: { startDate: "2000-01-01" }, tags: ["story"] });
    const b = await make("journey", "Adjacent B", { properties: { startDate: "2000-02-01" }, tags: ["story"] });
    const c = await make("journey", "Adjacent C", { properties: { startDate: "2000-03-01" }, tags: ["story"] });
    const data = await pageOf("journey", b);
    expect(data.previous?.id).toBe(a);
    expect(data.next?.id).toBe(c);
    const ids = data.recommendations.map((r) => r.id);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(c);
  });
});

describe("Start here and the toolkit are represented by their pages", () => {
  async function seeded(slug: string) {
    const [row] = await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, slug));
    return row!.id;
  }

  it("a real series wins the 'N of M' line over the Start here sampler, which links to /start-here once that page is public", async () => {
    const piece = await make("project", "Project in both");
    const other = await make("note", "Project log entry");
    const log = await make("collection", "Project log", { publish: false });
    await setCollectionItems(admin, log, { items: [piece, other].map((documentId) => ({ documentId })) });
    await runDocumentAction(admin, log, { action: "publish" });
    // Start here is published last, so it would win on recency alone.
    const startHere = await seeded("start-here-path");
    await setCollectionItems(admin, startHere, { items: [other, piece].map((documentId) => ({ documentId })) });
    await runDocumentAction(admin, startHere, { action: "publish" });

    const before = await pageOf("project", piece);
    expect(before.series?.collection.id).toBe(log);
    expect(before.collections.find((c) => c.id === startHere)?.path).toBe("/collection/start-here-path");
    const sitemapBefore = (await sitemapEntries()).map((e) => e.url);
    expect(sitemapBefore.some((u) => u.endsWith("/collection/start-here-path"))).toBe(true);

    const startPage = await seeded("start-here");
    await saveDocument(admin, startPage, { body: { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A completed introduction to this reading path." }] }] } } });
    await runDocumentAction(admin, startPage, { action: "publish" });
    const after = await pageOf("project", piece);
    expect(after.collections.find((c) => c.id === startHere)?.path).toBe("/start-here");
    // Listed once, as the page it's represented by.
    const sitemapAfter = (await sitemapEntries()).map((e) => e.url);
    expect(sitemapAfter.some((u) => u.endsWith("/start-here"))).toBe(true);
    expect(sitemapAfter.some((u) => u.endsWith("/collection/start-here-path"))).toBe(false);
    // The feed links the canonical page too, never the URL that canonicalises away.
    const feedAfter = (await feedItems()).filter((i) => i.title === "Start here").map((i) => i.url);
    expect(feedAfter).toEqual(["https://karthikeyan.example/start-here"]);
  });
});
