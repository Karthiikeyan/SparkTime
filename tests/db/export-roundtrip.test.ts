import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BlockNode, Doc } from "@/lib/content/blocks";
import { assemblePackage, type ExportFormat } from "@/lib/portability/assemble";
import { fileKind, isTextKind } from "@/lib/portability/paths";
import { concatChunks, extractZipEntry, readZipEntries, sourceFromBytes } from "@/lib/portability/zip";
import { PUBLIC_ACTOR, type AdminActor } from "@/server/auth/actor";
import { categories, documents, tags } from "@/server/db/schema";
import { setStorageForTesting, type MediaStorage } from "@/server/media/storage";
import { nodeDeflateRaw, nodeInflateRaw } from "@/server/portability/zip-node";
import { getDocumentForEdit, runDocumentAction, saveDocument, setDocumentRelations } from "@/server/services/documents";
import { runImportJob, uploadImportAsset } from "@/server/services/import/execute";
import { analyzeImportJob, approveImportJob, createImportJob, stageImportFiles } from "@/server/services/import/jobs";
import { exportAsset, exportManifest, exportPage, exportSummary, type ExportRequest } from "@/server/services/portable-export";
import { createAdmin, createTestDb } from "../helpers/db";

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

type Source = Record<string, string | Buffer>;

async function importFiles(actor: AdminActor, files: Source, decisions: Record<string, unknown> = {}) {
  const { id } = await createImportJob(actor, { sourceName: "fixture" });
  await stageImportFiles(actor, id, {
    files: Object.entries(files).map(([path, content]) =>
      typeof content === "string" ? { path, size: content.length, text: content } : { path, size: content.length, sha256: createHash("sha256").update(content).digest("hex"), head: content.subarray(0, 64).toString("base64") },
    ),
  });
  const plan = await analyzeImportJob(actor, id, { decisions });
  if (plan.decisionsRequired.length) throw new Error(`decisions required: ${plan.decisionsRequired.map((d) => d.message).join("; ")}`);
  await approveImportJob(actor, id, { hash: plan.hash });
  for (let i = 0; i < 100; i++) {
    const r = await runImportJob(actor, id);
    if (r.needsAssets.length) {
      for (const need of r.needsAssets) await uploadImportAsset(actor, id, need.key, { bytes: files[Object.keys(files).find((k) => k.endsWith(need.path))!] as Buffer, declaredType: "" });
      continue;
    }
    if (r.status !== "running") return { id, plan, status: r.status };
  }
  throw new Error("import did not finish");
}

async function exportZip(actor: AdminActor, request: Omit<ExportRequest, "page">) {
  const result = await assemblePackage({
    format: request.format as ExportFormat,
    fetchManifest: () => exportManifest(actor, request),
    fetchPage: async (page) => exportPage(actor, { ...request, page }),
    fetchAsset: async (id) => new Uint8Array((await exportAsset(actor, id)).bytes),
    deflate: nodeDeflateRaw,
  });
  return { ...result, bytes: concatChunks(result.chunks) };
}

async function unzip(bytes: Uint8Array): Promise<Source> {
  const source = sourceFromBytes(bytes);
  const out: Source = {};
  for (const entry of await readZipEntries(source)) {
    const data = await extractZipEntry(source, entry, nodeInflateRaw);
    out[entry.name] = isTextKind(fileKind(entry.name)) ? new TextDecoder().decode(data) : Buffer.from(data);
  }
  return out;
}

/** Body without database ids and storage URLs, for semantic comparison. */
function semanticBody(doc: Doc, titleById: (id: string) => string): unknown {
  const strip = (node: BlockNode): unknown => {
    const attrs = { ...(node.attrs ?? {}) };
    if ("mediaId" in attrs) attrs.mediaId = attrs.mediaId ? "media" : null;
    if (typeof attrs.src === "string") attrs.src = attrs.src.startsWith("/media/") ? "stored-media" : attrs.src;
    if (node.type === "docRef") attrs.documentId = titleById(String(attrs.documentId));
    const marks = node.marks?.map((m) => (m.type === "link" ? { type: "link", href: m.attrs?.href?.replace(/\/[^/]+-?[^/]*$/, "/…") } : m));
    return { type: node.type, attrs: Object.keys(attrs).length ? attrs : undefined, text: node.text, marks, content: node.content?.map(strip) };
  };
  return doc.content.map(strip);
}

