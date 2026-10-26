import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PUBLIC_ACTOR, type AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { categories, collectionItems, documentCategories, documentRelations, documents, media, redirects } from "@/server/db/schema";
import { contentHealthReport, HEALTH_CHECKS, type HealthCheck } from "@/server/services/content-health";
import { runBulkChunk } from "@/server/services/content-ops";
import { createDocument, getDocumentForEdit, listDocuments, runDocumentAction, saveDocument } from "@/server/services/documents";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

/**
 * Every Content Health rule against deterministic fixtures: one document that
 * must be flagged and one that must not. The seeded sample documents are
 * removed first, so the fixtures are the whole library.
 */

const ORIGIN = "https://karthikeyan.example";
let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;
let articleType: string;
let noteType: string;
let collectionType: string;
const fx: Record<string, string> = {};

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const link = (href: string, text = "a link") => ({ type: "paragraph", content: [{ type: "text", text, marks: [{ type: "link", attrs: { href } }] }] });

async function make(title: string, options: { type?: string; body?: unknown[]; excerpt?: string; publish?: boolean; status?: "idea" | "draft" } = {}) {
  const { id } = await createDocument(admin, { typeId: options.type ?? articleType, title, status: options.status ?? "draft" });
  const doc = await getDocumentForEdit(admin, id);
  await saveDocument(admin, id, { expectedVersion: doc.version, body: { content: docOf(...(options.body ?? [paragraph(words(400))])), excerpt: options.excerpt ?? `${title} excerpt` } });
  if (options.publish) await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  // Keep the seeded formats and topics, drop the seeded sample documents: the fixtures below are the whole library.
  await db.delete(documents);
  admin = await createAdmin(db);
  articleType = await typeId(db, "article");
  noteType = await typeId(db, "note");
  collectionType = await typeId(db, "collection");
  const [topic] = await db.insert(categories).values({ name: "Health topic", slug: "health-topic" }).returning();

  // A healthy published piece: long, described, has a topic, linked from another published piece.
  fx.healthy = await make("Healthy piece", { publish: true });
  fx.linker = await make("Healthy linker", { publish: true, body: [paragraph(words(400)), link(`/article/healthy-piece`)] });
  for (const id of [fx.healthy, fx.linker]) await db.insert(documentCategories).values({ documentId: id, categoryId: topic!.id, isPrimary: true });
  await db.insert(documentRelations).values({ sourceId: fx.healthy, targetId: fx.linker, kind: "related", origin: "manual" });

  fx.placeholder = await make("Placeholder piece", { body: [paragraph("[TODO] write the intro"), paragraph(words(10))] });
  fx.placeholderInCode = await make("Placeholder in code", { body: [{ type: "codeBlock", content: [{ type: "text", text: "const a = '[TODO]'" }] }, paragraph(words(10))] });
  fx.empty = await make("Empty piece", { body: [] });
  fx.emptyIdea = await make("Empty idea", { body: [], status: "idea" });
  fx.emptyCollection = await make("Empty collection", { type: collectionType, body: [] });
  fx.imageOnly = await make("Image only", { body: [{ type: "image", attrs: { src: "https://cdn.example/x.webp", alt: "x" } }] });
  fx.thin = await make("Thin piece", { publish: true, body: [paragraph(words(120))] });
  fx.shortNote = await make("Short note", { type: noteType, publish: true, body: [paragraph(words(40))] });
  fx.dupA = await make("Same Title");
  fx.dupB = await make("same title ");
  fx.stale = await make("Stale piece", { publish: true });
  await db.update(documents).set({ publishedAt: new Date("2023-01-01"), modifiedAt: null, createdAt: new Date("2023-01-01") }).where(eq(documents.id, fx.stale));
  fx.noDescription = await make("No description piece", { publish: true, excerpt: "" });
  fx.noindex = await make("Noindex piece", { publish: true });
  await db.update(documents).set({ robotsIndex: "noindex" }).where(eq(documents.id, fx.noindex));

  const [asset] = await db.insert(media).values({ kind: "image", storageKey: `media/2026/10/${randomUUID()}.webp`, mimeType: "image/webp", sizeBytes: 10 }).returning();
  fx.withImage = await make("With image", { publish: true, body: [paragraph(words(400)), { type: "image", attrs: { src: "https://cdn.example/y.webp", mediaId: asset!.id, alt: "y" } }] });
  await db.update(documents).set({ featuredMediaId: asset!.id }).where(eq(documents.id, fx.withImage));
  fx.missingMedia = await make("Missing media", { body: [paragraph(words(5)), { type: "image", attrs: { src: "https://cdn.example/z.webp", mediaId: randomUUID(), alt: "z" } }] });

  fx.unpublishedTarget = await make("Unpublished target");
  fx.brokenToDraft = await make("Links to a draft", { publish: true, body: [paragraph(words(400)), link("/article/unpublished-target")] });
  fx.brokenAbsolute = await make("Absolute broken", { publish: true, body: [paragraph(words(400)), link(`${ORIGIN}/article/never-existed?x=1#y`)] });
  fx.redirected = await make("Links via redirect", { publish: true, body: [paragraph(words(400)), link("/article/old-name")] });
  await db.insert(redirects).values({ fromPath: "/article/old-name", toPath: "/article/healthy-piece" });
  fx.external = await make("External link", { publish: true, body: [paragraph(words(400)), link("https://other.example/article/nope")] });

  fx.inCollection = await make("In a collection", { publish: true });
  const course = await make("A course", { type: collectionType, publish: true, body: [paragraph(words(30))] });
  await db.insert(collectionItems).values({ collectionId: course, documentId: fx.inCollection, position: 0 });
});
afterAll(() => ctx.close());

