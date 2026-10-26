import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { isUuid } from "@/lib/content/blocks";
import type { MediaAsset } from "@/lib/media";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb } from "../db/client";
import { categories, documents, media, siteSettings, type MediaRow } from "../db/schema";
import { invalid, notFound, ServiceError } from "../errors";
import { ImageProcessingError, processImage } from "../media/processing";
import { getStorage } from "../media/storage";
import { buildObjectKey, CONTENT_TYPE_BY_EXT, MAX_BYTES, sanitizeFilename, validateUpload } from "../media/validation";
import { recordAudit } from "./audit";
import { clampInt } from "@/lib/numbers";

type StoredVariant = { width: number; height: number; key: string; size: number };

export function toMediaAsset(row: MediaRow): MediaAsset {
  const storage = getStorage();
  const variants = ((row.variants ?? []) as StoredVariant[])
    .filter((v) => v && typeof v.key === "string")
    .map((v) => ({ width: v.width, height: v.height, url: storage.urlFor(v.key) }));
  return {
    id: row.id,
    kind: row.kind as MediaAsset["kind"],
    url: storage.urlFor(row.storageKey),
    mimeType: row.mimeType,
    originalName: row.originalName,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    alt: row.alt,
    caption: row.caption,
    placeholder: row.placeholder,
    dominantColor: row.dominantColor,
    focalX: row.focalX,
    focalY: row.focalY,
    variants,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Public: resolve media for rendering. Media records hold no private data beyond what the page shows. */
export async function getMediaAssets(ids: Array<string | null | undefined>): Promise<Map<string, MediaAsset>> {
  const wanted = [...new Set(ids.filter((id): id is string => isUuid(id)))];
  if (!wanted.length) return new Map();
  const rows = await getDb().select().from(media).where(inArray(media.id, wanted));
  return new Map(rows.map((r) => [r.id, toMediaAsset(r)]));
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export type UploadInput = { bytes: Buffer; filename: string; declaredType: string; alt?: string };

/** Safe default for Vercel: its request body limit is ~4.5 MB, so a larger
 * default risks a platform-level 413 before our own validation runs. */
const DEFAULT_MAX_UPLOAD_MB = 4;

/** The highest any per-kind ceiling allows (see MAX_BYTES) — the env override can lower this, never raise it. */
const APPLICATION_MAX_UPLOAD_BYTES = Math.max(...Object.values(MAX_BYTES));

export function maxUploadBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_MB ?? "");
  const configured = Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;
  return Math.min(configured, APPLICATION_MAX_UPLOAD_BYTES);
}

export async function uploadMedia(actor: Actor, input: UploadInput): Promise<MediaAsset> {
  assertAdmin(actor);
  const check = validateUpload(input.bytes, input.declaredType, maxUploadBytes());
  if (!check.ok) throw new ServiceError(check.status === 413 ? "too_large" : check.status === 415 ? "unsupported_media" : "invalid", check.reason);

  const id = randomUUID();
  const storage = getStorage();
  const written: string[] = [];
  const originalName = sanitizeFilename(input.filename || `pasted-${new Date().toISOString().slice(0, 10)}`);

  try {
    if (check.type.kind === "image") {
      let processed;
      try {
        processed = await processImage(input.bytes);
      } catch (error) {
        throw new ServiceError("unsupported_media", error instanceof ImageProcessingError ? error.message : "The image could not be processed.");
      }
      const primaryKey = buildObjectKey("image", id, processed.ext);
      await storage.put(primaryKey, processed.primary.buffer, CONTENT_TYPE_BY_EXT.webp!);
      written.push(primaryKey);
      const variants: StoredVariant[] = [];
      for (const variant of processed.variants) {
        const key = buildObjectKey("image", id, "webp", `-w${variant.width}`);
        await storage.put(key, variant.buffer, CONTENT_TYPE_BY_EXT.webp!);
        written.push(key);
        variants.push({ width: variant.width, height: variant.height, key, size: variant.buffer.length });
      }
      const [row] = await getDb()
        .insert(media)
        .values({
          id,
          kind: "image",
          storageKey: primaryKey,
          mimeType: "image/webp",
          originalName,
          sizeBytes: processed.primary.buffer.length,
          width: processed.primary.width,
          height: processed.primary.height,
          variants,
          placeholder: processed.placeholder,
          dominantColor: processed.dominantColor,
          alt: (input.alt ?? "").slice(0, 500),
          uploadedBy: actor.userId,
        })
        .returning();
      await recordAudit(actor, "media.upload", "media", id, originalName);
      return toMediaAsset(row!);
    }

    // PDFs and audio are stored byte-for-byte under a server-generated key.
    const key = buildObjectKey(check.type.kind, id, check.type.ext);
    await storage.put(key, input.bytes, check.type.mime);
    written.push(key);
    const [row] = await getDb()
      .insert(media)
      .values({ id, kind: check.type.kind, storageKey: key, mimeType: check.type.mime, originalName, sizeBytes: input.bytes.length, uploadedBy: actor.userId })
      .returning();
    await recordAudit(actor, "media.upload", "media", id, originalName);
    return toMediaAsset(row!);
  } catch (error) {
    // Never leave orphaned objects behind after a failed upload.
    await Promise.all(written.map((key) => storage.delete(key).catch(() => undefined)));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Library management
// ---------------------------------------------------------------------------

export async function listMedia(actor: Actor, filters: { kind?: string; q?: string; limit?: number; offset?: number } = {}) {
  assertAdmin(actor);
  const where: SQL[] = [];
  if (filters.kind === "image" || filters.kind === "file" || filters.kind === "audio") where.push(eq(media.kind, filters.kind));
  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(media.originalName, pattern), ilike(media.alt, pattern), ilike(media.caption, pattern))!);
  }
  const condition = where.length ? and(...where) : undefined;
  const limit = clampInt(filters.limit, 1, 200, 60);
  const db = getDb();
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db.select().from(media).where(condition).orderBy(desc(media.createdAt)).limit(limit).offset(clampInt(filters.offset, 0, 1_000_000, 0)),
    db.select({ total: count() }).from(media).where(condition),
  ]);
  return { items: rows.map(toMediaAsset), total: Number(total) };
}

