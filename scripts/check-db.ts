/**
 * Read-only database connectivity check: `DATABASE_URL='<url>' npm run db:check`.
 *
 * Connects the way the app does (postgres.js, prepared statements off) and times a
 * trivial query plus one real read, for the URL as given and, when it is a Supabase
 * session-pooler URL, for the transaction-pooler (port 6543) variant too. Use it to
 * check that port 6543 really works for you before pointing DATABASE_URL at it.
 * Each probe has a hard time limit, so a hang is reported instead of waiting. It
 * never writes, and never prints the URL's credentials.
 */
import postgres from "postgres";
import { loadEnvFiles } from "./load-env";
import { supabasePoolerMode, toTransactionPooler } from "../src/server/db/connection";

const PROBE_LIMIT_MS = 20_000;

function label(url: string): string {
  try {
    const { hostname, port } = new URL(url);
    const mode = supabasePoolerMode(url);
    return `${hostname}:${port || "5432"}${mode ? ` (${mode} pooler)` : ""}`;
  } catch {
    return "(unparseable URL)";
  }
}

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const value = await Promise.race([
    work(),
    new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer within ${PROBE_LIMIT_MS / 1000} s`)), PROBE_LIMIT_MS))),
  ]).finally(() => clearTimeout(timer));
  return { ms: Math.round(performance.now() - started), value };
}

async function probe(url: string): Promise<boolean> {
  console.log(`\n${label(url)}`);
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 1, onnotice: () => undefined });
  try {
    const first = await timed(() => sql`select 1 as ok`);
    console.log(`  select 1 .................... ok (${first.ms} ms, includes connecting)`);
    const second = await timed(() => sql`select count(*)::int as n from studio.documents`);
    console.log(`  count studio.documents ...... ok (${second.ms} ms, ${second.value[0]?.n} rows)`);
    const burst = await timed(() => Promise.all(Array.from({ length: 6 }, () => sql`select count(*)::int as n from studio.site_settings`)));
    console.log(`  6 queries at once ........... ok (${burst.ms} ms)`);
    return true;
  } catch (error) {
    const e = error as { code?: string; message?: string };
    console.log(`  FAILED: ${e.message ?? error}${e.code ? ` [${e.code}]` : ""}`);
    return false;
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

async function main() {
  loadEnvFiles();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const results = [await probe(url)];
  if (supabasePoolerMode(url) === "session") results.push(await probe(toTransactionPooler(url)));
  process.exit(results.every(Boolean) ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("db:check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
