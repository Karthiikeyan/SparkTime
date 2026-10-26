import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_SECURE } from "@/lib/auth-cookies";
import { createSession } from "@/server/auth/session";
import { users } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { createTestDb, typeId } from "../helpers/db";

// Route handlers call revalidatePath(); there is no Next cache in tests.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

/**
 * Exercises the real route handlers (layer 2 of admin protection), bypassing
 * proxy.ts entirely — proving the API is safe even if the proxy is skipped.
 */

const ORIGIN = "https://karthikeyan.example";
let ctx: Awaited<ReturnType<typeof createTestDb>>;
let adminToken = "";
let strangerToken = "";
let articleType = "";

function request(path: string, init: { method?: string; token?: string; body?: unknown; origin?: string | null; contentType?: string } = {}) {
  const headers = new Headers();
  if (init.token) headers.set("cookie", `${SESSION_COOKIE_SECURE}=${init.token}`);
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.body !== undefined) headers.set("content-type", init.contentType ?? "application/json");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body) });
}

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

beforeAll(async () => {
  process.env.ADMIN_GITHUB_ID = "777";
  resetEnvCache();
  ctx = await createTestDb({ seed: true });
  const [owner] = await ctx.db.insert(users).values({ githubId: 777, githubLogin: "owner" }).returning();
  const [stranger] = await ctx.db.insert(users).values({ githubId: 888, githubLogin: "stranger" }).returning();
  adminToken = (await createSession(owner!.id, null)).token;
  strangerToken = (await createSession(stranger!.id, null)).token;
  articleType = await typeId(ctx.db, "article");
});
afterAll(async () => {
  delete process.env.ADMIN_GITHUB_ID;
  resetEnvCache();
  await ctx.close();
});

