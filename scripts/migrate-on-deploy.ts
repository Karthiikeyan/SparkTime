/**
 * Runs pending migrations during a Vercel production build, using the same
 * database the deployed app will use, so a deploy can never ship code that
 * expects tables the database doesn't have. Skipped for preview builds and
 * local builds. A failed migration fails the build, which leaves the previous
 * deployment live. Migrations are idempotent (tracked in drizzle.__drizzle_migrations).
 *
 * Connection: DATABASE_MIGRATION_URL if set, otherwise DATABASE_URL. The
 * running deployment's functions can hold every slot of Supabase's session
 * pooler (15 clients), which used to fail the build at once with
 * "(EMAXCONNSESSION) max clients reached". Connection and capacity failures,
 * and an attempt that hangs, are now retried with backoff against the same
 * URL. Real migration errors still fail immediately.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { supabasePoolerMode, withConnectionRetry } from "../src/server/db/connection";

/** Host, port and pooler mode only: never the credentials. */
function describeTarget(url: string): string {
  try {
    const { hostname, port } = new URL(url);
    const mode = supabasePoolerMode(url);
    return `${hostname}:${port || "5432"}${mode ? ` (Supabase ${mode} pooler)` : ""}`;
  } catch {
    return "(unparseable URL)";
  }
}

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`Skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
    return;
  }
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for this build, so migrations can't run.");
  await withConnectionRetry(async (signal) => {
    console.log(`Applying migrations via ${describeTarget(url)}…`);
    const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => undefined });
    // A timed-out attempt must give its connection back at once: a stuck client holds a pooler slot
    // and keeps this process alive.
    signal.addEventListener("abort", () => void sql.end({ timeout: 0 }).catch(() => undefined));
    try {
      await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    } finally {
      await sql.end({ timeout: signal.aborted ? 0 : 5 }).catch(() => undefined);
    }
  });
  console.log("Migrations applied.");
}

/** drizzle wraps driver errors as "Failed query"; the useful part is in the cause chain. */
function describe(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    const { message, code } = e as { message?: string; code?: string };
    parts.push(code ? `${message} [${code}]` : String(message ?? e));
  }
  return parts.join("\n  caused by: ");
}

// Exit explicitly: nothing may keep the build waiting on a leftover database socket.
main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("Migration failed:", describe(error));
    process.exit(1);
  },
);
