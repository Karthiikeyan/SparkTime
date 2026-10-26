/**
 * Applies SQL migrations in ./drizzle to DATABASE_URL. Idempotent: already
 * applied migrations are tracked in drizzle.__drizzle_migrations.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnvFiles } from "./load-env";

async function main() {
  loadEnvFiles();
  const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/postgres";
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    console.log("Migrations applied.");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