const updateSchema = z.object({
  alt: z.string().max(500).optional(),
  caption: z.string().max(1000).optional(),
  focalX: z.number().min(0).max(1).nullable().optional(),
  focalY: z.number().min(0).max(1).nullable().optional(),
});

export async function updateMedia(actor: Actor, id: string, input: unknown): Promise<MediaAsset> {
  assertAdmin(actor);
  if (!isUuid(id)) throw notFound("Media");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw invalid("Invalid media details.");
  const [row] = await getDb()
    .update(media)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(media.id, id))
    .returning();
  if (!row) throw notFound("Media");
  return toMediaAsset(row);
}

/** Documents (live or staged), category intros and settings that reference a media id. */
export async function findMediaReferences(id: string): Promise<Array<{ kind: string; id: string; label: string }>> {
  const db = getDb();
  const needle = `%${id}%`;
  const [docs, cats, settings] = await Promise.all([
    db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(
        or(
          eq(documents.featuredMediaId, id),
          sql`${documents.content}::text like ${needle}`,
          sql`${documents.properties}::text like ${needle}`,
          sql`coalesce(${documents.workingCopy}::text, '') like ${needle}`,
        ),
      )
      .limit(50),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(sql`coalesce(${categories.intro}::text, '') like ${needle}`),
    db.select({ key: siteSettings.key }).from(siteSettings).where(sql`${siteSettings.value}::text like ${needle}`),
  ]);
  return [
    ...docs.map((d) => ({ kind: "document", id: d.id, label: d.title || "Untitled" })),
    ...cats.map((c) => ({ kind: "category", id: c.id, label: c.name })),
    ...settings.map((s) => ({ kind: "settings", id: s.key, label: `${s.key} settings` })),
  ];
}

export async function deleteMedia(actor: Actor, id: string, options: { force?: boolean } = {}): Promise<void> {
  assertAdmin(actor);
  if (!isUuid(id)) throw notFound("Media");
  const db = getDb();
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!row) throw notFound("Media");
  const references = await findMediaReferences(id);
  if (references.length && !options.force) {
    throw new ServiceError("conflict", `This file is used in ${references.length} place(s). Remove it there first, or force-delete.`, {
      references: references.map((r) => r.label).join(", "),
    });
  }
  // Delete storage objects before the row: if any fail, the row (and thus the
  // valid keys) survives so the delete can be retried instead of orphaning objects.
  const storage = getStorage();
  const keys = [row.storageKey, ...((row.variants ?? []) as StoredVariant[]).map((v) => v.key)];
  const results = await Promise.allSettled(keys.map((key) => storage.delete(key)));
  const failed = results.flatMap((r, i) => (r.status === "rejected" ? [{ key: keys[i]!, error: r.reason }] : []));

  if (failed.length) {
    await recordAudit(actor, "media.delete_failed", "media", id, row.originalName, {
      failedKeys: failed.map((f) => f.key),
      error: failed[0]!.error instanceof Error ? failed[0]!.error.message : String(failed[0]!.error),
    });
    throw new ServiceError(
      "storage_error",
      "The file could not be fully removed from storage, so it was kept. Try deleting it again.",
      { failedKeys: failed.map((f) => f.key).join(", ") },
    );
  }

  await db.delete(media).where(eq(media.id, id));
  await recordAudit(actor, "media.delete", "media", id, row.originalName, { forced: Boolean(options.force && references.length) });
}
