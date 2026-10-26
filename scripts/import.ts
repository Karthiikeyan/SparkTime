/**
 * npm run import -- ./exports/<timestamp>/bundle.json
 *
 * Restores a bundle produced by `npm run export` into an EMPTY database
 * (run `npm run db:migrate` first). It refuses to run if the database already
 * contains documents — it never overwrites or deletes anything.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { loadEnvFiles } from "./load-env";

type Row = Record<string, unknown>;

/** JSON has no dates: turn ISO strings back into Date objects for *At columns. */
function revive(rows: Row[]): Row[] {
  return rows.map((row) => {
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = /At$/.test(key) && typeof value === "string" ? new Date(value) : value;
    }
    return out;
  });
}

async function main() {
  loadEnvFiles();
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run import -- <path to bundle.json>");
  const bundle = JSON.parse(readFileSync(file, "utf8")) as Record<string, Row[]> & { format?: string; version?: number };
  if (bundle.format !== "karthikeyan-a-studio-export") throw new Error("Not a studio export bundle.");

  const { getDb } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const db = getDb();

  const existing = await db.select({ id: s.documents.id }).from(s.documents).limit(1);
  if (existing.length) throw new Error("The target database already has documents. Import only into an empty, freshly migrated database.");

  await db.transaction(async (tx) => {
    // Seeded rows (if any) would collide; the target must be empty of content structure too.
    await tx.delete(s.navigationItems);
    await tx.delete(s.siteSettings);
    await tx.delete(s.categories);
    await tx.delete(s.contentTypes);

    const insert = async (table: Parameters<typeof tx.insert>[0], rows: Row[] | undefined) => {
      const list = revive(rows ?? []);
      for (let i = 0; i < list.length; i += 200) {
        const chunk = list.slice(i, i + 200);
        if (chunk.length) await tx.insert(table).values(chunk as never);
      }
    };

    await insert(s.contentTypes, bundle.contentTypes);
    await insert(s.contentTypeFields, bundle.contentTypeFields);
    // Categories: insert without parents first, then restore the tree.
    const categories = bundle.categories ?? [];
    await insert(s.categories, categories.map((c) => ({ ...c, parentId: null })));
    for (const c of categories) {
      if (c.parentId) await tx.update(s.categories).set({ parentId: c.parentId as string }).where(eq(s.categories.id, c.id as string));
    }
    await insert(s.tags, bundle.tags);
    await insert(s.media, (bundle.media ?? []).map((m) => ({ ...m, uploadedBy: null })));
    await insert(s.documents, (bundle.documents ?? []).map((d) => ({ ...d, authorId: null })));
    await insert(s.documentCategories, bundle.documentCategories);
    await insert(s.documentTags, bundle.documentTags);
    await insert(s.documentRelations, bundle.documentRelations);
    await insert(s.collectionItems, bundle.collectionItems);
    const nav = bundle.navigationItems ?? [];
    await insert(s.navigationItems, nav.filter((n) => !n.parentId));
    await insert(s.navigationItems, nav.filter((n) => n.parentId));
    await insert(s.siteSettings, bundle.siteSettings);
    await insert(s.redirects, bundle.redirects);
  });

  console.log(`Imported ${(bundle.documents ?? []).length} documents from ${file}.`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Import failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