let png: Buffer;
let exported: Awaited<ReturnType<typeof exportZip>>;
let original: Map<string, Awaited<ReturnType<typeof getDocumentForEdit>>>;
const FIXTURE_SLUGS = ["java-from-zero", "basics", "objects", "salary-guide", "notice-period"];

const fixture = (): Source => ({
  "fixture/README.md": "# Fixture",
  "fixture/career/salary-guide.md": "---\ntitle: Salary Guide\nexcerpt: How pay works.\nseoTitle: Salary guide SEO\ntags: [salary, CTC]\naudience: Freshers\ndifficulty: beginner\nlastReviewed: October 2026\n---\nRead the [notice guide](notice-period.md).\n\n> [!TIP]\n> Negotiate.",
  "fixture/career/notice-period.md": "---\ntitle: Notice Period\ntags: [career]\n---\n| a | b |\n|---|---|\n| 1 | 2 |",
  "fixture/learning/java/README.md": "---\ntitle: Java from zero\ndescription: A short course.\n---\nWelcome.",
  "fixture/learning/java/01-basics.md": "# Basics\n\n![flow](img/flow.png)\n\n```java\nclass A {}\n```",
  "fixture/learning/java/02-objects.md": "# Objects\n\nAfter [basics](01-basics.md).",
  "fixture/learning/java/img/flow.png": png,
});