describe("admin API authorization", () => {
  it("rejects unauthenticated requests on every admin endpoint", async () => {
    const docs = await import("@/app/api/admin/documents/route");
    const media = await import("@/app/api/admin/media/route");
    const settings = await import("@/app/api/admin/settings/[key]/route");
    const exportRoute = await import("@/app/api/admin/export/route");
    expect((await docs.GET(request("/api/admin/documents"), params({}))).status).toBe(401);
    expect((await docs.POST(request("/api/admin/documents", { method: "POST", body: { typeId: articleType } }), params({}))).status).toBe(401);
    expect((await media.GET(request("/api/admin/media"), params({}))).status).toBe(401);
    expect((await settings.PUT(request("/api/admin/settings/identity", { method: "PUT", body: {} }), params({ key: "identity" }))).status).toBe(401);
    expect((await exportRoute.GET(request("/api/admin/export"), params({}))).status).toBe(401);
  });

  it("rejects a signed-in GitHub user who is not the owner", async () => {
    const docs = await import("@/app/api/admin/documents/route");
    expect((await docs.GET(request("/api/admin/documents", { token: strangerToken }), params({}))).status).toBe(401);
  });

  it("rejects forged/garbage session cookies", async () => {
    const docs = await import("@/app/api/admin/documents/route");
    expect((await docs.GET(request("/api/admin/documents", { token: "A".repeat(43) }), params({}))).status).toBe(401);
    expect((await docs.GET(request("/api/admin/documents", { token: "'; drop table studio.sessions; --" }), params({}))).status).toBe(401);
  });

  it("blocks cross-site mutations even with a valid owner session (CSRF)", async () => {
    const docs = await import("@/app/api/admin/documents/route");
    const evil = await docs.POST(request("/api/admin/documents", { method: "POST", token: adminToken, body: { typeId: articleType }, origin: "https://evil.example" }), params({}));
    expect(evil.status).toBe(403);
    const noOrigin = await docs.POST(request("/api/admin/documents", { method: "POST", token: adminToken, body: { typeId: articleType }, origin: null }), params({}));
    expect(noOrigin.status).toBe(403);
  });

  it("requires JSON bodies (no form-encoded CSRF payloads)", async () => {
    const docs = await import("@/app/api/admin/documents/route");
    const res = await docs.POST(request("/api/admin/documents", { method: "POST", token: adminToken, body: `typeId=${articleType}`, contentType: "application/x-www-form-urlencoded" }), params({}));
    expect(res.status).toBe(415);
  });

  it("lets the owner through and never leaks stack traces", async () => {
    const docs = await import("@/app/api/admin/documents/route");
    const created = await docs.POST(request("/api/admin/documents", { method: "POST", token: adminToken, body: { typeId: articleType, title: "Via API" } }), params({}));
    expect(created.status).toBe(200);
    const one = await import("@/app/api/admin/documents/[id]/route");
    const missing = await one.GET(request("/api/admin/documents/not-a-uuid", { token: adminToken }), params({ id: "not-a-uuid" }));
    expect(missing.status).toBe(404);
    const body = await missing.json();
    expect(JSON.stringify(body)).not.toMatch(/at \w+ \(|node_modules|stack/i);
  });

  it("refuses uploads without a session and rejects disguised files with one", async () => {
    const media = await import("@/app/api/admin/media/route");
    const form = () => {
      const fd = new FormData();
      fd.set("file", new File(["<svg onload=alert(1)>"], "evil.png", { type: "image/png" }));
      return fd;
    };
    const anon = new NextRequest(`${ORIGIN}/api/admin/media`, { method: "POST", body: form(), headers: { origin: ORIGIN } });
    expect((await media.POST(anon, params({}))).status).toBe(401);
    const owner = new NextRequest(`${ORIGIN}/api/admin/media`, { method: "POST", body: form(), headers: { origin: ORIGIN, cookie: `${SESSION_COOKIE_SECURE}=${adminToken}` } });
    expect((await media.POST(owner, params({}))).status).toBe(415);
  });

  it("does not allow deleting media without a session", async () => {
    const one = await import("@/app/api/admin/media/[id]/route");
    const res = await one.DELETE(request("/api/admin/media/11111111-1111-4111-8111-111111111111", { method: "DELETE" }), params({ id: "11111111-1111-4111-8111-111111111111" }));
    expect(res.status).toBe(401);
  });
});

describe("bulk content operations API", () => {
  const OP = "22222222-2222-4222-8222-222222222222";
  const routes = async () => ({
    run: await import("@/app/api/admin/documents/bulk/route"),
    select: await import("@/app/api/admin/documents/bulk/select/route"),
    undo: await import("@/app/api/admin/documents/bulk/undo/route"),
  });
  const runBody = (ids: string[]) => ({ operationId: OP, ids, action: { action: "trash" } });

  it("rejects anonymous, non-owner and forged sessions on every bulk endpoint", async () => {
    const r = await routes();
    for (const token of [undefined, strangerToken, "B".repeat(43)]) {
      expect((await r.run.POST(request("/api/admin/documents/bulk", { method: "POST", token, body: runBody([OP]) }), params({}))).status).toBe(401);
      expect((await r.select.POST(request("/api/admin/documents/bulk/select", { method: "POST", token, body: { selection: { kind: "filter", filter: {} } } }), params({}))).status).toBe(401);
      expect((await r.undo.POST(request("/api/admin/documents/bulk/undo", { method: "POST", token, body: { operationId: OP } }), params({}))).status).toBe(401);
    }
  });

  it("blocks cross-site and form-encoded bulk requests even for the owner", async () => {
    const r = await routes();
    expect((await r.run.POST(request("/api/admin/documents/bulk", { method: "POST", token: adminToken, body: runBody([OP]), origin: "https://evil.example" }), params({}))).status).toBe(403);
    expect((await r.run.POST(request("/api/admin/documents/bulk", { method: "POST", token: adminToken, body: runBody([OP]), origin: null }), params({}))).status).toBe(403);
    expect((await r.undo.POST(request("/api/admin/documents/bulk/undo", { method: "POST", token: adminToken, body: { operationId: OP }, origin: "https://evil.example" }), params({}))).status).toBe(403);
    expect((await r.run.POST(request("/api/admin/documents/bulk", { method: "POST", token: adminToken, body: "action=trash", contentType: "application/x-www-form-urlencoded" }), params({}))).status).toBe(415);
  });

  it("lets the owner run, preview and undo, with validation errors as 400 and no internals leaked", async () => {
    const r = await routes();
    const docs = await import("@/app/api/admin/documents/route");
    const created = await (await docs.POST(request("/api/admin/documents", { method: "POST", token: adminToken, body: { typeId: articleType, title: "Bulk via API" } }), params({}))).json() as { id: string };

    const preview = await r.select.POST(request("/api/admin/documents/bulk/select", { method: "POST", token: adminToken, body: { selection: { kind: "ids", ids: [created.id] } } }), params({}));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ ids: [created.id], byStatus: { draft: 1 } });

    const ran = await r.run.POST(request("/api/admin/documents/bulk", { method: "POST", token: adminToken, body: runBody([created.id]) }), params({}));
    expect(ran.status).toBe(200);
    expect(await ran.json()).toMatchObject({ updated: 1, undoable: true });

    const undone = await r.undo.POST(request("/api/admin/documents/bulk/undo", { method: "POST", token: adminToken, body: { operationId: OP } }), params({}));
    expect(await undone.json()).toMatchObject({ reverted: 1 });

    const bad = await r.run.POST(request("/api/admin/documents/bulk", { method: "POST", token: adminToken, body: { operationId: OP, ids: [created.id], action: { action: "drop table" } } }), params({}));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).not.toMatch(/stack|node_modules|at \w+ \(/i);
  });
});

