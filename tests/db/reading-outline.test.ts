import { eq } from "drizzle-orm";
import { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SystemPage } from "@/components/pages/system-page";
import { DocumentView } from "@/components/templates/document-view";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import { loadDocumentPage } from "@/server/services/document-page";
import { createDocument, runDocumentAction, saveDocument } from "@/server/services/documents";
import { getDocumentByTypeAndSlug, getRootPage } from "@/server/services/public-content";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

/**
 * The "On this page" outline comes from the words themselves: every long,
 * sectioned reading page gets one — /now included — with nothing to set up in
 * the studio, and short pages, collections and videos stay quiet.
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

const heading = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const prose = (words: number) => paragraph(Array.from({ length: words }, (_, i) => `word${i}`).join(" "));

/** Written in the studio as "Heading 1" sections and "Heading 2" subsections. */
const LONG = [
  prose(40),
  heading(1, "What I'm Working On"),
  heading(2, "Building at Work"),
  prose(80),
  heading(2, "Application Modernization"),
  prose(80),
  heading(1, "What I'm Learning"),
  heading(2, "AWS & Cloud"),
  prose(80),
  heading(3, "Too fine for the outline"),
  prose(40),
  heading(1, "Currently Reading"),
  prose(120),
  heading(1, "Currently Reading"),
  prose(120),
  heading(1, "What I'm Figuring Out"),
  prose(120),
];

async function collect(element: React.ReactElement): Promise<string> {
  const { prelude } = await prerenderToNodeStream(element);
  let html = "";
  for await (const chunk of prelude) html += chunk.toString();
  return html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
}

/** Required fields, so each type can be published. */
const REQUIRED: Record<string, Record<string, unknown>> = {
  "book-review": { bookTitle: "Deep Work" },
  resource: { url: "https://tool.example" },
  video: { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" },
};

async function renderDocument(typeSlug: string, nodes: unknown[]): Promise<string> {
  const { id } = await createDocument(admin, { typeId: await typeId(db, typeSlug), title: `A ${typeSlug} ${Math.random().toString(36).slice(2, 8)}` });
  await saveDocument(admin, id, { body: { content: docOf(...nodes), properties: REQUIRED[typeSlug] ?? {} } });
  await runDocumentAction(admin, id, { action: "publish" });
  const [row] = await db.select({ slug: documents.slug }).from(documents).where(eq(documents.id, id));
  return collect(createElement(DocumentView, { data: await loadDocumentPage((await getDocumentByTypeAndSlug(typeSlug, row!.slug))!) }));
}

const hasOutline = (html: string) => html.includes('aria-label="On this page"');
const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
const outlineHrefs = (html: string) => {
  const rail = html.slice(html.indexOf("data-toc-scroll"));
  return [...rail.slice(0, rail.indexOf("</nav>")).matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!);
};

describe("/now", () => {
  let html: string;
  beforeAll(async () => {
    const [now] = await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, "now"));
    await saveDocument(admin, now!.id, { body: { content: docOf(...LONG), properties: {} } });
    await runDocumentAction(admin, now!.id, { action: "publish" });
    html = await collect(createElement(SystemPage, { doc: (await getRootPage("now"))!, eyebrow: "Now", showUpdated: true }));
  });

  it("gets the outline, built from its own headings", () => {
    expect(hasOutline(html)).toBe(true);
    expect(outlineHrefs(html)).toEqual(["what-i-m-working-on", "building-at-work", "application-modernization", "what-i-m-learning", "aws-and-cloud", "currently-reading", "currently-reading-2", "what-i-m-figuring-out"]);
    // Subsections are nested under their section.
    expect(html).toMatch(/href="#what-i-m-learning"[^>]*>What I&#x27;m Learning<\/a><ol class="pb-1"><li><a href="#aws-and-cloud"/);
  });

  it("points every entry at exactly one heading, and adds no headings of its own", () => {
    const all = ids(html);
    expect(new Set(all).size).toBe(all.length);
    for (const id of outlineHrefs(html)) expect(all).toContain(id);
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels).toEqual([1, 2, 3, 3, 2, 3, 4, 2, 2, 2]);
  });

  it("keeps the words in the page for readers and crawlers without JavaScript", () => {
    expect(html).toContain("word119");
    expect(html).toMatch(/<h2 id="currently-reading-2">Currently Reading<\/h2>/);
    expect(html).toContain('<a href="#what-i-m-figuring-out" class="heading-anchor" aria-label="Link to section: What I&#x27;m Figuring Out">#</a>');
  });

  it("stays quiet while /now is short", async () => {
    const [now] = await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, "now"));
    await saveDocument(admin, now!.id, { body: { content: docOf(prose(30), heading(1, "Building"), prose(40), heading(1, "Learning"), prose(40), heading(1, "Reading"), prose(40)), properties: {} } });
    await runDocumentAction(admin, now!.id, { action: "publish" });
    const short = await collect(createElement(SystemPage, { doc: (await getRootPage("now"))!, eyebrow: "Now" }));
    expect(hasOutline(short)).toBe(false);
    expect(short).not.toContain("reading-progress");
  });
});

describe("long reads of every kind share the outline", () => {
  for (const type of ["article", "guide", "book-review", "project", "journey", "experiment", "note"]) {
    it(`${type}: long and sectioned → outline`, async () => {
      const html = await renderDocument(type, LONG);
      expect(hasOutline(html), type).toBe(true);
      expect(outlineHrefs(html), type).toHaveLength(8);
      const all = ids(html);
      expect(new Set(all).size, type).toBe(all.length);
    });
  }

  it("a short note stays just the words", async () => {
    const html = await renderDocument("note", [prose(40), heading(1, "One thought"), prose(80)]);
    expect(hasOutline(html)).toBe(false);
    expect(html).not.toContain("data-toc");
  });

  it("collections, videos and resources never get one", async () => {
    for (const type of ["collection", "video", "resource"]) expect(hasOutline(await renderDocument(type, LONG)), type).toBe(false);
  });
});
