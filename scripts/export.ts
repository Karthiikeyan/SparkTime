/**
 * npm run export
 *
 * Writes ./exports/<timestamp>/
 *   bundle.json      — lossless: every content table (restore with `npm run import`)
 *   markdown/…/*.md  — one file per document with YAML front matter
 *   media.json       — media manifest (object keys + public URLs) for copying R2 objects
 *
 * Media binaries live in R2 (or .data/media locally); copy them with any S3
 * tool (e.g. `rclone copy r2:bucket ./media`) — they are not duplicated here.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvFiles } from "./load-env";

async function main() {
  loadEnvFiles();
  const { buildExportBundle, bundleToMarkdownFiles } = await import("../src/server/services/export");
  const { siteUrl } = await import("../src/server/env");
  const { getStorage } = await import("../src/server/media/storage");

  const bundle = await buildExportBundle();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join("exports", stamp);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "bundle.json"), JSON.stringify(bundle, null, 2));
  const files = bundleToMarkdownFiles(bundle, siteUrl());
  for (const file of files) {
    const target = join(dir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  let storage: ReturnType<typeof getStorage> | null = null;
  try {
    storage = getStorage();
  } catch {
    storage = null;
  }
  writeFileSync(
    join(dir, "media.json"),
    JSON.stringify(
      bundle.media.map((m) => ({ id: m.id, key: m.storageKey, variants: m.variants, name: m.originalName, url: storage?.urlFor(m.storageKey) ?? null })),
      null,
      2,
    ),
  );

  console.log(`Exported ${bundle.documents.length} documents, ${bundle.categories.length} categories, ${bundle.tags.length} tags, ${bundle.documentRelations.length} relations`);
  console.log(`→ ${dir}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Export failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
