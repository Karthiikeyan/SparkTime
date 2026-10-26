/**
 * Seeds structure (content types, categories, system pages, navigation).
 * Safe to re-run: never overwrites anything edited in the CMS.
 */
import { loadEnvFiles } from "./load-env";

async function main() {
  loadEnvFiles();
  const { getDb } = await import("../src/server/db/client");
  const { seedDatabase } = await import("../src/server/seed/seed");
  const { refreshSearchExtra } = await import("../src/server/services/search-index");
  const { documents } = await import("../src/server/db/schema");
  const db = getDb();
  await seedDatabase(db, (m) => console.log("  +", m));
  const all = await db.select({ id: documents.id }).from(documents);
  await refreshSearchExtra(db, all.map((d) => d.id));
  console.log("Seed complete.");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