describe("studio health check", () => {
  it("is owner-only", async () => {
    const health = await import("@/app/api/admin/health/route");
    expect((await health.GET(request("/api/admin/health"), params({}))).status).toBe(401);
    expect((await health.GET(request("/api/admin/health", { token: strangerToken }), params({}))).status).toBe(401);
    expect((await health.GET(request("/api/admin/health", { token: "x".repeat(43) }), params({}))).status).toBe(401);
  });

  it("runs the studio's reads, reports configuration as booleans and modes, and never echoes a value", async () => {
    process.env.CRON_SECRET = "cron-secret-value-that-must-not-leak";
    process.env.GITHUB_CLIENT_SECRET = "github-secret-value-that-must-not-leak";
    resetEnvCache();
    try {
      const health = await import("@/app/api/admin/health/route");
      const res = await health.GET(request("/api/admin/health", { token: adminToken }), params({}));
      expect(res.status).toBe(200);
      const text = await res.text();
      const body = JSON.parse(text) as { ok: boolean; checks: Array<{ name: string; ok: boolean }>; config: Record<string, unknown>; migrationsApplied: number; signedInAs: string };
      expect(body.ok).toBe(true);
      expect(body.checks.map((c) => c.name)).toEqual(expect.arrayContaining(["content types", "dashboard stats", "8 simultaneous queries", "import tables (migration 0004)"]));
      expect(body.migrationsApplied).toBeGreaterThanOrEqual(5);
      expect(body.config).toMatchObject({ adminGithubIdSet: true, cronSecretSet: true, githubOAuthConfigured: false, authSecretSet: true });
      expect(body.signedInAs).toBe("owner");
      for (const secret of ["cron-secret-value-that-must-not-leak", "github-secret-value-that-must-not-leak", process.env.AUTH_SECRET!, "postgres://"]) expect(text).not.toContain(secret);
    } finally {
      delete process.env.CRON_SECRET;
      delete process.env.GITHUB_CLIENT_SECRET;
      resetEnvCache();
    }
  });

  it("names the failing check and its database error code without leaking SQL", async () => {
    const { sql } = await import("drizzle-orm");
    await ctx.db.execute(sql`alter table studio.import_jobs rename to import_jobs_gone`);
    try {
      const health = await import("@/app/api/admin/health/route");
      const body = (await (await health.GET(request("/api/admin/health", { token: adminToken }), params({}))).json()) as { ok: boolean; checks: Array<{ name: string; ok: boolean; error?: string }> };
      const failed = body.checks.filter((c) => !c.ok);
      expect(body.ok).toBe(false);
      expect(failed.map((c) => c.name)).toEqual(["import tables (migration 0004)"]);
      expect(failed[0]!.error).toMatch(/does not exist/);
      expect(failed[0]!.error).not.toMatch(/select|from "studio"/i);
    } finally {
      await ctx.db.execute(sql`alter table studio.import_jobs_gone rename to import_jobs`);
    }
  });
});

