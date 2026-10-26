import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { categories, documents, tags } from "@/server/db/schema";
import { setStorageForTesting, type MediaStorage } from "@/server/media/storage";
import { runImportJob, uploadImportAsset } from "@/server/services/import/execute";
import { analyzeImportJob, approveImportJob, createImportJob, stageImportFiles } from "@/server/services/import/jobs";
import { setDocumentRelations } from "@/server/services/documents";
import { exportManifest, exportPage, exportSummary, type ExportRequest } from "@/server/services/portable-export";
import { createAdmin, createTestDb, typeId } from "../helpers/db";

class MemoryStorage implements MediaStorage {
  readonly driver = "local" as const;
  objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer) {
    this.objects.set(key, body);
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  urlFor(key: string) {
    return `/media/${key}`;
  }
}

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;

/** Every marker below belongs to a document that is NOT public and listed. */
const HIDDEN = /zzhide|zznote/i;

async function img(seed: number) {
  return sharp({ create: { width: 30 + seed, height: 20, channels: 3, background: { r: seed * 7, g: 40, b: 90 } } }).png().toBuffer();
}

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
  setStorageForTesting(new MemoryStorage());
  const ok = await img(1);
  const secret = await img(2);
  const files: Record<string, string | Buffer> = {
    "pub/public-one.md": "---\ntags: [openclub]\n---\nVisible text. [more](../zzhide-topic/zzhide-draft.md) and [unlisted](../zzhide-topic/zzhide-unlisted.md).\n\n![ok](pic-ok.png)",
    "pub/pic-ok.png": ok,
    "zzhide-topic/zzhide-draft.md": "---\ntags: [zzhide-tag]\nexcerpt: ZZHIDE excerpt\nseoTitle: ZZHIDE seo\naudience: ZZHIDE audience\n---\nZZHIDE body",
    "zzhide-topic/zzhide-unlisted.md": "ZZHIDE unlisted body",
    "zzhide-topic/zzhide-private.md": "ZZHIDE private body\n\n![s](zzhide-private-pic.png)",
    "zzhide-topic/zzhide-private-pic.png": secret,
    "zzhide-topic/zzhide-idea.md": "ZZHIDE idea body",
    "zzhide-topic/zzhide-archived.md": "ZZHIDE archived body",
    "course/README.md": "# Public Course\n\nIntro.",
    "course/01-lesson-pub.md": "# Lesson pub\n\nOpen lesson.",
    "course/02-zzhide-lesson.md": "# ZZHIDE lesson\n\nHidden lesson.",
  };
  const { id } = await createImportJob(admin, { sourceName: "leak fixture" });
  await stageImportFiles(admin, id, {
    files: Object.entries(files).map(([path, c]) =>
      typeof c === "string" ? { path, size: c.length, text: c } : { path, size: c.length, sha256: createHash("sha256").update(c).digest("hex"), head: c.subarray(0, 64).toString("base64") },
    ),
  });
  const plan = await analyzeImportJob(admin, id, {});
  if (plan.decisionsRequired.length) throw new Error("decisions required");
  await approveImportJob(admin, id, { hash: plan.hash });
  for (let i = 0; i < 50; i++) {
    const r = await runImportJob(admin, id);
    for (const need of r.needsAssets) await uploadImportAsset(admin, id, need.key, { bytes: files[Object.keys(files).find((k) => k.endsWith(need.path))!] as Buffer, declaredType: "" });
    if (!r.needsAssets.length && r.status !== "running") break;
  }
  const set = async (slug: string, patch: Partial<typeof documents.$inferInsert>) => db.update(documents).set({ notes: `ZZNOTE-${slug}`, ...patch }).where(eq(documents.slug, slug));
  await set("public-one", { status: "published", visibility: "public", publishedAt: new Date() });
  await set("public-course", { status: "published", visibility: "public", publishedAt: new Date() });
  await set("lesson-pub", { status: "published", visibility: "public", publishedAt: new Date() });
  await set("zzhide-draft", {});
  await set("zzhide-unlisted", { status: "published", visibility: "unlisted", publishedAt: new Date() });
  await set("zzhide-private", { status: "published", visibility: "private", publishedAt: new Date() });
  await set("zzhide-idea", { status: "idea" });
  await set("zzhide-archived", { status: "archived", visibility: "public" });
  await set("zzhide-lesson", {});
  const [one] = await db.select().from(documents).where(eq(documents.slug, "public-one"));
  const [draft] = await db.select().from(documents).where(eq(documents.slug, "zzhide-draft"));
  await setDocumentRelations(admin, one!.id, { relations: [{ targetId: draft!.id, kind: "expands_on", note: "ZZHIDE relation note" }] });
});
afterAll(async () => {
  setStorageForTesting(null);
  await ctx.close();
});

const FORMATS = ["portable", "markdown", "manifest", "media"] as const;

