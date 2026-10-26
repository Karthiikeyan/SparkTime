import "server-only";
import { and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { isUuid, type Doc } from "@/lib/content/blocks";
import { DOCUMENT_STATUSES, VISIBILITIES } from "@/lib/content/model";
import { docToMarkdown } from "@/lib/content/markdown";
import type { NormalizedDocument, ParsedPackage } from "@/lib/portability/model";
import { IMPORT_LIMITS } from "@/lib/portability/limits";
import { parsePackage, type StagedFile } from "@/lib/portability/parse";
import { fileKind, isJunkPath, isTextKind, normalizePackagePath } from "@/lib/portability/paths";
import { planImport, planIsApprovable } from "@/lib/portability/plan";
import { UPDATE_FIELDS, type DocumentPlan, type ImportDecisions, type ImportPlan } from "@/lib/portability/plan-types";
import { toPlanView, type PlanView } from "@/lib/portability/plan-view";
import { resolvePlaceholders } from "@/lib/portability/doc-refs";
import { assertAdmin, type Actor, type AdminActor } from "../../auth/actor";
import { getDb, type Db } from "../../db/client";
import { importFiles, importItems, importJobs } from "../../db/schema";
import { mediaPublicOrigin, siteUrl } from "../../env";
import { conflict, invalid, notFound } from "../../errors";
import { sniffType } from "../../media/validation";
import { recordAudit } from "../audit";
import { maxUploadBytes } from "../media";
import { buildItems } from "./execute";
import { loadDestinationSnapshot } from "./snapshot";
import { assertMediaUploadAllowed, mediaStorageGuard } from "./storage-guard";
import { clampInt } from "@/lib/numbers";

export type ImportJobStatus = "staging" | "analyzed" | "running" | "completed" | "partial" | "failed" | "cancelled";
type JobRow = typeof importJobs.$inferSelect;

/** Staged text of unfinished imports is cleared after this long. */
const STAGING_TTL_MS = 7 * 24 * 3600 * 1000;

async function loadJob(db: Db, actor: AdminActor, id: string): Promise<JobRow> {
  if (!isUuid(id)) throw notFound("Import");
  const [job] = await db.select().from(importJobs).where(and(eq(importJobs.id, id), eq(importJobs.createdBy, actor.userId))).limit(1);
  if (!job) throw notFound("Import");
  return job;
}

// ---------------------------------------------------------------------------
// Create and stage
// ---------------------------------------------------------------------------

const createSchema = z.object({
  sourceName: z.string().trim().max(200).default(""),
  options: z.object({ obsidianVault: z.boolean().optional() }).default({}),
});

export async function createImportJob(actor: Actor, input: unknown): Promise<{ id: string }> {
  assertAdmin(actor);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw invalid("Invalid import.");
  const [job] = await getDb()
    .insert(importJobs)
    .values({ createdBy: actor.userId, sourceName: parsed.data.sourceName.replace(/[\x00-\x1f\x7f]/g, ""), options: parsed.data.options })
    .returning({ id: importJobs.id });
  return { id: job!.id };
}

const fileSchema = z.object({
  path: z.string().min(1).max(IMPORT_LIMITS.maxPathLength * 2),
  size: z.number().int().nonnegative().max(500 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  head: z.string().max(200).regex(/^[A-Za-z0-9+/=]*$/).nullable().default(null),
  text: z.string().max(IMPORT_LIMITS.maxTextFileBytes).nullable().default(null),
});
const stageSchema = z.object({ files: z.array(fileSchema).min(1).max(IMPORT_LIMITS.maxFiles) });

/**
 * Stores one batch of files. Every path, size and kind is re-validated here;
 * nothing the browser computed is trusted. Re-sending a batch is harmless
 * (same path → replaced). Staging after analysis invalidates the plan.
 */
export async function stageImportFiles(actor: Actor, id: string, input: unknown): Promise<{ accepted: number; skipped: Array<{ path: string; reason: string }>; fileCount: number }> {
  assertAdmin(actor);
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid files.");
  const db = getDb();
  const job = await loadJob(db, actor, id);
  if (job.status !== "staging" && job.status !== "analyzed") throw conflict("This import can't take more files.");

  const skipped: Array<{ path: string; reason: string }> = [];
  const rows: Array<typeof importFiles.$inferInsert> = [];
  for (const file of parsed.data.files) {
    const normalized = normalizePackagePath(file.path);
    if (!normalized.ok) {
      skipped.push({ path: file.path.slice(0, 200), reason: normalized.reason });
      continue;
    }
    if (isJunkPath(normalized.path)) continue;
    const kind = fileKind(normalized.path);
    if (isTextKind(kind)) {
      if (file.text === null) {
        skipped.push({ path: normalized.path, reason: "Text file without content (it may not be valid UTF-8)." });
        continue;
      }
      if (new TextEncoder().encode(file.text).length > IMPORT_LIMITS.maxTextFileBytes) {
        skipped.push({ path: normalized.path, reason: `Larger than ${IMPORT_LIMITS.maxTextFileBytes / 1024 / 1024} MB.` });
        continue;
      }
      rows.push({ jobId: id, path: normalized.path, size: file.text.length, sha256: null, head: null, content: file.text });
    } else if (kind === "media") {
      if (!file.sha256 || file.head === null) {
        skipped.push({ path: normalized.path, reason: "Media file without a checksum." });
        continue;
      }
      rows.push({ jobId: id, path: normalized.path, size: file.size, sha256: file.sha256, head: file.head, content: null });
    } else {
      // Recorded so the preview can report it; never parsed.
      rows.push({ jobId: id, path: normalized.path, size: file.size, sha256: null, head: null, content: null });
    }
  }

  return db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .insert(importFiles)
        .values(row)
        .onConflictDoUpdate({ target: [importFiles.jobId, importFiles.path], set: { size: row.size, sha256: row.sha256, head: row.head, content: row.content } });
    }
    const [totals] = await tx
      .select({
        files: count(),
        text: sql<number>`coalesce(sum(length(${importFiles.content})), 0)`,
        media: sql<number>`count(*) filter (where ${importFiles.sha256} is not null)`,
      })
      .from(importFiles)
      .where(eq(importFiles.jobId, id));
    const files = Number(totals?.files ?? 0);
    if (files > IMPORT_LIMITS.maxFiles) throw invalid(`An import can hold at most ${IMPORT_LIMITS.maxFiles} files. Split it into smaller imports.`);
    if (Number(totals?.text ?? 0) > IMPORT_LIMITS.maxTotalTextBytes) throw invalid("This import holds more text than one import may. Split it into smaller imports.");
    if (Number(totals?.media ?? 0) > IMPORT_LIMITS.maxMediaFiles) throw invalid(`An import can hold at most ${IMPORT_LIMITS.maxMediaFiles} media files.`);
    await tx
      .update(importJobs)
      .set({ status: "staging", plan: null, planHash: null, fileCount: files, textBytes: Number(totals?.text ?? 0), updatedAt: new Date() })
      .where(eq(importJobs.id, id));
    return { accepted: rows.length, skipped, fileCount: files };
  });
}

