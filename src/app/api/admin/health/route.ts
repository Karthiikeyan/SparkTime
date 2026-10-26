import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { describeDatabaseError, supabasePoolerMode } from "@/server/db/connection";
import { env, isSecureOrigin } from "@/server/env";
import { adminRoute } from "@/server/http/route";
import { unreadCount } from "@/server/services/contact";
import { listContentTypes } from "@/server/services/content-types";
import { dashboardStats, listDocuments, placeholderDocuments } from "@/server/services/documents";
import { loadAllSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Check = { name: string; ok: boolean; ms: number; error?: string };

async function run(name: string, work: () => Promise<unknown>): Promise<Check> {
  const started = performance.now();
  try {
    await work();
    return { name, ok: true, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { name, ok: false, ms: Math.round(performance.now() - started), error: describeDatabaseError(error) };
  }
}

/**
 * Owner-only diagnostics for "the studio shows an unexpected problem": production hides server
 * errors from the browser (React error #441), so this runs the same reads the studio makes on
 * every page, one by one, and reports which fail and why. It also reports configuration as
 * present/absent booleans and modes only (never a value), and the number of applied migrations.
 */
export const GET = adminRoute(async ({ actor }) => {
  const config = env();
  const db = getDb();
  const checks: Check[] = [];
  // Same reads as the studio layout and the Desk page, in the same order, but sequential.
  checks.push(await run("content types", () => listContentTypes()));
  checks.push(await run("settings", () => loadAllSettings()));
  checks.push(await run("unread messages", () => unreadCount(actor)));
  checks.push(await run("dashboard stats", () => dashboardStats(actor)));
  checks.push(await run("recent documents", () => listDocuments(actor, { limit: 8 })));
  checks.push(await run("placeholder documents", () => placeholderDocuments(actor)));
  // The Desk page issues about eight reads at once; this reproduces that burst on its own.
  checks.push(await run("8 simultaneous queries", () => Promise.all(Array.from({ length: 8 }, () => db.execute(sql`select count(*) from studio.documents`)))));
  let applied: number | null = null;
  checks.push(
    await run("migrations table", async () => {
      const result = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
      const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{ n: number }>;
      applied = Number(rows[0]?.n ?? 0);
    }),
  );
  checks.push(await run("import tables (migration 0004)", () => db.execute(sql`select count(*) from studio.import_jobs`)));

  return {
    ok: checks.every((c) => c.ok),
    checks,
    migrationsApplied: applied,
    migrationsExpected: 6,
    config: {
      poolerMode: supabasePoolerMode(config.DATABASE_URL) ?? "not a Supabase pooler URL",
      poolMaxConfigured: config.DATABASE_POOL_MAX,
      idleTimeoutConfigured: config.DATABASE_IDLE_TIMEOUT,
      onVercel: config.VERCEL === "1",
      siteUrlIsHttps: isSecureOrigin(),
      adminGithubIdSet: Boolean(config.ADMIN_GITHUB_ID),
      adminGithubLoginSet: Boolean(config.ADMIN_GITHUB_LOGIN),
      githubOAuthConfigured: Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
      authSecretSet: Boolean(config.AUTH_SECRET),
      cronSecretSet: Boolean(config.CRON_SECRET),
      r2Configured: Boolean(config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY && config.R2_BUCKET && config.R2_PUBLIC_URL),
      nodeEnv: config.NODE_ENV,
    },
    signedInAs: actor.login,
  };
});