/** The slugs that ARE public and listed, read from the database (the seeded site has public pages too). */
async function publicSlugs(): Promise<string[]> {
  const rows = await db.select({ slug: documents.slug }).from(documents).where(and(eq(documents.status, "published"), eq(documents.visibility, "public")));
  return rows.map((r) => r.slug).sort();
}

/** Everything an export would put in front of the user, as one string. */
async function everything(req: Omit<ExportRequest, "page">): Promise<{ text: string; docs: string[]; assets: number } | { error: string }> {
  try {
    const summary = await exportSummary(admin, req);
    const head = await exportManifest(admin, req);
    let text = JSON.stringify([summary, head]);
    for (let page = 0; page < head.summary.pages; page++) text += JSON.stringify(await exportPage(admin, { ...req, page }));
    return { text, docs: head.manifest.documents.map((d) => d.slug).sort(), assets: head.manifest.assets.length };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

describe("published-only exports never contain non-public data", () => {
  it("controls: a full export does contain the hidden markers (the scan can see them)", async () => {
    const full = await everything({ scope: { kind: "all" }, format: "portable", includePrivate: true });
    if ("error" in full) throw new Error(full.error);
    expect(full.text).toMatch(/zzhide/i);
    expect(full.text).toMatch(/zznote/i);
    expect(full.docs).toEqual(expect.arrayContaining(["zzhide-draft", "zzhide-unlisted", "zzhide-private", "zzhide-idea", "zzhide-archived", "zzhide-lesson"]));
  });

  it("includes exactly the public, listed documents for the whole site", async () => {
    const res = await everything({ scope: { kind: "all" }, format: "portable", includePrivate: false });
    if ("error" in res) throw new Error(res.error);
    const expected = await publicSlugs();
    expect(expected).toEqual(expect.arrayContaining(["lesson-pub", "public-course", "public-one"]));
    expect(res.docs).toEqual(expected);
    expect(res.docs.some((slug) => HIDDEN.test(slug))).toBe(false);
    expect(res.text).not.toMatch(HIDDEN);
    expect(res.assets).toBe(1); // only the picture used by a public document
  });

  it("omits media used only by non-public documents, even for a media-only export of the whole site", async () => {
    const res = await everything({ scope: { kind: "all" }, format: "media", includePrivate: false });
    if ("error" in res) throw new Error(res.error);
    expect(res.assets).toBe(1);
    expect(res.text).not.toMatch(HIDDEN);
  });

  it("holds for every scope × every format", async () => {
    const allDocs = (await db.select({ id: documents.id }).from(documents)).map((d) => d.id);
    const articleType = await typeId(db, "article");
    const courseType = await typeId(db, "course");
    const topicIds = (await db.select({ id: categories.id }).from(categories)).map((c) => c.id);
    const tagIds = (await db.select({ id: tags.id }).from(tags)).map((t) => t.id);
    const [course] = await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, "public-course"));
    const scopes: Array<ExportRequest["scope"]> = [
      { kind: "all" },
      { kind: "documents", ids: allDocs },
      { kind: "types", ids: [articleType, courseType] },
      { kind: "topics", ids: topicIds, includeSubtopics: true },
      { kind: "tags", ids: tagIds },
      { kind: "collections", ids: [course!.id] },
    ];
    const publicSet = new Set(await publicSlugs());
    let checked = 0;
    for (const scope of scopes) {
      for (const format of FORMATS) {
        const res = await everything({ scope, format, includePrivate: false });
        const label = `${scope.kind} × ${format}`;
        const text = "error" in res ? res.error : res.text;
        expect(text, label).not.toMatch(HIDDEN);
        if (!("error" in res) && format !== "media") expect(res.docs.every((slug) => publicSet.has(slug)), label).toBe(true);
        checked++;
      }
    }
    expect(checked).toBe(24);
  });

  it("drops links to hidden documents but keeps their text, and links between public documents work", async () => {
    const head = await exportManifest(admin, { scope: { kind: "documents", ids: (await db.select({ id: documents.id }).from(documents)).map((d) => d.id) }, format: "portable", includePrivate: false });
    const page = await exportPage(admin, { scope: { kind: "all" }, format: "portable", includePrivate: false, page: 0 });
    const md = page.files.find((f) => f.path.endsWith("public-one.md"))!.text;
    const docJson = page.files.find((f) => f.path.endsWith("public-one.doc.json"))!.text;
    expect(md).toContain("more");
    expect(md).toContain("unlisted");
    expect(md).not.toMatch(/\]\([^)]*zzhide/i);
    expect(docJson).not.toMatch(/zzhide/i);
    expect(head.manifest.excludedReferences.every((e) => e.kind === "media" || e.target === "(not public)")).toBe(true);
    expect(head.manifest.documents.find((d) => d.slug === "public-one")!.notes).toBe("");
  });
});