async function flagged(check: HealthCheck): Promise<Set<string>> {
  const { items } = await listDocuments(admin, { health: check, limit: 200 });
  return new Set(items.map((i) => i.id));
}

describe("content health rules", () => {
  it.each<[HealthCheck, string[], string[]]>([
    ["placeholder", ["placeholder"], ["healthy", "placeholderInCode"]],
    ["empty", ["empty"], ["emptyIdea", "emptyCollection", "imageOnly", "healthy"]],
    ["thin", ["thin"], ["shortNote", "healthy"]],
    ["duplicate-title", ["dupA", "dupB"], ["healthy"]],
    ["stale", ["stale"], ["healthy"]],
    ["no-description", ["noDescription"], ["healthy"]],
    ["noindex", ["noindex"], ["healthy"]],
    ["no-image", ["healthy"], ["withImage"]],
    ["broken-links", ["brokenToDraft", "brokenAbsolute"], ["linker", "redirected", "external"]],
    ["orphan", ["thin", "stale"], ["healthy", "linker", "inCollection"]],
    ["no-topic", ["thin"], ["healthy"]],
    ["missing-media", ["missingMedia"], ["withImage", "healthy"]],
  ])("%s flags its fixtures and nothing it shouldn't", async (check, yes, no) => {
    const ids = await flagged(check);
    for (const key of yes) expect(ids, `${check} should flag ${key}`).toContain(fx[key]);
    for (const key of no) expect(ids, `${check} should not flag ${key}`).not.toContain(fx[key]);
  });

  it("every check's count equals the size of the list it opens", async () => {
    const report = await contentHealthReport(admin);
    expect(report.checks.map((c) => c.key).sort()).toEqual(Object.keys(HEALTH_CHECKS).sort());
    for (const check of report.checks) expect(check.count, check.key).toBe((await listDocuments(admin, { health: check.key })).total);
  });

  it("ignores the Trash", async () => {
    await runBulkChunk(admin, { operationId: randomUUID(), ids: [fx.dupB], action: { action: "trash" } });
    expect(await flagged("duplicate-title")).not.toContain(fx.dupA);
    await runBulkChunk(admin, { operationId: randomUUID(), ids: [fx.dupB], action: { action: "restore" } });
  });

  it("reports unused, unpublished and near-duplicate taxonomy", async () => {
    await db.insert(categories).values([
      { name: "Node.js", slug: "nodejs" },
      { name: "NodeJS", slug: "node-js-2" },
    ]);
    const report = await contentHealthReport(admin);
    expect(report.taxonomy.duplicateTopics).toEqual([expect.objectContaining({ names: expect.arrayContaining(["Node.js", "NodeJS"]) })]);
    expect(report.taxonomy.unusedTopics.map((t) => t.name)).toEqual(expect.arrayContaining(["Node.js", "NodeJS"]));
    expect(report.taxonomy.unusedTopics.map((t) => t.name)).not.toContain("Health topic");
  });

  it("is diagnostic only: computing it changes nothing", async () => {
    const fingerprint = async () => (await db.execute(sql`select md5(string_agg(id::text || version || status || updated_at::text, ',' order by id)) as f from studio.documents`)) as unknown;
    const before = JSON.stringify(await fingerprint());
    await contentHealthReport(admin);
    for (const key of Object.keys(HEALTH_CHECKS) as HealthCheck[]) await listDocuments(admin, { health: key });
    expect(JSON.stringify(await fingerprint())).toBe(before);
  });

  it("is owner-only", async () => {
    await expect(contentHealthReport(PUBLIC_ACTOR)).rejects.toMatchObject({ code: "forbidden" });
  });
});