// ---------------------------------------------------------------------------
// Decisions (untrusted input from the preview)
// ---------------------------------------------------------------------------

const updateField = z.enum(UPDATE_FIELDS);
const decisionsSchema = z.object({
  defaultType: z.string().max(96).optional(),
  typeAliases: z.record(z.string().max(80), z.string().max(96)).optional(),
  folders: z
    .record(
      z.string().max(800),
      z.object({
        role: z.enum(["topic", "collection", "tag", "none"]).optional(),
        type: z.string().max(96).optional(),
        collectionType: z.string().max(96).optional(),
        collectionTitle: z.string().max(300).optional(),
        collectionId: z.string().refine(isUuid).optional(),
        topicId: z.string().refine(isUuid).optional(),
      }),
    )
    .optional(),
  documents: z
    .record(
      z.string().max(1000),
      z.object({
        include: z.boolean().optional(),
        type: z.string().max(96).optional(),
        title: z.string().max(300).optional(),
        slug: z.string().max(96).optional(),
        action: z.enum(["skip", "update", "copy"]).optional(),
        matchId: z.string().refine(isUuid).optional(),
        updateFields: z.array(updateField).max(UPDATE_FIELDS.length).optional(),
        clearFields: z.array(updateField).max(UPDATE_FIELDS.length).optional(),
        status: z.enum(DOCUMENT_STATUSES).optional(),
        visibility: z.enum(VISIBILITIES).optional(),
        order: z.number().int().min(-10000).max(10000).optional(),
      }),
    )
    .optional(),
  topics: z
    .record(
      z.string().max(1000),
      z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("existing"), id: z.string().refine(isUuid) }),
        z.object({ mode: z.literal("create"), name: z.string().trim().min(1).max(80), slug: z.string().trim().min(1).max(96) }),
        z.object({ mode: z.literal("skip") }),
      ]),
    )
    .optional(),
  status: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("draft") }),
      z.object({ mode: z.literal("set"), status: z.enum(DOCUMENT_STATUSES), visibility: z.enum(VISIBILITIES) }),
      z.object({ mode: z.literal("source") }),
    ])
    .optional(),
  importReadmes: z.boolean().optional(),
  keepRootFolder: z.boolean().optional(),
  duplicateAction: z.enum(["skip", "update", "copy"]).optional(),
});

