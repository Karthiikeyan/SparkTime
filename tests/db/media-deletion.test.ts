import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { auditLogs, media } from "@/server/db/schema";
import type { MediaStorage } from "@/server/media/storage";
import { setStorageForTesting } from "@/server/media/storage";
import { createDocument, saveDocument } from "@/server/services/documents";
import { deleteMedia } from "@/server/services/media";
import { createAdmin, createTestDb, typeId } from "../helpers/db";

/** In-memory storage double: no real filesystem/R2 calls, and specific keys can be made to fail. */
class FakeStorage implements MediaStorage {
  readonly driver = "local" as const;
  deleted: string[] = [];
  constructor(private readonly failingKeys: Set<string> = new Set()) {}
  async put(): Promise<void> {}
  async get(): Promise<Buffer | null> {
    return null;
  }
  async delete(key: string): Promise<void> {
    if (this.failingKeys.has(key)) throw new Error(`simulated storage failure for ${key}`);
    this.deleted.push(key);
  }
  urlFor(key: string): string {
    return `/media/${key}`;
  }
}

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
});
afterAll(() => ctx.close());
afterEach(() => setStorageForTesting(null));

async function insertMedia(overrides: Partial<typeof media.$inferInsert> = {}) {
  const [row] = await db
    .insert(media)
    .values({
      kind: "image",
      storageKey: "media/2026/09/primary.webp",
      mimeType: "image/webp",
      originalName: "photo.webp",
      sizeBytes: 1000,
      variants: [
        { width: 480, height: 270, key: "media/2026/09/primary-w480.webp", size: 100 },
        { width: 960, height: 540, key: "media/2026/09/primary-w960.webp", size: 200 },
      ],
      ...overrides,
    })
    .returning();
  return row!;
}

describe("media deletion", () => {
  it("deletes the primary object and every variant on success", async () => {
    const storage = new FakeStorage();
    setStorageForTesting(storage);
    const row = await insertMedia();

    await deleteMedia(admin, row.id);

    expect(storage.deleted.sort()).toEqual(["media/2026/09/primary-w480.webp", "media/2026/09/primary-w960.webp", "media/2026/09/primary.webp"].sort());
    const remaining = await db.select().from(media).where(eq(media.id, row.id));
    expect(remaining).toHaveLength(0);
  });

  it("keeps the row and surfaces a storage_error when a storage delete fails (never a silent success)", async () => {
    const failingVariant = "media/2026/09/broken-w480.webp";
    const storage = new FakeStorage(new Set([failingVariant]));
    setStorageForTesting(storage);
    const row = await insertMedia({
      storageKey: "media/2026/09/broken.webp",
      variants: [{ width: 480, height: 270, key: failingVariant, size: 100 }],
    });

    await expect(deleteMedia(admin, row.id)).rejects.toMatchObject({ code: "storage_error" });

    // The row survives so the object keys remain valid and the delete can be retried.
    const [still] = await db.select().from(media).where(eq(media.id, row.id));
    expect(still).toBeDefined();
    expect(still!.id).toBe(row.id);

    // The successful object was removed; the failed one was not silently dropped.
    expect(storage.deleted).toEqual(["media/2026/09/broken.webp"]);

    const [failure] = await db.select().from(auditLogs).where(eq(auditLogs.action, "media.delete_failed")).orderBy(auditLogs.id);
    expect(failure).toBeDefined();
    expect(failure!.entityId).toBe(row.id);
  });

  it("preserves reference protection: a referenced asset requires force", async () => {
    const storage = new FakeStorage();
    setStorageForTesting(storage);
    const row = await insertMedia({ storageKey: "media/2026/09/referenced.webp", variants: [] });
    const { id: docId } = await createDocument(admin, { typeId: await typeId(db, "article"), title: "Uses media" });
    await saveDocument(admin, docId, { body: { featuredMediaId: row.id } });

    await expect(deleteMedia(admin, row.id)).rejects.toMatchObject({ code: "conflict" });
    const [stillThere] = await db.select().from(media).where(eq(media.id, row.id));
    expect(stillThere).toBeDefined();
    expect(storage.deleted).toEqual([]);

    await deleteMedia(admin, row.id, { force: true });
    const [gone] = await db.select().from(media).where(eq(media.id, row.id));
    expect(gone).toBeUndefined();
    expect(storage.deleted).toEqual(["media/2026/09/referenced.webp"]);
  });
});