describe("public API", () => {
  it("search never returns drafts or lifecycle fields", async () => {
    const search = await import("@/app/api/search/route");
    const res = await search.GET(request("/api/search?q=via"), params({}));
    const data = (await res.json()) as { results: unknown[] };
    expect(data.results).toEqual([]);
  });

  it("the session probe reveals nothing to strangers", async () => {
    const me = await import("@/app/api/auth/me/route");
    const res = await me.GET(request("/api/auth/me", { token: strangerToken }));
    expect(await res.json()).toEqual({ admin: false, quickCreate: [] });
  });

  it("the dev login is unavailable outside development", async () => {
    process.env.AUTH_DEV_LOGIN = "true";
    resetEnvCache();
    const dev = await import("@/app/api/auth/dev-login/route");
    expect((await dev.POST(request("/api/auth/dev-login", { method: "POST" }))).status).toBe(404);
    delete process.env.AUTH_DEV_LOGIN;
    resetEnvCache();
  });

  it("the cron endpoint requires its secret", async () => {
    const cron = await import("@/app/api/cron/keepalive/route");
    expect((await cron.GET(request("/api/cron/keepalive"))).status).toBe(401);
  });

  it("the cron endpoint answers 401, never 500, to wrong or multibyte secrets, and 200 to the right one", async () => {
    const cron = await import("@/app/api/cron/keepalive/route");
    process.env.CRON_SECRET = "s".repeat(12);
    resetEnvCache();
    const call = (authorization: string) => {
      const headers = new Headers({ authorization });
      return cron.GET(new NextRequest(`${ORIGIN}/api/cron/keepalive`, { headers }));
    };
    try {
      expect((await call("Bearer wrong")).status).toBe(401);
      // 12 characters, 24 bytes: equal in length as a string, different as bytes.
      expect((await call(`Bearer ${"é".repeat(12)}`)).status).toBe(401);
      expect((await call(`Bearer ${"s".repeat(12)}`)).status).toBe(200);
    } finally {
      delete process.env.CRON_SECRET;
      resetEnvCache();
    }
  });
});

describe("sign-out", () => {
  it("revokes the session and expires the __Host- cookie with attributes browsers accept", async () => {
    const [owner] = await ctx.db.insert(users).values({ githubId: 999, githubLogin: "signout" }).returning();
    const { token } = await createSession(owner!.id, null);
    const logout = await import("@/app/api/auth/logout/route");
    const res = await logout.POST(request("/api/auth/logout", { method: "POST", token }));
    expect(res.status).toBe(303);
    const cookie = res.headers.get("set-cookie") ?? "";
    // A __Host- cookie is only replaced when Secure and Path=/ are present.
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE_SECURE}=;`));
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
    expect(cookie).toMatch(/;\s*Max-Age=0/i);
    const { validateSessionToken } = await import("@/server/auth/session");
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("refuses a cross-site sign-out", async () => {
    const logout = await import("@/app/api/auth/logout/route");
    expect((await logout.POST(request("/api/auth/logout", { method: "POST", origin: "https://evil.example" }))).status).toBe(403);
  });
});