function parseDecisions(input: unknown): ImportDecisions {
  const parsed = decisionsSchema.safeParse(input ?? {});
  if (!parsed.success) throw invalid(`Invalid import choices: ${parsed.error.issues[0]?.message ?? "unknown"}.`);
  const decisions = parsed.data as ImportDecisions;
  if (decisions.status?.mode === "set" && decisions.status.status === "scheduled") throw invalid("Imports can't schedule publishing.");
  for (const d of Object.values(decisions.documents ?? {})) if (d.status === "scheduled") throw invalid("Imports can't schedule publishing.");
  return decisions;
}

// ---------------------------------------------------------------------------
// Analyse (dry run)
// ---------------------------------------------------------------------------

async function stagedFiles(db: Db, jobId: string): Promise<StagedFile[]> {
  const rows = await db.select().from(importFiles).where(eq(importFiles.jobId, jobId)).orderBy(asc(importFiles.path));
  return rows.map((r) => ({ path: r.path, size: r.size, text: r.content, sha256: r.sha256, head: r.head }));
}

/** Parse + plan against the current destination. Reads only. */
async function computePlan(db: Db, job: JobRow, decisions: ImportDecisions): Promise<{ pkg: ParsedPackage; plan: ImportPlan }> {
  const files = await stagedFiles(db, job.id);
  if (!files.length) throw invalid("Add files to analyse first.");
  if (files.every((f) => f.text === null && f.sha256 === null) && job.status !== "staging") throw invalid("This import's staged files were cleared. Start a new import.");
  const options = (job.options ?? {}) as { obsidianVault?: boolean };
  const pkg = await parsePackage(files, {
    siteOrigin: siteUrl(),
    mediaOrigin: mediaPublicOrigin(),
    obsidianVault: options.obsidianVault === true,
    importReadmes: decisions.importReadmes === true,
    keepRootFolder: decisions.keepRootFolder === true,
  });
  const snapshot = await loadDestinationSnapshot(db);
  const guard = mediaStorageGuard();
  const plan = await planImport(pkg, snapshot, decisions, { maxUploadBytes: maxUploadBytes(), sniffMedia: sniffType, mediaStorageNote: guard.note ? { text: guard.note, blocked: guard.blocked } : null });
  return { pkg, plan };
}

export async function analyzeImportJob(actor: Actor, id: string, input: unknown): Promise<PlanView> {
  assertAdmin(actor);
  const db = getDb();
  const job = await loadJob(db, actor, id);
  if (job.status !== "staging" && job.status !== "analyzed") throw conflict("This import has already been approved.");
  const decisions = parseDecisions((input as { decisions?: unknown } | null)?.decisions ?? job.decisions);
  const { plan } = await computePlan(db, job, decisions);
  await db
    .update(importJobs)
    .set({
      status: "analyzed",
      decisions,
      plan,
      planHash: plan.hash,
      sourceSystem: plan.source.system,
      schemaVersion: plan.source.schemaVersion,
      summary: { planned: plan.summary },
      updatedAt: new Date(),
    })
    .where(eq(importJobs.id, id));
  return toPlanView(plan);
}

export type DocumentDetail = {
  plan: DocumentPlan;
  markdown: string;
  source: { path: string; format: string; title: string; titleFrom: string };
  unmapped: Record<string, unknown>;
};

/** Full plan for one document plus a text preview of its converted body. */
export async function importDocumentDetail(actor: Actor, id: string, key: string): Promise<DocumentDetail> {
  assertAdmin(actor);
  const db = getDb();
  const job = await loadJob(db, actor, id);
  const plan = job.plan as ImportPlan | null;
  const docPlan = plan?.documents.find((d) => d.key === key);
  if (!plan || !docPlan) throw notFound("Document in this import");
  const { pkg } = await computePlan(db, job, (job.decisions ?? {}) as ImportDecisions);
  const source = pkg.documents.find((d) => d.key === key) ?? pkg.readmes.find((r) => `collection:${r.sourcePath.replace(/\/[^/]+$/, "")}` === key) ?? null;
  return {
    plan: docPlan,
    markdown: source ? previewMarkdown(source, docPlan, plan) : "",
    source: { path: docPlan.sourcePath, format: docPlan.sourceFormat, title: source?.title.value ?? docPlan.title, titleFrom: source?.title.from ?? docPlan.titleFrom },
    unmapped: docPlan.unmapped,
  };
}

