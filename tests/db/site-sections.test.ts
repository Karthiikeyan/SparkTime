import { eq } from "drizzle-orm";
import { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import AboutPage from "@/app/(site)/about/page";
import StartHerePage from "@/app/(site)/start-here/page";
import { WorkHubView } from "@/components/pages/hub-view";
import { DocumentView } from "@/components/templates/document-view";
import { replacementFor } from "@/lib/legacy-paths";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { categories, documents } from "@/server/db/schema";
import { sitemapEntries } from "@/server/seo/discovery";
import { loadDocumentPage } from "@/server/services/document-page";
import { createDocument, runDocumentAction, saveDocument, setCollectionItems, setDocumentTaxonomy } from "@/server/services/documents";
import { getWorkPage } from "@/server/services/hub-page";
import { getStartGoals } from "@/server/services/library";
import { getDocumentByTypeAndSlug } from "@/server/services/public-content";
import { recommendFor } from "@/server/services/recommendations";
import { getSiteSections, isLivePath } from "@/server/services/sections";
import { loadAllSettings, updateSettings } from "@/server/services/settings";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

/**
 * The public IA: three sections (Writing /blog, Work /work, Speaking
 * /speaking) that gather content types behind a visitor's intent, Start here
 * as orientation, and detail pages that know where they belong and what
 * comes next. Everything is driven by what is published â€” nothing here may
 * ever lead a visitor to an empty page or a 404.
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

async function make(typeSlug: string, title: string, o: { properties?: Record<string, unknown>; featured?: boolean; publish?: boolean; tags?: string[]; categoryIds?: string[] } = {}) {
  const { id } = await createDocument(admin, { typeId: await typeId(db, typeSlug), title });
  await saveDocument(admin, id, {
    body: { content: docOf(paragraph(`${title} body.`)), excerpt: `Why ${title} matters.`, properties: o.properties ?? {} },
    settings: o.featured ? { featured: true } : {},
  });
  if (o.tags || o.categoryIds) await setDocumentTaxonomy(admin, id, { categoryIds: o.categoryIds ?? [], primaryCategoryId: o.categoryIds?.[0], tagNames: o.tags ?? [] });
  if (o.publish !== false) await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

async function publishPage(slug: string) {
  const [row] = await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, slug));
  await saveDocument(admin, row!.id, { body: { content: docOf(paragraph(`Completed ${slug} page.`)) } });
  await runDocumentAction(admin, row!.id, { action: "publish" });
}

async function render(element: React.ReactNode): Promise<string> {
  const { prelude } = await prerenderToNodeStream(element as React.ReactElement);
  let html = "";
  for await (const chunk of prelude) html += chunk.toString();
  return html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "").replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
}

const headings = (html: string) => [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({ level: Number(m[1]), text: m[2]!.replace(/<[^>]+>/g, "").trim() }));
function skippedLevels(html: string): string[] {
  const bad: string[] = [];
  let previous = 0;
  for (const h of headings(html)) {
    if (previous && h.level > previous + 1) bad.push(`h${previous} -> h${h.level} "${h.text}"`);
    previous = h.level;
  }
  return bad;
}
const count = (html: string, needle: string) => html.split(needle).length - 1;

async function categoryId(slug: string) {
  const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug));
  return row!.id;
}

async function pageFor(typeSlug: string, id: string) {
  const [row] = await db.select({ slug: documents.slug }).from(documents).where(eq(documents.id, id));
  return loadDocumentPage((await getDocumentByTypeAndSlug(typeSlug, row!.slug))!);
}

describe("on a fresh site", () => {
  it("offers only the sections that have something behind them", async () => {
    const sections = await getSiteSections();
    expect(sections.hub("writing")).toMatchObject({ count: 0, live: false, path: "/blog" });
    expect(sections.hub("work")).toMatchObject({ count: 0, live: false, path: "/work" });
    // Speaking stands on its invitation alone.
    expect(sections.hub("speaking")).toMatchObject({ count: 0, live: true, path: "/speaking" });
    expect(await isLivePath("/blog")).toBe(false);
    expect(await isLivePath("/speaking")).toBe(true);
    // Draft pages, empty types and unknown paths are not live; published pages and features are.
    expect(await isLivePath("/now")).toBe(false);
    expect(await isLivePath("/start-here")).toBe(false);
    expect(await isLivePath("/article")).toBe(false);
    expect(await isLivePath("/no-such-page")).toBe(false);
    expect(await isLivePath("/about")).toBe(true);
    expect(await isLivePath("/contact?reason=Speaking")).toBe(true);
    expect(await isLivePath("/explore")).toBe(true);
    expect(await isLivePath("/library")).toBe(true);
    // No topic holds anything yet, so the directory isn't offered.
    expect(await isLivePath("/topics")).toBe(false);
  });

  it("renders Work honestly, with the flagship, a way on and an unbroken outline", async () => {
    const settings = await loadAllSettings();
    const work = await render(createElement(WorkHubView, { data: await getWorkPage(), identity: settings.identity, sparktribeUrl: "", siteUrl: SITE }));
    // SparkTribe is published by the seed, so Work is never empty-handed: the flagship leads.
    expect(work).toContain('href="/sparktribe"');
    expect(work).toContain("Senior Analyst at Capgemini");
    expect(count(work, "<h1")).toBe(1);
    expect(skippedLevels(work)).toEqual([]);
  });
});

describe("the retired Writing and Speaking addresses", () => {
  it("leave for the Library and About, and are no longer offered by the site", async () => {
    expect(replacementFor("/blog")).toBe("/library");
    expect(replacementFor("/article")).toBe("/library");
    expect(replacementFor("/speaking")).toBe("/about#speaking");
    expect(replacementFor("/blog?x=1")).toBe("/library?x=1");
    expect(replacementFor("/work")).toBe("/work");
    const urls = (await sitemapEntries()).map((e) => e.url);
    for (const gone of ["/blog", "/speaking", "/article"]) expect(urls.some((u) => u.endsWith(gone)), gone).toBe(false);
  });

  it("keep the section a piece belongs to pointing at where it lives now", async () => {
    const sections = await getSiteSections();
    expect(sections.hub("writing").tabs[0]).toMatchObject({ label: "All", href: "/library" });
    expect(sections.hub("speaking").tabs[0]).toMatchObject({ label: "All", href: "/about#speaking" });
    expect(sections.sectionOfType(await typeId(db, "article"))).toMatchObject({ label: "Library", href: "/library" });
  });
});

describe("Work", () => {
  it("puts work in progress first and gives each kind of work its own shelf, each piece once", async () => {
    await make("project", "Still building", { properties: { status: "building" } });
    await make("project", "Shipped thing", { properties: { status: "live" } });
    await make("experiment", "A running trial", { properties: { status: "running" } });
    await make("experiment", "A concluded trial", { properties: { status: "concluded" } });

    const data = await getWorkPage();
    expect(data.inProgress.map((c) => c.title).sort()).toEqual(["A running trial", "Still building"]);
    expect(data.shelves.map((s) => s.type.slug)).toEqual(["project", "experiment"]);
    const settings = await loadAllSettings();
    const html = await render(createElement(WorkHubView, { data, identity: settings.identity, sparktribeUrl: "https://sparktribe.example", siteUrl: SITE }));
    for (const title of ["Still building", "Shipped thing", "A running trial", "A concluded trial"]) expect(count(html, `>${title}<`), title).toBe(1);
    expect(html.indexOf(">Still building<")).toBeLessThan(html.indexOf(">Shipped thing<"));
    expect(html).toContain('href="https://sparktribe.example/"');
    expect(skippedLevels(html)).toEqual([]);
  });
});

describe("Speaking on About", () => {
  it("puts the invitation and past sessions on the About page, newest event first", async () => {
    await make("talk", "Older talk", { properties: { eventName: "Early Meetup", eventDate: "2025-03-01" } });
    await make("talk", "Newer talk", { properties: { eventName: "Recent Conf", eventDate: "2026-06-01" } });
    const html = await render(await AboutPage());
    expect(html).toContain('id="speaking"');
    expect(html).toContain("I speak about");
    expect(html).toContain('href="/contact?reason=Speaking"');
    expect(html.indexOf(">Newer talk<")).toBeGreaterThan(-1);
    expect(html.indexOf(">Newer talk<")).toBeLessThan(html.indexOf(">Older talk<"));
    expect(count(html, "<h1")).toBe(1);
    expect(skippedLevels(html)).toEqual([]);
  });
});

describe("a piece knows where it belongs and what comes next", () => {
  it("places a piece in the library by topic, and ends with 'Keep reading'", async () => {
    const id = await make("guide", "Where this belongs", { tags: ["deploy"] });
    await make("article", "A neighbour", { tags: ["deploy"] });
    const data = await pageFor("guide", id);
    expect(data.section).toMatchObject({ label: "Library", href: "/library" });
    expect(data.hub).toBe("writing");
    expect(data.trail).toEqual([{ label: "Library", href: "/library" }]);
    const html = await render(createElement(DocumentView, { data }));
    expect(html).toMatch(/aria-label="Breadcrumb"[\s\S]*href="\/library"/);
    expect(html).toContain(">Keep reading<");
    expect(html).toContain("The whole library");
    expect(count(html, "<h1")).toBe(1);
  });

  it("the journey belongs to About; resources to Library", async () => {
    const sections = await getSiteSections();
    expect(sections.sectionOfType(await typeId(db, "journey"))).toMatchObject({ label: "About", href: "/about" });
    expect(sections.sectionOfType(await typeId(db, "resource"))).toMatchObject({ label: "Library", href: "/library" });
  });

  it("points a career piece at SparkTribe, and only in the topics the owner picked", async () => {
    const career = await categoryId("career");
    const pages = (await loadAllSettings()).pages;
    await updateSettings(admin, "pages", { ...pages, sparktribe: { ...pages.sparktribe, url: "https://sparktribe.example", promoteCategoryIds: [career] } });

    const onTopic = await pageFor("article", await make("article", "Cracking your first interview", { categoryIds: [career] }));
    const offTopic = await pageFor("article", await make("article", "A money essay", { categoryIds: [await categoryId("money")] }));
    expect(onTopic.sparktribe).toMatchObject({ path: "/sparktribe", url: "https://sparktribe.example/" });
    expect(offTopic.sparktribe).toBeNull();
    const html = await render(createElement(DocumentView, { data: onTopic }));
    expect(html).toContain("Preparing for placements?");
  });

  it("ranks a piece from the same curated collection above one that only shares a tag", async () => {
    const source = await make("article", "Part one", { tags: ["path-test"] });
    const sibling = await make("note", "Part two, untagged");
    const tagOnly = await make("guide", "Shares a tag only", { tags: ["path-test"] });
    const { id: path } = await createDocument(admin, { typeId: await typeId(db, "collection"), title: "A reading path" });
    await setCollectionItems(admin, path, { items: [{ documentId: source }, { documentId: sibling }] });
    await runDocumentAction(admin, path, { action: "publish" });

    const recs = await recommendFor({ id: source, typeId: await typeId(db, "article") }, 6);
    const at = (id: string) => recs.findIndex((r) => r.id === id);
    expect(at(sibling)).toBeGreaterThan(-1);
    expect(at(sibling)).toBeLessThan(at(tagOnly));
    expect(recs[at(sibling)]!.reasons).toContain("Same collection");
  });
});

describe("Start here", () => {
  it("asks what you are preparing for, explains how to use the site, and ends with the owner's note", async () => {
    await publishPage("start-here");
    const html = await render(await StartHerePage());
    expect(html).toContain("What are you preparing for?");
    expect(html).toContain("How to use SparkTime");
    expect(html).toContain("A note from me");
    // No course or interview page is published, so no goal is offered that would lead nowhere.
    expect(html).not.toContain("Get my first tech job");
    expect(html).not.toContain("Prepare for a specific company");
    expect(count(html, "<h1")).toBe(1);
    expect(skippedLevels(html)).toEqual([]);
  });

  it("offers a goal only when its course is published, with the course's own lesson count", async () => {
    const lessons = [await make("article", "Lesson 1: Start here"), await make("article", "Lesson 2: Next")];
    const { id: course } = await createDocument(admin, { typeId: await typeId(db, "course"), title: "Java From Zero to Job-Ready: A Practical Path" });
    await saveDocument(admin, course, { body: { content: docOf(paragraph("A course.")), excerpt: "Why Java." } });
    await setCollectionItems(admin, course, { items: lessons.map((documentId) => ({ documentId, groupLabel: "Module 1: Basics", note: "" })) });
    await runDocumentAction(admin, course, { action: "publish" });
    const goals = await getStartGoals();
    expect(goals).toEqual([expect.objectContaining({ n: "01", goal: "Become a Java backend developer", path: "Java From Zero to Job-Ready · 2 lessons", href: "/course/java-from-zero-to-job-ready-a-practical-path" })]);
  });
});


