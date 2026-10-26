import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_SECURE } from "@/lib/auth-cookies";
import { createSession } from "@/server/auth/session";
import { users } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { createTestDb } from "../helpers/db";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

/** The import/export route handlers, called directly (no proxy): auth, CSRF and a real flow. */

const ORIGIN = "https://karthikeyan.example";
const FAKE = "00000000-0000-4000-8000-000000000000";
let ctx: Awaited<ReturnType<typeof createTestDb>>;
let adminToken = "";
let strangerToken = "";

function request(path: string, init: { method?: string; token?: string; body?: unknown; origin?: string | null } = {}) {
  const headers = new Headers();
  if (init.token) headers.set("cookie", `${SESSION_COOKIE_SECURE}=${init.token}`);
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
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
});
afterAll(async () => {
  delete process.env.ADMIN_GITHUB_ID;
  resetEnvCache();
  await ctx.close();
});

async function routes() {
  return {
    jobs: await import("@/app/api/admin/import/jobs/route"),
    job: await import("@/app/api/admin/import/jobs/[id]/route"),
    files: await import("@/app/api/admin/import/jobs/[id]/files/route"),
    analyze: await import("@/app/api/admin/import/jobs/[id]/analyze/route"),
    document: await import("@/app/api/admin/import/jobs/[id]/document/route"),
    approve: await import("@/app/api/admin/import/jobs/[id]/approve/route"),
    run: await import("@/app/api/admin/import/jobs/[id]/run/route"),
    control: await import("@/app/api/admin/import/jobs/[id]/control/route"),
    items: await import("@/app/api/admin/import/jobs/[id]/items/route"),
    summary: await import("@/app/api/admin/export/portable/summary/route"),
    manifest: await import("@/app/api/admin/export/portable/manifest/route"),
    exportFiles: await import("@/app/api/admin/export/portable/files/route"),
    asset: await import("@/app/api/admin/export/assets/[id]/route"),
  };
}

describe("import/export API protection", () => {
  it("rejects unauthenticated and non-allowlisted callers on every endpoint", async () => {
    const r = await routes();
    const id = params({ id: FAKE });
    const calls = (token?: string) => [
      r.jobs.GET(request("/api/admin/import/jobs", { token }), params({})),
      r.jobs.POST(request("/api/admin/import/jobs", { method: "POST", token, body: {} }), params({})),
      r.job.GET(request(`/api/admin/import/jobs/${FAKE}`, { token }), id),
      r.job.DELETE(request(`/api/admin/import/jobs/${FAKE}`, { method: "DELETE", token }), id),
      r.files.POST(request(`/api/admin/import/jobs/${FAKE}/files`, { method: "POST", token, body: { files: [] } }), id),
      r.analyze.POST(request(`/api/admin/import/jobs/${FAKE}/analyze`, { method: "POST", token, body: {} }), id),
      r.document.GET(request(`/api/admin/import/jobs/${FAKE}/document?key=a`, { token }), id),
      r.approve.POST(request(`/api/admin/import/jobs/${FAKE}/approve`, { method: "POST", token, body: {} }), id),
      r.run.POST(request(`/api/admin/import/jobs/${FAKE}/run`, { method: "POST", token }), id),
      r.control.POST(request(`/api/admin/import/jobs/${FAKE}/control`, { method: "POST", token, body: { action: "cancel" } }), id),
      r.items.GET(request(`/api/admin/import/jobs/${FAKE}/items`, { token }), id),
      r.summary.POST(request("/api/admin/export/portable/summary", { method: "POST", token, body: { scope: { kind: "all" }, format: "portable" } }), params({})),
      r.manifest.POST(request("/api/admin/export/portable/manifest", { method: "POST", token, body: { scope: { kind: "all" }, format: "portable" } }), params({})),
      r.exportFiles.POST(request("/api/admin/export/portable/files", { method: "POST", token, body: { scope: { kind: "all" }, format: "portable" } }), params({})),
      r.asset.GET(request(`/api/admin/export/assets/${FAKE}`, { token }), id),
    ];
    for (const res of await Promise.all(calls())) expect(res.status).toBe(401);
    for (const res of await Promise.all(calls(strangerToken))) expect(res.status).toBe(401);
  });

  it("blocks cross-site mutations even with a valid admin session", async () => {
    const r = await routes();
    const res = await r.jobs.POST(request("/api/admin/import/jobs", { method: "POST", token: adminToken, body: {}, origin: "https://evil.example" }), params({}));
    expect(res.status).toBe(403);
    const exp = await r.manifest.POST(request("/api/admin/export/portable/manifest", { method: "POST", token: adminToken, body: { scope: { kind: "all" }, format: "portable" }, origin: null }), params({}));
    expect(exp.status).toBe(403);
  });

  it("runs a whole import and export through the HTTP layer", async () => {
    const r = await routes();
    const token = adminToken;
    const created = await r.jobs.POST(request("/api/admin/import/jobs", { method: "POST", token, body: { sourceName: "api test" } }), params({}));
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    const p = params({ id });
    const staged = await r.files.POST(request(`/api/admin/import/jobs/${id}/files`, { method: "POST", token, body: { files: [{ path: "notes/api-one.md", size: 20, text: "# API one\n\n[two](api-two.md)" }, { path: "notes/api-two.md", size: 10, text: "# API two" }] } }), p);
    expect(staged.status).toBe(200);
    const analyzed = await r.analyze.POST(request(`/api/admin/import/jobs/${id}/analyze`, { method: "POST", token, body: {} }), p);
    const plan = (await analyzed.json()) as { hash: string; summary: { create: number } };
    expect(plan.summary.create).toBe(2);
    const detail = await r.document.GET(request(`/api/admin/import/jobs/${id}/document?key=${encodeURIComponent("api-one.md")}`, { token }), p);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { markdown: string }).markdown).toContain("/article/api-two");
    expect((await r.approve.POST(request(`/api/admin/import/jobs/${id}/approve`, { method: "POST", token, body: { hash: plan.hash } }), p)).status).toBe(200);
    let status = "running";
    for (let i = 0; i < 20 && status === "running"; i++) status = ((await (await r.run.POST(request(`/api/admin/import/jobs/${id}/run`, { method: "POST", token }), p)).json()) as { status: string }).status;
    expect(status).toBe("completed");
    const items = (await (await r.items.GET(request(`/api/admin/import/jobs/${id}/items?status=done`, { token }), p)).json()) as { total: number };
    expect(items.total).toBeGreaterThan(2);

    const body = { scope: { kind: "all" }, format: "portable", includePrivate: true };
    const summary = (await (await r.summary.POST(request("/api/admin/export/portable/summary", { method: "POST", token, body }), params({}))).json()) as { documents: number };
    expect(summary.documents).toBeGreaterThan(2);
    const manifest = await r.manifest.POST(request("/api/admin/export/portable/manifest", { method: "POST", token, body }), params({}));
    expect(manifest.headers.get("cache-control")).toContain("no-store");
    const page = (await (await r.exportFiles.POST(request("/api/admin/export/portable/files", { method: "POST", token, body: { ...body, page: 0 } }), params({}))).json()) as { files: Array<{ path: string }> };
    expect(page.files.some((f) => f.path === "content/article/api-one.md")).toBe(true);
    expect((await r.asset.GET(request(`/api/admin/export/assets/${FAKE}`, { token }), params({ id: FAKE }))).status).toBe(404);
  });
});