/** Markdown rendering of the converted body, with links shown where they will point. Display only. */
function previewMarkdown(doc: NormalizedDocument, docPlan: DocumentPlan, plan: ImportPlan): string {
  const pathOf = (key: string) => {
    const target = plan.documents.find((d) => d.key === key);
    return target ? `/${target.typeSlug}/${target.slug}` : null;
  };
  const resolved: Doc = resolvePlaceholders(doc.body, {
    doc: (i) => {
      const r = docPlan.refs[i]?.resolution;
      if (r?.status === "incoming") return { id: r.key, path: pathOf(r.key) ?? "#" };
      if (r?.status === "existing") return { id: r.id, path: r.path };
      if (r?.status === "kept") return { id: "", path: r.path };
      return null;
    },
    media: (i) => {
      const key = docPlan.mediaRefs[i]?.mediaKey;
      const media = plan.media.find((m) => m.key === key);
      if (!media || (media.action !== "upload" && media.action !== "reuse")) return null;
      return { src: media.url ?? `package:${media.path}`, mediaId: null };
    },
    describeMedia: (i) => {
      const key = docPlan.mediaRefs[i]?.mediaKey;
      return plan.media.find((m) => m.key === key)?.message ?? "missing";
    },
  });
  return docToMarkdown(resolved);
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

/**
 * Re-plans against the current destination and only proceeds if the result
 * is exactly what the owner reviewed (same hash). Then records the work as
 * items; nothing is written to content yet.
 */
export async function approveImportJob(actor: Actor, id: string, input: unknown): Promise<{ status: ImportJobStatus; items: number }> {
  assertAdmin(actor);
  const hash = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(input);
  if (!hash.success) throw invalid("Approve the plan you reviewed.");
  const db = getDb();
  const job = await loadJob(db, actor, id);
  if (job.status !== "analyzed" || !job.planHash) throw conflict("Analyse the import before approving it.");
  if (hash.data.hash !== job.planHash) throw conflict("The preview you approved is out of date. Review the latest preview.");
  const decisions = (job.decisions ?? {}) as ImportDecisions;
  const { pkg, plan } = await computePlan(db, job, decisions);
  if (plan.hash !== job.planHash) {
    await db.update(importJobs).set({ plan, planHash: plan.hash, summary: { planned: plan.summary }, updatedAt: new Date() }).where(eq(importJobs.id, id));
    throw conflict("The site changed since this preview was made (or the files did). The preview has been refreshed: review it and approve again.", { stale: "true" });
  }
  const approvable = planIsApprovable(plan);
  if (!approvable.ok) throw invalid(approvable.reason ?? "This plan can't be approved yet.");
  if (plan.summary.mediaUpload > 0) assertMediaUploadAllowed();

  const items = buildItems(plan, pkg);
  await db.transaction(async (tx) => {
    // Guard against a double click: only the first approval moves the job on.
    const moved = await tx
      .update(importJobs)
      .set({ status: "running", startedAt: new Date(), updatedAt: new Date(), cancelRequested: false })
      .where(and(eq(importJobs.id, id), eq(importJobs.status, "analyzed")))
      .returning({ id: importJobs.id });
    if (!moved.length) throw conflict("This import is already running.");
    for (let i = 0; i < items.length; i += 100) {
      await tx.insert(importItems).values(items.slice(i, i + 100).map((item) => ({ ...item, jobId: id })));
    }
  });
  await recordAudit(actor, "import.approve", "import", id, job.sourceName || "Import", { counts: plan.summary, system: plan.source.system });
  return { status: "running", items: items.length };
}

// ---------------------------------------------------------------------------
// Reads, history, control
// ---------------------------------------------------------------------------

export type ImportJobView = {
  id: string;
  status: ImportJobStatus;
  sourceName: string;
  sourceSystem: string | null;
  schemaVersion: number | null;
  fileCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  summary: Record<string, unknown>;
  error: string | null;
  cancelRequested: boolean;
  decisions: ImportDecisions;
  planHash: string | null;
  progress: { total: number; done: number; failed: number; skipped: number; cancelled: number; pending: number; awaitingUpload: number };
};

async function progressOf(db: Db, jobId: string): Promise<ImportJobView["progress"]> {
  const rows = await db
    .select({ status: importItems.status, stage: importItems.stage, action: importItems.action, n: count() })
    .from(importItems)
    .where(eq(importItems.jobId, jobId))
    .groupBy(importItems.status, importItems.stage, importItems.action);
  const sum = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).reduce((n, r) => n + Number(r.n), 0);
  return {
    total: sum(() => true),
    done: sum((r) => r.status === "done"),
    failed: sum((r) => r.status === "failed"),
    skipped: sum((r) => r.status === "skipped"),
    cancelled: sum((r) => r.status === "cancelled"),
    pending: sum((r) => r.status === "pending"),
    awaitingUpload: sum((r) => r.status === "pending" && r.stage === "asset" && r.action === "upload"),
  };
}