describe("portable export → import into a separate database → re-export", () => {
  let db1: Awaited<ReturnType<typeof createTestDb>>;
  let admin1: AdminActor;

  beforeAll(async () => {
    png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 50, b: 50 } } }).png().toBuffer();
    db1 = await createTestDb({ seed: true });
    admin1 = await createAdmin(db1.db);
    setStorageForTesting(new MemoryStorage());
    const run = await importFiles(admin1, fixture());
    expect(run.status).toBe("completed");
    const bySlug = async (slug: string) => (await db1.db.select().from(documents).where(eq(documents.slug, slug)))[0]!;
    const salary = await bySlug("salary-guide");
    const notice = await bySlug("notice-period");
    // A curated relation, a mention, and a published document.
    await setDocumentRelations(admin1, salary.id, { relations: [{ targetId: notice.id, kind: "expands_on", note: "deeper" }] });
    const content = (await getDocumentForEdit(admin1, notice.id)).content;
    await saveDocument(admin1, notice.id, { body: { content: { ...content, content: [...content.content, { type: "paragraph", content: [{ type: "docRef", attrs: { documentId: salary.id, label: "Salary Guide" } }] }] } } });
    await saveDocument(admin1, salary.id, { settings: { visibility: "public" } });
    await runDocumentAction(admin1, salary.id, { action: "publish" });

    original = new Map();
    for (const slug of FIXTURE_SLUGS) original.set(slug, await getDocumentForEdit(admin1, (await bySlug(slug)).id));
    exported = await exportZip(admin1, { scope: { kind: "all" }, format: "portable", includePrivate: true });
    await db1.close();
  });

  it("produces a valid, self-contained package", async () => {
    const files = await unzip(exported.bytes);
    const manifest = JSON.parse(files["manifest.json"] as string);
    expect(manifest).toMatchObject({ format: "studio-portable", schemaVersion: 1 });
    const salary = manifest.documents.find((d: { slug: string }) => d.slug === "salary-guide");
    expect(salary.pid).toBe("path:fixture/career/salary-guide.md");
    expect(salary.unmapped).toMatchObject({ lastReviewed: "October 2026" });
    expect(files[salary.body.markdown]).toContain("title: \"Salary Guide\"");
    expect(files[salary.body.doc]).toBeDefined();
    const asset = manifest.assets[0];
    expect(asset.sha256).toBe(createHash("sha256").update(files[asset.path] as Buffer).digest("hex"));
    // No production storage URLs or database ids are needed to read the package.
    expect(files[salary.body.doc]).not.toMatch(/\/media\/media\//);
    expect(JSON.stringify(manifest.collections)).toContain("path:fixture/learning/java/");
    expect(manifest.relations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "expands_on", note: "deeper" })]));
  });

  it("imports into another site with metadata, taxonomy, order, relations and media intact", async () => {
    const db2 = await createTestDb({ seed: true });
    const admin2 = await createAdmin(db2.db);
    setStorageForTesting(new MemoryStorage());
    try {
      const files = await unzip(exported.bytes);
      // Seeded pages exist on both sites: skip those duplicates.
      const run = await importFiles(admin2, files, { duplicateAction: "skip" });
      expect(run.status).toBe("completed");
      const bySlug = async (slug: string) => (await db2.db.select().from(documents).where(eq(documents.slug, slug)))[0]!;
      const titleOf = (map: Map<string, string>) => (id: string) => map.get(id) ?? id;
      const ids1 = new Map([...original.values()].map((d) => [d.id, d.title]));
      const ids2 = new Map<string, string>();
      const imported = new Map<string, Awaited<ReturnType<typeof getDocumentForEdit>>>();
      for (const slug of FIXTURE_SLUGS) {
        const doc = await getDocumentForEdit(admin2, (await bySlug(slug)).id);
        imported.set(slug, doc);
        ids2.set(doc.id, doc.title);
      }
      for (const slug of FIXTURE_SLUGS) {
        const a = original.get(slug)!;
        const b = imported.get(slug)!;
        expect({ slug: b.slug, title: b.title, type: b.type.slug, excerpt: b.excerpt, seoTitle: b.seoTitle, properties: b.properties }).toEqual({ slug: a.slug, title: a.title, type: a.type.slug, excerpt: a.excerpt, seoTitle: a.seoTitle, properties: a.properties });
        expect(b.categories.map((c) => c.slug).sort()).toEqual(a.categories.map((c) => c.slug).sort());
        expect(b.tags.map((t) => t.name).sort()).toEqual(a.tags.map((t) => t.name).sort());
        expect(semanticBody(b.content, titleOf(ids2))).toEqual(semanticBody(a.content, titleOf(ids1)));
        // New site, a draft by default — even the document that was published. Never live until published.
        expect({ status: b.status, visibility: b.visibility }).toEqual({ status: "draft", visibility: "public" });
      }
      const course = imported.get("java-from-zero")!;
      expect(course.collectionItems.map((i) => i.document.slug)).toEqual(["basics", "objects"]);
      const salary = imported.get("salary-guide")!;
      expect(salary.relations.map((r) => [r.kind, r.target.slug, r.note])).toEqual([["expands_on", "notice-period", "deeper"]]);
      expect(imported.get("notice-period")!.backlinks.map((b) => b.source.slug)).toEqual(expect.arrayContaining(["salary-guide"]));
      const image = imported.get("basics")!.content.content.find((n) => n.type === "image")!;
      expect(String(image.attrs?.src)).toMatch(/^\/media\/media\//);

      // Re-export from the new site: same identities and the same semantic content.
      const again = await exportZip(admin2, { scope: { kind: "documents", ids: [...imported.values()].map((d) => d.id) }, format: "portable", includePrivate: true });
      const firstDocs = (JSON.parse((await unzip(exported.bytes))["manifest.json"] as string).documents as Array<{ pid: string; slug: string; title: string; topics: unknown[]; tags: unknown[] }>).filter((d) => FIXTURE_SLUGS.includes(d.slug));
      const secondDocs = again.manifest.documents;
      const pick = (d: { pid: string; slug: string; title: string; topics: unknown[]; tags: unknown[] }) => ({ pid: d.pid, slug: d.slug, title: d.title, topics: d.topics.length, tags: d.tags.length });
      expect(secondDocs.map(pick).sort((x, y) => x.slug.localeCompare(y.slug))).toEqual(firstDocs.map(pick).sort((x, y) => x.slug.localeCompare(y.slug)));

      // Importing the same package again finds everything by identity: nothing is duplicated.
      const before = (await db2.db.select().from(documents)).length;
      const { id } = await createImportJob(admin2, {});
      await stageImportFiles(admin2, id, { files: Object.entries(files).map(([path, c]) => (typeof c === "string" ? { path, size: c.length, text: c } : { path, size: c.length, sha256: createHash("sha256").update(c).digest("hex"), head: c.subarray(0, 64).toString("base64") })) });
      const replan = await analyzeImportJob(admin2, id, { decisions: { duplicateAction: "skip" } });
      expect(replan.summary.create).toBe(0);
      expect(replan.documents.filter((d) => FIXTURE_SLUGS.includes(d.slug)).every((d) => d.conflict?.reason === "identity")).toBe(true);
      expect((await db2.db.select().from(documents)).length).toBe(before);
    } finally {
      await db2.close();
    }
  });
});

