import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminActor } from "@/server/auth/actor";
import { createDocument, listDocuments, lookupDocuments } from "@/server/services/documents";
import { listImportItems, listImportJobs } from "@/server/services/import/jobs";
import { listMedia } from "@/server/services/media";
import { searchAdmin } from "@/server/services/search";
import { listAudit } from "@/server/services/audit";
import { createAdmin, createTestDb, typeId } from "../helpers/db";

/**
 * The admin list endpoints turn query-string values into numbers with Number(),
 * so a direct request can send NaN, a negative or an absurdly large value.
 * Each must fall back to a sane page, not reach Postgres as `LIMIT NaN` (a 500).
 */
let ctx: Awaited<ReturnType<typeof createTestDb>>;
let admin: AdminActor;
let seededTotal = 0;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  admin = await createAdmin(ctx.db);
  const article = await typeId(ctx.db, "article");
  seededTotal = (await listDocuments(admin)).total + 3;
  for (const title of ["Zq alpha", "Zq beta", "Zq gamma"]) await createDocument(admin, { typeId: article, title });
});
afterAll(() => ctx.close());

const HOSTILE = [Number.NaN, -1, 0, Number.POSITIVE_INFINITY, 1e12];

describe("admin list endpoints tolerate hostile limit/offset values", () => {
  it.each(HOSTILE)("listDocuments(limit=%s, offset=%s)", async (value) => {
    const result = await listDocuments(admin, { limit: value, offset: value });
    expect(result.total).toBe(seededTotal);
    expect(result.items.length).toBeGreaterThanOrEqual(0);
    expect(result.items.length).toBeLessThanOrEqual(200);
  });

  it.each(HOSTILE)("lookupDocuments(limit=%s)", async (value) => {
    const items = await lookupDocuments(admin, "Zq", { limit: value });
    expect(items.length).toBeLessThanOrEqual(50);
  });

  it.each(HOSTILE)("listMedia(limit=%s, offset=%s)", async (value) => {
    await expect(listMedia(admin, { limit: value, offset: value })).resolves.toMatchObject({ total: 0 });
  });

  it.each(HOSTILE)("searchAdmin(limit=%s)", async (value) => {
    const results = await searchAdmin(admin, "Zq", value);
    expect(results.length).toBeLessThanOrEqual(30);
  });

  it.each(HOSTILE)("listAudit(limit=%s)", async (value) => {
    const rows = await listAudit(admin, value);
    expect(rows.length).toBeLessThanOrEqual(200);
  });

  it.each(HOSTILE)("listImportJobs(limit=%s, offset=%s)", async (value) => {
    await expect(listImportJobs(admin, { limit: value, offset: value })).resolves.toMatchObject({ total: 0 });
  });

  it("listImportItems rejects an unknown job before touching the numbers", async () => {
    await expect(listImportItems(admin, "00000000-0000-4000-8000-000000000000", { limit: Number.NaN })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("normal paging still works", () => {
  it("honours a valid limit and offset", async () => {
    const first = await listDocuments(admin, { q: "Zq", limit: 2, offset: 0, sort: "title" });
    const rest = await listDocuments(admin, { q: "Zq", limit: 2, offset: 2, sort: "title" });
    expect(first.items.map((d) => d.title)).toEqual(["Zq alpha", "Zq beta"]);
    expect(rest.items.map((d) => d.title)).toEqual(["Zq gamma"]);
  });
});
