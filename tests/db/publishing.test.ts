import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IndexList } from "@/components/pages/library-view";
import { DocumentView } from "@/components/templates/document-view";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import { feedItems, sitemapEntries } from "@/server/seo/discovery";
import { documentMetadata } from "@/server/seo/metadata";
import { runBulkChunk, undoBulkOperation } from "@/server/services/content-ops";
import { loadDocumentPage } from "@/server/services/document-page";
import { createDocument, runDocumentAction, saveDocument } from "@/server/services/documents";
import { getDocumentByTypeAndSlug, listPublished } from "@/server/services/public-content";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

/**
 * Publishing redesign (docs/content-publishing-redesign.md): readers see no
 * publication dates, machines still get every one of them, and indexing can
 * be changed in bulk like visibility.
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

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

async function html(node: React.ReactElement): Promise<string> {
  const { prelude } = await prerenderToNodeStream(node);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out;
}
const visible = (h: string) => h.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "").replace(/<!-- -->/g, "");

/** A published article first published on 15 March 2023 and meaningfully revised on 2 August 2025 (an existing, dated piece). */
async function datedArticle(title: string) {
  const { id } = await createDocument(admin, { typeId: await typeId(db, "article"), title });
  await saveDocument(admin, id, { body: { content: docOf(paragraph(words(900))), excerpt: `${title} excerpt` } });
  await runDocumentAction(admin, id, { action: "publish" });
  await db.update(documents).set({ publishedAt: new Date("2023-03-15T09:00:00Z"), modifiedAt: new Date("2025-08-02T09:00:00Z") }).where(eq(documents.id, id));
  const [row] = await db.select({ slug: documents.slug }).from(documents).where(eq(documents.id, id));
  return { id, slug: row!.slug };
}

const DATE_TEXT = /\b2023\b|\b2025\b|Mar(ch)?\b|Aug(ust)?\b|<time/;

describe("public dates", () => {
  it("an existing dated article shows author and reading time, never its dates", async () => {
    const { slug } = await datedArticle("A dated piece");
    const doc = (await getDocumentByTypeAndSlug("article", slug))!;
    const data = await loadDocumentPage(doc);
    const page = visible(await html(createElement(DocumentView, { data })));
    expect(page).toContain("A dated piece");
    expect(page).toMatch(/\d+ min read/);
    expect(page).not.toMatch(DATE_TEXT);
    expect(page).not.toMatch(/Updated/);

    // Structured data, Open Graph, the sitemap and RSS keep the real dates.
    expect(JSON.stringify(data.jsonLd)).toContain('"datePublished":"2023-03-15T09:00:00.000Z"');
    expect(JSON.stringify(data.jsonLd)).toContain('"dateModified":"2025-08-02T09:00:00.000Z"');
    const meta = await documentMetadata(doc);
    expect(meta.openGraph).toMatchObject({ publishedTime: "2023-03-15T09:00:00.000Z", modifiedTime: "2025-08-02T09:00:00.000Z" });
    const entry = (await sitemapEntries()).find((e) => e.url.endsWith(`/article/${slug}`));
    expect(new Date(entry!.lastModified as Date).toISOString()).toBe("2025-08-02T09:00:00.000Z");
    const item = (await feedItems()).find((i) => i.url.endsWith(`/article/${slug}`));
    expect(item!.publishedAt.toISOString()).toBe("2023-03-15T09:00:00.000Z");
  });

  it("index rows put reading time in the margin, never a date or an internal format name", async () => {
    await datedArticle("Another dated piece");
    const { items } = await listPublished({ limit: 5 });
    const list = visible(await html(createElement(IndexList, { items })));
    expect(list).toMatch(/\d+ min read/);
    expect(list).not.toMatch(DATE_TEXT);
    expect(list).not.toMatch(/>Article</);
  });
});

describe("bulk indexing", () => {
  it("changes search engine indexing for a selection, reported and undoable", async () => {
    const a = await datedArticle("Index me not");
    const b = await datedArticle("Already noindex");
    await db.update(documents).set({ robotsIndex: "noindex" }).where(eq(documents.id, b.id));
    const operationId = randomUUID();
    const result = await runBulkChunk(admin, { operationId, ids: [a.id, b.id], action: { action: "indexing", value: "noindex" } });
    expect(result).toMatchObject({ updated: 1, unchanged: 1, undoable: true, affectsPublic: true });
    const robots = async (id: string) => (await db.select({ r: documents.robotsIndex }).from(documents).where(eq(documents.id, id)))[0]!.r;
    expect(await robots(a.id)).toBe("noindex");
    await expect(runBulkChunk(admin, { operationId: randomUUID(), ids: [a.id], action: { action: "indexing", value: "maybe" } })).rejects.toMatchObject({ code: "invalid" });
    const undone = await undoBulkOperation(admin, { operationId });
    expect(undone.reverted).toBe(1);
    expect([await robots(a.id), await robots(b.id)]).toEqual(["default", "noindex"]);
  });
});