function view(job: JobRow, progress: ImportJobView["progress"]): ImportJobView {
  return {
    id: job.id,
    status: job.status as ImportJobStatus,
    sourceName: job.sourceName,
    sourceSystem: job.sourceSystem,
    schemaVersion: job.schemaVersion,
    fileCount: job.fileCount,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    summary: (job.summary ?? {}) as Record<string, unknown>,
    error: job.error,
    cancelRequested: job.cancelRequested,
    decisions: (job.decisions ?? {}) as ImportDecisions,
    planHash: job.planHash,
    progress,
  };
}

export async function getImportJob(actor: Actor, id: string): Promise<ImportJobView & { plan: PlanView | null }> {
  assertAdmin(actor);
  const db = getDb();
  const job = await loadJob(db, actor, id);
  const plan = job.plan ? toPlanView(job.plan as ImportPlan) : null;
  return { ...view(job, await progressOf(db, id)), plan };
}

export async function listImportJobs(actor: Actor, filters: { status?: string; limit?: number; offset?: number } = {}): Promise<{ items: ImportJobView[]; total: number }> {
  assertAdmin(actor);
  const db = getDb();
  // Lazy clean-up instead of a cron: unfinished imports don't keep staged text forever.
  await db
    .update(importFiles)
    .set({ content: null })
    .where(
      and(
        inArray(importFiles.jobId, db.select({ id: importJobs.id }).from(importJobs).where(and(inArray(importJobs.status, ["staging", "analyzed"]), lt(importJobs.updatedAt, new Date(Date.now() - STAGING_TTL_MS))))),
        sql`${importFiles.content} is not null`,
      ),
    );
  const where = [eq(importJobs.createdBy, actor.userId)];
  if (filters.status && ["staging", "analyzed", "running", "completed", "partial", "failed", "cancelled"].includes(filters.status)) where.push(eq(importJobs.status, filters.status));
  const limit = clampInt(filters.limit, 1, 100, 30);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db.select().from(importJobs).where(and(...where)).orderBy(desc(importJobs.createdAt)).limit(limit).offset(clampInt(filters.offset, 0, 1_000_000, 0)),
    db.select({ total: count() }).from(importJobs).where(and(...where)),
  ]);
  const items = await Promise.all(rows.map(async (job) => view(job, await progressOf(db, job.id))));
  return { items, total: Number(total) };
}

export async function listImportItems(actor: Actor, id: string, filters: { status?: string; limit?: number; offset?: number } = {}) {
  assertAdmin(actor);
  const db = getDb();
  await loadJob(db, actor, id);
  const where = [eq(importItems.jobId, id)];
  if (filters.status && ["pending", "done", "skipped", "failed", "cancelled"].includes(filters.status)) where.push(eq(importItems.status, filters.status));
  const limit = clampInt(filters.limit, 1, 500, 100);
  const rows = await db
    .select({ key: importItems.key, stage: importItems.stage, action: importItems.action, status: importItems.status, label: importItems.label, attempts: importItems.attempts, targetId: importItems.targetId, error: importItems.error, result: importItems.result })
    .from(importItems)
    .where(and(...where))
    .orderBy(asc(importItems.seq), asc(importItems.key))
    .limit(limit)
    .offset(clampInt(filters.offset, 0, 1_000_000, 0));
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(importItems).where(and(...where));
  return { items: rows, total: Number(total) };
}

/** Deletes an import that never started (its staged files go with it). Finished imports stay as history. */
export async function discardImportJob(actor: Actor, id: string): Promise<void> {
  assertAdmin(actor);
  const db = getDb();
  const job = await loadJob(db, actor, id);
  if (job.status === "running") throw conflict("Cancel the import before removing it.");
  if (job.status !== "staging" && job.status !== "analyzed") throw conflict("Finished imports are kept as history.");
  await db.delete(importJobs).where(eq(importJobs.id, id));
}
