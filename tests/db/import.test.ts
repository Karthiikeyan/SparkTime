import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { and, count, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PUBLIC_ACTOR, type AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import {
  auditLogs,
  categories,
  collectionItems,
  documentCategories,
  documentRelations,
  documents,
  documentTags,
  importItems,
  importJobs,
  media,
  portableIdentities,
  tags,
} from "@/server/db/schema";
import { setStorageForTesting, type MediaStorage } from "@/server/media/storage";
import { getDocumentForEdit, saveDocument } from "@/server/services/documents";
import { controlImportJob, runImportJob, uploadImportAsset } from "@/server/services/import/execute";
import { analyzeImportJob, approveImportJob, createImportJob, getImportJob, importDocumentDetail, listImportJobs, stageImportFiles } from "@/server/services/import/jobs";
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

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;
let other: AdminActor;
let png: Buffer;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
  other = await createAdmin(db, { githubId: 999, githubLogin: "someone-else" });
  setStorageForTesting(new MemoryStorage());
  png = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
});
afterAll(async () => {
  setStorageForTesting(null);
  await ctx.close();
});

type Source = Record<string, string | Buffer>;

function stagedBody(files: Source) {
  return {
    files: Object.entries(files).map(([path, content]) =>
      typeof content === "string"
        ? { path, size: content.length, text: content }
        : { path, size: content.length, sha256: createHash("sha256").update(content).digest("hex"), head: content.subarray(0, 64).toString("base64") },
    ),
  };
}

async function newJob(files: Source, name = "test") {
  const { id } = await createImportJob(admin, { sourceName: name });
  await stageImportFiles(admin, id, stagedBody(files));
  return id;
}

/** Runs to completion, uploading media from `files` whenever the server asks. */
async function runToEnd(id: string, files: Source, actor = admin) {
  for (let i = 0; i < 200; i++) {
    const result = await runImportJob(actor, id);
    if (result.needsAssets.length) {
      for (const need of result.needsAssets) {
        const bytes = files[need.path] ?? files[Object.keys(files).find((k) => k.endsWith(need.path))!];
        await uploadImportAsset(actor, id, need.key, { bytes: bytes as Buffer, declaredType: "image/png" });
      }
      continue;
    }
    if (result.status !== "running") return result;
  }
  throw new Error("import did not finish");
}

async function contentCounts() {
  const n = async (table: typeof documents | typeof categories | typeof tags | typeof documentRelations | typeof collectionItems | typeof media) => Number((await db.select({ n: count() }).from(table))[0]!.n);
  return { documents: await n(documents), categories: await n(categories), tags: await n(tags), relations: await n(documentRelations), items: await n(collectionItems), media: await n(media) };
}