describe("export scopes and formats", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let admin: AdminActor;
  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    admin = await createAdmin(db.db);
    setStorageForTesting(new MemoryStorage());
    png ??= await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer();
    await importFiles(admin, fixture());
  });
  afterAll(async () => {
    setStorageForTesting(null);
    await db.close();
  });

  it("requires an admin", async () => {
    await expect(exportSummary(PUBLIC_ACTOR, { scope: { kind: "all" }, format: "portable" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(exportManifest(PUBLIC_ACTOR, { scope: { kind: "all" }, format: "portable" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(exportAsset(PUBLIC_ACTOR, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("selects by topic (with sub-topics), tag and collection, and reports excluded references", async () => {
    const [career] = await db.db.select().from(categories).where(eq(categories.slug, "career"));
    const byTopic = await exportSummary(admin, { scope: { kind: "topics", ids: [career!.id] }, format: "portable" });
    expect(byTopic.documents).toBe(2);
    const [salaryTag] = await db.db.select().from(tags).where(eq(tags.slug, "salary"));
    const byTag = await exportManifest(admin, { scope: { kind: "tags", ids: [salaryTag!.id] }, format: "portable" });
    expect(byTag.manifest.documents.map((d) => d.slug)).toEqual(["salary-guide"]);
    // salary-guide links to notice-period, which is outside this export.
    expect(byTag.manifest.excludedReferences.length).toBeGreaterThan(0);
    const [course] = await db.db.select().from(documents).where(eq(documents.slug, "java-from-zero"));
    const byCollection = await exportManifest(admin, { scope: { kind: "collections", ids: [course!.id] }, format: "portable" });
    expect(byCollection.manifest.documents.map((d) => d.slug).sort()).toEqual(["basics", "java-from-zero", "objects"]);
    expect(byCollection.manifest.collections[0]!.items.map((i) => i.position)).toEqual([0, 1]);
  });

  it("can leave out private and draft content", async () => {
    const all = await exportSummary(admin, { scope: { kind: "all" }, format: "portable", includePrivate: true });
    expect(all.privateOrDraft).toBeGreaterThan(0);
    expect(all.warnings.join(" ")).toMatch(/private or unpublished/);
    const published = await exportManifest(admin, { scope: { kind: "all" }, format: "portable", includePrivate: false });
    expect(published.manifest.documents.every((d) => d.status === "published" && d.visibility !== "private")).toBe(true);
  });

  it("manifest-only exports carry metadata but no bodies or media", async () => {
    const pkg = await exportZip(admin, { scope: { kind: "all" }, format: "manifest", includePrivate: true });
    const files = await unzip(pkg.bytes);
    expect(Object.keys(files).sort()).toEqual(["README.md", "manifest.json"]);
    expect(pkg.manifest.contents).toEqual({ bodies: false, media: false });
    expect(pkg.manifest.documents.every((d) => d.body === null)).toBe(true);
  });

  it("media-only exports the media with checksums", async () => {
    const pkg = await exportZip(admin, { scope: { kind: "all" }, format: "media", includePrivate: true });
    const files = await unzip(pkg.bytes);
    expect(pkg.manifest.documents).toEqual([]);
    expect(pkg.manifest.assets).toHaveLength(1);
    expect(Object.keys(files)).toContain(pkg.manifest.assets[0]!.path);
    expect(pkg.manifest.assets[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Markdown exports are readable folders that re-import into the same structure", async () => {
    const [course] = await db.db.select().from(documents).where(eq(documents.slug, "java-from-zero"));
    const pkg = await exportZip(admin, { scope: { kind: "collections", ids: [course!.id] }, format: "markdown", includePrivate: true });
    const files = await unzip(pkg.bytes);
    const paths = Object.keys(files).sort();
    expect(paths).toEqual(expect.arrayContaining(["EXPORT.md", "learning/java-from-zero/README.md", "learning/java-from-zero/01-basics.md", "learning/java-from-zero/02-objects.md"]));
    const basics = files["learning/java-from-zero/01-basics.md"] as string;
    expect(basics).toMatch(/!\[flow\]\(\.\.\/\.\.\/media\/flow-[0-9a-f]{8}\.webp\)/);
    expect(files["learning/java-from-zero/02-objects.md"]).toContain("](01-basics.md)");
    expect(files["learning/java-from-zero/README.md"]).toContain("collection: true");

    // Into a fresh site: the folder importer rebuilds the course, its order and the image.
    const fresh = await createTestDb({ seed: true });
    const freshAdmin = await createAdmin(fresh.db);
    setStorageForTesting(new MemoryStorage());
    try {
      const run = await importFiles(freshAdmin, files);
      expect(run.status).toBe("completed");
      const [rebuilt] = await fresh.db.select().from(documents).where(eq(documents.slug, "java-from-zero"));
      const doc = await getDocumentForEdit(freshAdmin, rebuilt!.id);
      expect(doc.type.slug).toBe("course");
      expect(doc.collectionItems.map((i) => i.document.slug)).toEqual(["basics", "objects"]);
      expect(doc.categories.map((c) => c.slug)).toEqual(["learning"]);
    } finally {
      await fresh.close();
      setStorageForTesting(new MemoryStorage());
    }
  });
});

describe("private editor notes", () => {
  it("are exported only when private content is included", async () => {
    const db = await createTestDb({ seed: true });
    const admin = await createAdmin(db.db);
    setStorageForTesting(new MemoryStorage());
    try {
      const run = await importFiles(admin, { "notes-test/public-piece.md": "Body of a piece" });
      expect(run.status).toBe("completed");
      const [row] = await db.db.select().from(documents).where(eq(documents.slug, "public-piece"));
      await saveDocument(admin, row!.id, { settings: { notes: "PRIVATE-NOTE-TEXT", visibility: "public" } });
      await runDocumentAction(admin, row!.id, { action: "publish" });
      const full = await exportManifest(admin, { scope: { kind: "all" }, format: "portable", includePrivate: true });
      const publicOnly = await exportManifest(admin, { scope: { kind: "all" }, format: "portable", includePrivate: false });
      expect(JSON.stringify(full.manifest)).toContain("PRIVATE-NOTE-TEXT");
      expect(publicOnly.manifest.documents.some((d) => d.slug === "public-piece")).toBe(true);
      expect(JSON.stringify(publicOnly.manifest)).not.toContain("PRIVATE-NOTE-TEXT");
      const page = await exportPage(admin, { scope: { kind: "all" }, format: "portable", includePrivate: false, page: 0 });
      expect(JSON.stringify(page.files)).not.toContain("PRIVATE-NOTE-TEXT");
    } finally {
      await db.close();
      setStorageForTesting(new MemoryStorage());
    }
  });
});
