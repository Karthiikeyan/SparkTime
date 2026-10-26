import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { env } from "../env";
import { poolSettings } from "./connection";
import * as schema from "./schema";

/**
 * Driver-agnostic database handle. Production and local development use
 * postgres.js (Supabase in production, the PGlite socket server locally);
 * tests inject an in-process PGlite instance through setDbForTesting().
 * Nothing outside the repository/service layer imports this module.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type GlobalDb = { __studioDb?: Db; __studioSql?: postgres.Sql };
const globalForDb = globalThis as unknown as GlobalDb;

let testOverride: Db | null = null;

export function getDb(): Db {
  if (testOverride) return testOverride;
  if (!globalForDb.__studioDb) {
    const config = env();
    // One connection per running instance on Supabase's session pooler, but not while building (see connection.ts).
    const pool = poolSettings(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX, idleTimeout: config.DATABASE_IDLE_TIMEOUT }, { building: config.NEXT_PHASE === "phase-production-build" });
    if (pool.capped) console.info(`[db] Supabase session pooler detected: using ${pool.max} connection per instance (configured ${config.DATABASE_POOL_MAX}, idle timeout ${pool.idleTimeout}s).`);
    const sql = postgres(config.DATABASE_URL, {
      max: pool.max,
      // Supabase's Transaction Pooler (Supavisor) does not support prepared statements
      // or connection-level SET commands (including the default search_path startup message).
      // connection_timeout is the postgres.js option name; connect_timeout is an alias.
      prepare: false,
      idle_timeout: pool.idleTimeout,
      connect_timeout: 10,
      // Do not send "SET search_path" on connect — Supavisor hangs on it in transaction mode.
      // All queries use fully-qualified schema names (studio.*) so no search_path is needed.
      connection: { search_path: "" },
      onnotice: () => undefined,
    });
    globalForDb.__studioSql = sql;
    globalForDb.__studioDb = drizzle(sql, { schema });
  }
  return globalForDb.__studioDb;
}

export function setDbForTesting(db: Db | null): void {
  testOverride = db;
}

export { schema };