function loadArticles(): Source {
  const dir = join(process.cwd(), "articles");
  const out: Source = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[`articles/${relative(dir, full).replace(/\\/g, "/")}`] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

describe("authorization and ownership", () => {
  it("refuses every import operation without an admin actor", async () => {
    const id = await newJob({ "a.md": "# A" });
    const attempts: Array<() => Promise<unknown>> = [
      () => createImportJob(PUBLIC_ACTOR, {}),
      () => stageImportFiles(PUBLIC_ACTOR, id, stagedBody({ "b.md": "x" })),
      () => analyzeImportJob(PUBLIC_ACTOR, id, {}),
      () => approveImportJob(PUBLIC_ACTOR, id, { hash: "0".repeat(64) }),
      () => runImportJob(PUBLIC_ACTOR, id),
      () => getImportJob(PUBLIC_ACTOR, id),
      () => controlImportJob(PUBLIC_ACTOR, id, { action: "cancel" }),
      () => uploadImportAsset(PUBLIC_ACTOR, id, "x", { bytes: Buffer.from("x"), declaredType: "" }),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("hides one owner's imports from another admin (forged ids)", async () => {
    const id = await newJob({ "a.md": "# A" });
    await expect(getImportJob(other, id)).rejects.toMatchObject({ code: "not_found" });
    await expect(analyzeImportJob(other, id, {})).rejects.toMatchObject({ code: "not_found" });
    await expect(runImportJob(other, id)).rejects.toMatchObject({ code: "not_found" });
    expect((await listImportJobs(other)).items.find((j) => j.id === id)).toBeUndefined();
  });

  it("rejects unsafe paths on the server, whatever the browser sent", async () => {
    const { id } = await createImportJob(admin, {});
    const result = await stageImportFiles(admin, id, stagedBody({ "../../etc/passwd.md": "x", "/abs.md": "y", "ok.md": "z" }));
    expect(result.accepted).toBe(1);
    expect(result.skipped.map((s) => s.path)).toEqual(["../../etc/passwd.md", "/abs.md"]);
  });
});

describe("dry run and approval", () => {
  it("analysing writes no content, and approval needs the reviewed hash", async () => {
    const before = await contentCounts();
    const id = await newJob({ "notes/a.md": "---\ntags: [brand-new-tag]\n---\n# A", "notes/b.md": "# B" });
    const plan = await analyzeImportJob(admin, id, {});
    expect(plan.summary.create).toBe(2);
    expect(await contentCounts()).toEqual(before);
    await expect(runImportJob(admin, id)).resolves.toMatchObject({ status: "analyzed" });
    expect(await contentCounts()).toEqual(before);
    await expect(approveImportJob(admin, id, { hash: "f".repeat(64) })).rejects.toMatchObject({ code: "conflict" });
    expect(await contentCounts()).toEqual(before);
  });

  it("detects a stale preview when the site changed after analysis", async () => {
    const id = await newJob({ "stale/one.md": "# One" });
    const plan = await analyzeImportJob(admin, id, {});
    // Someone creates a tag in another tab: the destination fingerprint changes.
    await db.insert(tags).values({ name: "Interloper", slug: "interloper" });
    await expect(approveImportJob(admin, id, { hash: plan.hash })).rejects.toMatchObject({ code: "conflict", details: { stale: "true" } });
    const fresh = await getImportJob(admin, id);
    expect(fresh.planHash).not.toBe(plan.hash);
    await expect(approveImportJob(admin, id, { hash: fresh.planHash })).resolves.toMatchObject({ status: "running" });
    await runToEnd(id, {});
  });

  it("blocks approval while decisions are required", async () => {
    const id = await newJob({ "x/a.md": "---\ntype: podcast\n---\nA", "x/b.md": "B" });
    const plan = await analyzeImportJob(admin, id, {});
    expect(plan.decisionsRequired.length).toBeGreaterThan(0);
    await expect(approveImportJob(admin, id, { hash: plan.hash })).rejects.toMatchObject({ code: "invalid" });
  });
});

// articles/ is local content that is never committed, so this suite only runs where it exists.
const articlesPresent = existsSync(join(process.cwd(), "articles"));
// Read once: the folder can change while the suite runs, and every test must see the same batch.
const articleFiles: Source = articlesPresent ? loadArticles() : {};
const articleCount = Object.keys(articleFiles).filter((p) => p.endsWith(".md") && !/(^|\/)README\.md$/i.test(p)).length;

describe.skipIf(!articlesPresent)("importing the real articles/ batch", () => {
  let id: string;
  // The plan also adds documents of its own (e.g. a course overview per course folder), so the
  // exact total comes from the plan; it must still cover every article file.
  let planned = 0;
  it("creates every article as a draft with topics, tags and fields", async () => {
    const files = articleFiles;
    id = await newJob(files, "articles");
    const plan = await analyzeImportJob(admin, id, {});
    planned = plan.summary.create;
    expect(plan.summary.errors).toBe(0);
    expect(planned).toBeGreaterThanOrEqual(articleCount);
    // Topics the site already has are reused, new topic folders are created; none may need a decision.
    expect(plan.topics.every((t) => t.action === "reuse" || t.action === "create")).toBe(true);
    expect(plan.topics.find((t) => t.label.toLowerCase() === "career")?.action).toBe("reuse");
    await approveImportJob(admin, id, { hash: plan.hash });
    const result = await runToEnd(id, files);
    expect(result.status).toBe("completed");

    const job = await getImportJob(admin, id);
    expect(job.summary.result).toMatchObject({ created: planned, failed: 0 });
    const ctcRows = await db.select().from(documents).where(eq(documents.slug, "ctc-vs-in-hand-salary"));
    expect(ctcRows).toHaveLength(1);
    const ctc = await getDocumentForEdit(admin, ctcRows[0]!.id);
    expect(ctc).toMatchObject({ status: "draft", visibility: "public", title: expect.stringContaining("CTC vs In-Hand Salary") });
    expect(ctc.categories.map((c) => c.slug)).toEqual(["career"]);
    expect(ctc.tags.map((t) => t.name)).toEqual(expect.arrayContaining(["CTC", "salary"]));
    expect(ctc.properties).toMatchObject({ difficulty: "beginner", audience: expect.stringContaining("Freshers") });
    expect(ctc.seoTitle).toBe("CTC vs In-Hand Salary in India: A Line-by-Line Breakdown");
    expect(ctc.wordCount).toBeGreaterThan(500);
    expect(ctc.content.content.some((n) => n.type === "table")).toBe(true);
    const debug = (await db.select().from(documents).where(eq(documents.slug, "how-to-debug-any-bug")))[0]!;
    const debugDoc = await getDocumentForEdit(admin, debug.id);
    expect(debugDoc.categories.map((c) => c.slug).sort()).toEqual(["software-engineering", "technology"]);

    const identity = await db.select().from(portableIdentities).where(eq(portableIdentities.documentId, ctc.id));
    expect(identity[0]).toMatchObject({ portableId: "path:articles/career/ctc-vs-in-hand-salary.md", entity: "document" });
    expect((identity[0]!.metadata as { unmapped: Record<string, unknown> }).unmapped).toMatchObject({ lastReviewed: "October 2026" });
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["import.approve", "import.completed"]));
  }, 180_000);

  it("re-importing the same folder finds every article as a duplicate", async () => {
    const files = articleFiles;
    const again = await newJob(files, "articles again");
    const plan = await analyzeImportJob(admin, again, {});
    expect(plan.summary.create).toBe(0);
    expect(plan.documents.every((d) => d.conflict?.reason === "identity")).toBe(true);
    expect(plan.decisionsRequired).toHaveLength(planned);
    const skipAll = await analyzeImportJob(admin, again, { decisions: { duplicateAction: "skip" } });
    expect(skipAll.decisionsRequired).toEqual([]);
  });

  it("keeps staged text only while needed", async () => {
    const job = await db.select().from(importJobs).where(eq(importJobs.id, id));
    expect(job[0]!.status).toBe("completed");
    const { importFiles } = await import("@/server/db/schema");
    const remaining = await db.select({ content: importFiles.content }).from(importFiles).where(eq(importFiles.jobId, id));
    expect(remaining.every((r) => r.content === null)).toBe(true);
  });
});

describe("courses, media and links", () => {
  it("creates an ordered collection, uploads referenced media and links lessons with backlinks", async () => {
    const files: Source = {
      "learn/README.md": "# Wrapper",
      "learn/java/README.md": "---\ntitle: Java Course\ndescription: From zero.\n---\nWelcome to the course.",
      "learn/java/01-basics.md": "# Basics\n\n![diagram](img/flow.png)\n\nNext: [OOP](02-oop.md)",
      "learn/java/02-oop.md": "# OOP\n\nBack to [basics](01-basics.md).",
      "learn/java/img/flow.png": png,
    };
    const id = await newJob(files, "learn");
    const plan = await analyzeImportJob(admin, id, {});
    expect(plan.collections[0]).toMatchObject({ action: "create", items: [expect.objectContaining({ documentKey: "java/01-basics.md" }), expect.objectContaining({ documentKey: "java/02-oop.md" })] });
    expect(plan.media[0]).toMatchObject({ action: "upload" });
    await approveImportJob(admin, id, { hash: plan.hash });

    // The server waits for the browser to upload the image; a different file is refused.
    const first = await runImportJob(admin, id);
    expect(first.needsAssets).toHaveLength(1);
    const imposter = await sharp({ create: { width: 5, height: 5, channels: 3, background: "#000" } }).png().toBuffer();
    await expect(uploadImportAsset(admin, id, first.needsAssets[0]!.key, { bytes: imposter, declaredType: "image/png" })).rejects.toMatchObject({ code: "invalid" });
    const result = await runToEnd(id, files);
    expect(result.status).toBe("completed");

    const [course] = await db.select().from(documents).where(eq(documents.title, "Java Course"));
    const items = await db.select().from(collectionItems).where(eq(collectionItems.collectionId, course!.id));
    const titles = await db.select({ id: documents.id, title: documents.title }).from(documents).where(inArray(documents.id, items.map((i) => i.documentId)));
    expect(items.sort((a, b) => a.position - b.position).map((i) => titles.find((t) => t.id === i.documentId)!.title)).toEqual(["Basics", "OOP"]);
    const basics = await getDocumentForEdit(admin, titles.find((t) => t.title === "Basics")!.id);
    const image = basics.content.content.find((n) => n.type === "image");
    expect(image?.attrs).toMatchObject({ src: expect.stringMatching(/^\/media\/media\/\d{4}\/\d{2}\/.+\.webp$/), mediaId: expect.any(String) });
    // Links became content relations in both directions (backlinks are derived, never written).
    const oop = await getDocumentForEdit(admin, titles.find((t) => t.title === "OOP")!.id);
    expect(oop.backlinks.map((b) => b.sourceId)).toContain(basics.id);
    expect(basics.backlinks.map((b) => b.sourceId)).toContain(oop.id);
    const link = JSON.stringify(basics.content);
    expect(link).toContain(oop.path);
    // The same image in a later import is reused, not stored twice.
    const mediaBefore = (await contentCounts()).media;
    const reuse = await newJob({ "again/x.md": "![d](flow.png)", "again/flow.png": png, "again/y.md": "y" });
    const reusePlan = await analyzeImportJob(admin, reuse, {});
    expect(reusePlan.media[0]!.action).toBe("reuse");
    await approveImportJob(admin, reuse, { hash: reusePlan.hash });
    await runToEnd(reuse, {});
    expect((await contentCounts()).media).toBe(mediaBefore);
  });
});

describe("conflicts: update and copy", () => {
  let existingId: string;
  beforeAll(async () => {
    const id = await newJob({ "keep.md": "---\ntitle: Keep Me\nexcerpt: Original excerpt\ntags: [original]\nseoTitle: Original SEO\n---\nOriginal body", "sibling.md": "x" });
    const plan = await analyzeImportJob(admin, id, {});
    await approveImportJob(admin, id, { hash: plan.hash });
    await runToEnd(id, {});
    existingId = (await db.select().from(documents).where(eq(documents.slug, "keep-me")))[0]!.id;
  });

  it("updates only the selected fields; omitted fields and taxonomy stay", async () => {
    const files = { "keep.md": "---\ntitle: Keep Me\nexcerpt: New excerpt\nseoTitle: New SEO\ntags: [added]\n---\nNew body", "sibling.md": "x" };
    const id = await newJob(files);
    const plan = await analyzeImportJob(admin, id, { decisions: { duplicateAction: "skip", documents: { "keep.md": { action: "update", updateFields: ["excerpt", "tags"] } } } });
    expect(plan.documents.find((d) => d.key === "keep.md")).toMatchObject({ action: "update", conflict: { reason: "identity" } });
    await approveImportJob(admin, id, { hash: plan.hash });
    await runToEnd(id, files);
    const doc = await getDocumentForEdit(admin, existingId);
    expect(doc.excerpt).toBe("New excerpt");
    expect(doc.seoTitle).toBe("Original SEO");
    expect(JSON.stringify(doc.content)).toContain("Original body");
    expect(doc.tags.map((t) => t.name).sort()).toEqual(["added", "original"]);
  });

  it("an explicit clear empties a field, while an omitted value leaves it", async () => {
    const files = { "keep.md": "---\ntitle: Keep Me\n---\nBody", "sibling.md": "x" };
    const id = await newJob(files);
    const plan = await analyzeImportJob(admin, id, { decisions: { duplicateAction: "skip", documents: { "keep.md": { action: "update", updateFields: ["excerpt", "seo"], clearFields: ["seo"] } } } });
    await approveImportJob(admin, id, { hash: plan.hash });
    await runToEnd(id, files);
    const doc = await getDocumentForEdit(admin, existingId);
    expect(doc.excerpt).toBe("New excerpt"); // selected, but absent in the source → unchanged
    expect(doc.seoTitle).toBeNull(); // explicitly cleared
  });

  it("stages body updates of a published document instead of changing it live", async () => {
    await db.update(documents).set({ status: "published", visibility: "public", publishedAt: new Date() }).where(eq(documents.id, existingId));
    const files = { "keep.md": "---\ntitle: Keep Me\n---\nStaged body", "sibling.md": "x" };
    const id = await newJob(files);
    const plan = await analyzeImportJob(admin, id, { decisions: { duplicateAction: "skip", documents: { "keep.md": { action: "update", updateFields: ["body"] } } } });
    expect(plan.documents.find((d) => d.key === "keep.md")).toMatchObject({ status: "published", visibility: "public", statusFrom: "existing" });
    await approveImportJob(admin, id, { hash: plan.hash });
    await runToEnd(id, files);
    const doc = await getDocumentForEdit(admin, existingId);
    expect(JSON.stringify(doc.content)).not.toContain("Staged body");
    expect(JSON.stringify(doc.workingCopy?.content)).toContain("Staged body");
    expect(doc.status).toBe("published");
  });

  it("copy creates a separate draft and leaves the original alone", async () => {
    const files = { "keep.md": "---\ntitle: Keep Me\n---\nCopy body", "sibling.md": "x" };
    const id = await newJob(files);
    const plan = await analyzeImportJob(admin, id, { decisions: { duplicateAction: "skip", documents: { "keep.md": { action: "copy" } } } });
    await approveImportJob(admin, id, { hash: plan.hash });
    await runToEnd(id, files);
    const copy = (await db.select().from(documents).where(eq(documents.slug, "keep-me-copy")))[0]!;
    expect(copy).toMatchObject({ status: "draft", visibility: "public" });
    expect(copy.id).not.toBe(existingId);
    const identities = await db.select().from(portableIdentities).where(eq(portableIdentities.documentId, copy.id));
    expect(identities).toEqual([]);
  });
});

describe("partial failure, retry, leases and cancellation", () => {
  it("imports valid documents when another fails, and retries without duplicating", async () => {
    const files = { "partial/good-one.md": "# Good\n\nFine.", "partial/unfinished-one.md": "# Unfinished\n\n[TODO] write this" };
    const id = await newJob(files);
    // Publishing is requested explicitly; the unfinished one fails the publish check and stays a draft.
    const plan = await analyzeImportJob(admin, id, { decisions: { status: { mode: "set", status: "published", visibility: "public" } } });
    await approveImportJob(admin, id, { hash: plan.hash });
    const result = await runToEnd(id, files);
    expect(result.status).toBe("partial");
    const failed = await db.select().from(importItems).where(eq(importItems.jobId, id));
    expect(failed.filter((i) => i.status === "failed").map((i) => i.key)).toEqual(["status:unfinished-one.md"]);
    const unfinished = (await db.select().from(documents).where(eq(documents.title, "Unfinished")))[0]!;
    expect(unfinished.status).toBe("draft");
    expect((await db.select().from(documents).where(eq(documents.title, "Good")))[0]!.status).toBe("published");

    // Fix the content, then retry: only the failed step runs again.
    await saveDocument(admin, unfinished.id, { body: { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Written now." }] }] } } });
    const before = (await contentCounts()).documents;
    await controlImportJob(admin, id, { action: "retry" });
    const retried = await runToEnd(id, files);
    expect(retried.status).toBe("completed");
    expect((await contentCounts()).documents).toBe(before);
    expect((await db.select().from(documents).where(eq(documents.id, unfinished.id)))[0]!.status).toBe("published");
  });

  it("refuses a second concurrent run of the same import", async () => {
    const id = await newJob({ "lease/lease-a.md": "Lease A", "lease/lease-b.md": "Lease B" });
    const plan = await analyzeImportJob(admin, id, {});
    await approveImportJob(admin, id, { hash: plan.hash });
    await db.update(importJobs).set({ leaseUntil: new Date(Date.now() + 60_000) }).where(eq(importJobs.id, id));
    await expect(runImportJob(admin, id)).rejects.toMatchObject({ code: "conflict" });
    await db.update(importJobs).set({ leaseUntil: null }).where(eq(importJobs.id, id));
    await runToEnd(id, {});
  });

  it("refuses a double approval", async () => {
    const id = await newJob({ "dbl/double-approval.md": "Approve me twice" });
    const plan = await analyzeImportJob(admin, id, {});
    await approveImportJob(admin, id, { hash: plan.hash });
    await expect(approveImportJob(admin, id, { hash: plan.hash })).rejects.toMatchObject({ code: "conflict" });
    await runToEnd(id, {});
  });

  it("cancelling before any work leaves the site untouched", async () => {
    const before = await contentCounts();
    const id = await newJob({ "cancel/cancel-a.md": "A", "cancel/cancel-b.md": "B" });
    const plan = await analyzeImportJob(admin, id, {});
    await approveImportJob(admin, id, { hash: plan.hash });
    await expect(controlImportJob(admin, id, { action: "cancel" })).resolves.toEqual({ status: "cancelled" });
    expect(await contentCounts()).toEqual(before);
    const items = await db.select().from(importItems).where(eq(importItems.jobId, id));
    expect(items.every((i) => i.status === "cancelled")).toBe(true);
  });
});

describe("preview detail", () => {
  it("shows the converted body and where links will point", async () => {
    const id = await newJob({ "pv/preview-source.md": "# Preview source\n\n**Bold** [to b](preview-target.md)", "pv/preview-target.md": "# Preview target" });
    await analyzeImportJob(admin, id, {});
    const detail = await importDocumentDetail(admin, id, "preview-source.md");
    expect(detail.markdown).toContain("**Bold**");
    expect(detail.markdown).toContain("(/article/preview-target)");
    expect(detail.plan.refs[0]!.resolution).toEqual({ status: "incoming", key: "preview-target.md" });
  });
});

describe("taxonomy creation", () => {
  it("creates missing topics in order and links documents to them", async () => {
    const id = await newJob({ "Gardening/Roses/rose-care.md": "Rose care", "Gardening/soil.md": "Soil", "garden-notes.md": "x" });
    const plan = await analyzeImportJob(admin, id, {});
    expect(plan.topics.filter((t) => t.action === "create").map((t) => t.create!.slug).sort()).toEqual(["gardening", "roses"]);
    await approveImportJob(admin, id, { hash: plan.hash });
    await runToEnd(id, {});
    const [garden] = await db.select().from(categories).where(eq(categories.slug, "gardening"));
    const [roses] = await db.select().from(categories).where(eq(categories.slug, "roses"));
    expect(roses!.parentId).toBe(garden!.id);
    const [a] = await db.select().from(documents).where(eq(documents.slug, "rose-care"));
    const links = await db.select().from(documentCategories).where(eq(documentCategories.documentId, a!.id));
    expect(links.map((l) => l.categoryId)).toEqual([roses!.id]);
    const tagLinks = await db.select().from(documentTags).where(eq(documentTags.documentId, a!.id));
    expect(tagLinks).toEqual([]);
  });
});

describe("retry after a failed member (review fixes)", () => {
  it("re-runs collection and relationship steps so a retried document joins its course", async () => {
    const files = {
      "rt/course/README.md": "---\ntitle: Retry Course\n---\nIntro",
      "rt/course/01-first.md": "# First retry lesson\n\nSee [second](02-second.md).",
      "rt/course/02-second.md": "---\nrelated: [01-first]\n---\n# Second retry lesson",
      "rt/other.md": "x",
    };
    const id = await newJob(files);
    const plan = await analyzeImportJob(admin, id, {});
    await approveImportJob(admin, id, { hash: plan.hash });
    expect((await runToEnd(id, {})).status).toBe("completed");

    // Simulate a lesson whose document step failed: its row (and with it its
    // collection membership and identity) is gone, and the step is marked failed.
    const [second] = await db.select().from(documents).where(eq(documents.slug, "second-retry-lesson"));
    await db.delete(documents).where(eq(documents.id, second!.id));
    await db.update(importItems).set({ status: "failed", targetId: null, error: "simulated" }).where(and(eq(importItems.jobId, id), eq(importItems.key, "doc:course/02-second.md")));
    await db.update(importItems).set({ status: "failed", error: "simulated" }).where(and(eq(importItems.jobId, id), eq(importItems.key, "verify")));
    await db.update(importJobs).set({ status: "partial" }).where(eq(importJobs.id, id));

    await controlImportJob(admin, id, { action: "retry" });
    expect((await runToEnd(id, {})).status).toBe("completed");
    const [course] = await db.select().from(documents).where(eq(documents.title, "Retry Course"));
    const items = await db.select().from(collectionItems).where(eq(collectionItems.collectionId, course!.id));
    expect(items).toHaveLength(2);
    const again = await db.select().from(documents).where(eq(documents.slug, "second-retry-lesson"));
    expect(again).toHaveLength(1); // not duplicated by the retry
    expect(await db.select().from(documents).where(eq(documents.title, "Retry Course"))).toHaveLength(1);
    expect(await db.select().from(documents).where(eq(documents.slug, "first-retry-lesson"))).toHaveLength(1);
    const rels = await db.select().from(documentRelations).where(eq(documentRelations.sourceId, again[0]!.id));
    expect(rels.filter((r) => r.origin === "manual" && r.kind === "related")).toHaveLength(1);
    const [first] = await db.select().from(documents).where(eq(documents.slug, "first-retry-lesson"));
    const contentLinks = await db.select().from(documentRelations).where(and(eq(documentRelations.sourceId, first!.id), eq(documentRelations.origin, "content")));
    expect(contentLinks.filter((r) => r.targetId === again[0]!.id)).toHaveLength(1);
    // Running the same steps again changes nothing (idempotent).
    const snapshotCounts = await contentCounts();
    await db.update(importItems).set({ status: "pending" }).where(and(eq(importItems.jobId, id), eq(importItems.stage, "collection")));
    await db.update(importJobs).set({ status: "running", completedAt: null }).where(eq(importJobs.id, id));
    await runToEnd(id, {});
    expect(await contentCounts()).toEqual(snapshotCounts);
  });

  it("reports a failed verification instead of marking it done", async () => {
    const id = await newJob({ "vf/verify-one.md": "One", "vf/verify-two.md": "Two" });
    const plan = await analyzeImportJob(admin, id, {});
    await approveImportJob(admin, id, { hash: plan.hash });
    expect((await runToEnd(id, {})).status).toBe("completed");
    const [one] = await db.select().from(documents).where(eq(documents.slug, "verify-one"));
    await db.delete(documents).where(eq(documents.id, one!.id));
    await db.update(importItems).set({ status: "pending", result: {} }).where(and(eq(importItems.jobId, id), eq(importItems.key, "verify")));
    await db.update(importJobs).set({ status: "running", completedAt: null }).where(eq(importJobs.id, id));
    const result = await runToEnd(id, {});
    expect(result.status).toBe("partial");
    const [verify] = await db.select().from(importItems).where(and(eq(importItems.jobId, id), eq(importItems.key, "verify")));
    expect(verify).toMatchObject({ status: "failed" });
    expect(verify!.error).toMatch(/missing/);
  });
});

describe("production bucket guard (development environments)", () => {
  class R2Like extends MemoryStorage {
    override readonly driver = "r2" as unknown as "local";
  }
  // A distinct image: identical bytes imported earlier would be reused, not uploaded.
  const files = async () => ({ "guard/guard-doc.md": "![p](pic.png)", "guard/pic.png": await sharp({ create: { width: 17, height: 9, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer() });

  it("blocks media imports into R2 outside production unless explicitly allowed", async () => {
    const { setStorageForTesting: setStorage } = await import("@/server/media/storage");
    const { resetEnvCache } = await import("@/server/env");
    const memory = new MemoryStorage();
    setStorage(new R2Like());
    try {
      const id = await newJob(await files());
      const plan = await analyzeImportJob(admin, id, {});
      expect(plan.summary.mediaUpload).toBe(1);
      expect(plan.issues.some((i) => i.level === "error" && /R2/.test(i.message))).toBe(true);
      await expect(approveImportJob(admin, id, { hash: plan.hash })).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/IMPORT_ALLOW_R2_IN_DEV/) });
      expect((await getImportJob(admin, id)).status).toBe("analyzed");

      // Text-only imports are unaffected.
      const textOnly = await newJob({ "guard2/text-only.md": "Just words" });
      const textPlan = await analyzeImportJob(admin, textOnly, {});
      expect(textPlan.issues.some((i) => /R2/.test(i.message))).toBe(false);
      await approveImportJob(admin, textOnly, { hash: textPlan.hash });
      await runToEnd(textOnly, {});

      // The explicit opt-in turns the error into a visible warning.
      process.env.IMPORT_ALLOW_R2_IN_DEV = "true";
      resetEnvCache();
      const allowed = await analyzeImportJob(admin, id, {});
      expect(allowed.issues.some((i) => i.level === "warning" && /R2/.test(i.message))).toBe(true);
      expect(allowed.issues.some((i) => i.level === "error" && /R2/.test(i.message))).toBe(false);
      await expect(approveImportJob(admin, id, { hash: allowed.hash })).resolves.toMatchObject({ status: "running" });
    } finally {
      delete process.env.IMPORT_ALLOW_R2_IN_DEV;
      resetEnvCache();
      setStorage(memory);
    }
  });
});

describe("production bucket guard: every upload path", () => {
  class R2Like extends MemoryStorage {
    override readonly driver = "r2" as unknown as "local";
  }
  const distinctImage = (seed: number) => sharp({ create: { width: 11 + seed, height: 7, channels: 3, background: { r: seed, g: 9, b: 9 } } }).png().toBuffer();

  it("treats a localhost site as development even when NODE_ENV=production (next start on a laptop)", async () => {
    const { setStorageForTesting: setStorage } = await import("@/server/media/storage");
    const { resetEnvCache } = await import("@/server/env");
    const memory = new MemoryStorage();
    setStorage(new R2Like());
    const before = { site: process.env.NEXT_PUBLIC_SITE_URL };
    try {
      vi.stubEnv("NODE_ENV", "production");
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      resetEnvCache();
      const id = await newJob({ "lg/local-prod.md": "![p](p.png)", "lg/p.png": await distinctImage(31) });
      const plan = await analyzeImportJob(admin, id, {});
      expect(plan.issues.some((i) => i.level === "error" && /R2/.test(i.message))).toBe(true);
      await expect(approveImportJob(admin, id, { hash: plan.hash })).rejects.toMatchObject({ code: "invalid" });

      // A real production origin is allowed.
      process.env.NEXT_PUBLIC_SITE_URL = "https://karthikeyan.example";
      resetEnvCache();
      const prodPlan = await analyzeImportJob(admin, id, {});
      expect(prodPlan.issues.some((i) => i.level === "error" && /R2/.test(i.message))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      process.env.NEXT_PUBLIC_SITE_URL = before.site;
      resetEnvCache();
      setStorage(memory);
    }
  });

  it("refuses the upload itself on resume if the opt-in is gone, and nothing reaches storage", async () => {
    const { setStorageForTesting: setStorage } = await import("@/server/media/storage");
    const { resetEnvCache } = await import("@/server/env");
    const memory = new MemoryStorage();
    const r2 = new R2Like();
    setStorage(r2);
    try {
      process.env.IMPORT_ALLOW_R2_IN_DEV = "true";
      resetEnvCache();
      const bytes = await distinctImage(47);
      const id = await newJob({ "rs/resume-doc.md": "![p](p.png)", "rs/p.png": bytes });
      const plan = await analyzeImportJob(admin, id, {});
      await approveImportJob(admin, id, { hash: plan.hash });
      const first = await runImportJob(admin, id);
      expect(first.needsAssets).toHaveLength(1);

      // The environment changes before the browser uploads (e.g. the server was restarted without the flag).
      delete process.env.IMPORT_ALLOW_R2_IN_DEV;
      resetEnvCache();
      await expect(uploadImportAsset(admin, id, first.needsAssets[0]!.key, { bytes, declaredType: "image/png" })).rejects.toMatchObject({ code: "invalid" });
      expect(r2.objects.size).toBe(0);
      const [row] = await db.select().from(importItems).where(and(eq(importItems.jobId, id), eq(importItems.key, first.needsAssets[0]!.key)));
      expect(row!.status).toBe("pending");
      // Resuming (run) never uploads by itself: it only asks for the file again.
      await expect(runImportJob(admin, id)).resolves.toMatchObject({ needsAssets: [expect.objectContaining({ key: first.needsAssets[0]!.key })] });
      expect(r2.objects.size).toBe(0);
      await controlImportJob(admin, id, { action: "cancel" });
    } finally {
      delete process.env.IMPORT_ALLOW_R2_IN_DEV;
      resetEnvCache();
      setStorage(memory);
    }
  });
});

describe("media upload failures", () => {
  class FlakyStorage extends MemoryStorage {
    puts = 0;
    failOn = Number.POSITIVE_INFINITY;
    override async put(key: string, body: Buffer) {
      this.puts++;
      if (this.puts === this.failOn) throw new Error("simulated storage outage");
      this.objects.set(key, body);
    }
  }

  it("a storage failure part-way through an image leaves no orphaned objects and the step stays pending", async () => {
    const { setStorageForTesting: setStorage } = await import("@/server/media/storage");
    const flaky = new FlakyStorage();
    setStorage(flaky);
    try {
      const big = await sharp({ create: { width: 1300, height: 700, channels: 3, background: { r: 12, g: 99, b: 5 } } }).png().toBuffer();
      const id = await newJob({ "uf/upload-fail.md": "![p](big.png)", "uf/big.png": big });
      const plan = await analyzeImportJob(admin, id, {});
      await approveImportJob(admin, id, { hash: plan.hash });
      const need = (await runImportJob(admin, id)).needsAssets[0]!;
      const mediaBefore = (await contentCounts()).media;
      flaky.failOn = flaky.puts + 2; // the primary object is written, the first variant fails
      await expect(uploadImportAsset(admin, id, need.key, { bytes: big, declaredType: "image/png" })).rejects.toThrow();
      expect(flaky.objects.size).toBe(0);
      expect((await contentCounts()).media).toBe(mediaBefore);
      const [item] = await db.select().from(importItems).where(and(eq(importItems.jobId, id), eq(importItems.key, need.key)));
      expect(item!.status).toBe("pending");
      // The outage ends: the same step succeeds on retry.
      flaky.failOn = Number.POSITIVE_INFINITY;
      await expect(uploadImportAsset(admin, id, need.key, { bytes: big, declaredType: "image/png" })).resolves.toMatchObject({ reused: false });
      expect((await runToEnd(id, {})).status).toBe("completed");
    } finally {
      setStorage(new MemoryStorage());
    }
  });

  it("a crash after the object is stored but before the import records it leaves a media row for every stored object (a possible duplicate, never an invisible orphan)", async () => {
    const { setStorageForTesting: setStorage } = await import("@/server/media/storage");
    const storage = new MemoryStorage();
    setStorage(storage);
    const spy = vi.spyOn(db, "transaction");
    try {
      const img = await sharp({ create: { width: 90, height: 60, channels: 3, background: { r: 70, g: 3, b: 200 } } }).png().toBuffer();
      const id = await newJob({ "cr/crash-doc.md": "![p](c.png)", "cr/c.png": img });
      const plan = await analyzeImportJob(admin, id, {});
      await approveImportJob(admin, id, { hash: plan.hash });
      const need = (await runImportJob(admin, id)).needsAssets[0]!;
      const before = (await contentCounts()).media;
      spy.mockRejectedValueOnce(new Error("simulated crash before the import record was saved"));
      await expect(uploadImportAsset(admin, id, need.key, { bytes: img, declaredType: "image/png" })).rejects.toThrow(/simulated crash/);
      const rows = await db.select().from(media);
      expect(rows.length).toBe(before + 1);
      // Every stored object belongs to a media row (so it is visible and deletable in the Media library).
      const known = new Set(rows.flatMap((r) => [r.storageKey, ...((r.variants ?? []) as Array<{ key: string }>).map((v) => v.key)]));
      for (const key of storage.objects.keys()) expect(known.has(key)).toBe(true);
      const [item] = await db.select().from(importItems).where(and(eq(importItems.jobId, id), eq(importItems.key, need.key)));
      expect(item!.status).toBe("pending");
      // Retrying completes the import; it uploads again (documented: one extra unreferenced media row).
      await expect(uploadImportAsset(admin, id, need.key, { bytes: img, declaredType: "image/png" })).resolves.toBeTruthy();
      expect((await runToEnd(id, {})).status).toBe("completed");
      expect((await db.select().from(media)).length).toBe(before + 2);
    } finally {
      spy.mockRestore();
      setStorage(new MemoryStorage());
    }
  });
});
