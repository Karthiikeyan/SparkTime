/**
 * Check a company's research before a human reviews it:
 *
 *   npm run interviews:validate -- research/interviews/amazon
 *
 * 1. evidence.json parses and builds (first-hand sources only, one source per
 *    account, copies sharing their original's independence group).
 * 2. import.json is exactly what the evidence produces, so a hand-edited
 *    package can't drift from the evidence.
 * 3. import.json passes the importer's own checks (independent report counts,
 *    categories, practice links, one page per role).
 *
 * Categories are checked against the default list; the importer re-checks
 * them against the live type. Exit code 1 means NOT ready: fix the evidence,
 * rebuild, don't import.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DEFAULT_INTERVIEW_CATEGORIES } from "../src/lib/interviews/guide";
import { analysisErrors, analyzeImportPackage } from "../src/lib/interviews/import-package";
import { buildCompanyImport } from "../src/lib/interviews/research";
import { legacyPackages } from "./interviews-files";

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : "unreadable"}`);
  }
}

function main(): number {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: npm run interviews:validate -- <research/interviews/company>");
    return 2;
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const name of ["README.md", "evidence.json", "import.json", "research-summary.md"]) if (!existsSync(join(dir, name))) errors.push(`Missing ${join(dir, name)}.`);
  if (!existsSync(join(dir, "evidence.json"))) return finish(errors, warnings);

  const { build, errors: buildErrors } = buildCompanyImport(readJson(join(dir, "evidence.json")));
  errors.push(...buildErrors);
  if (build && !build.pkg) errors.push("No role has enough evidence for a page, so there is nothing to import.");
  if (build?.pkg && existsSync(join(dir, "import.json"))) {
    if (JSON.stringify(readJson(join(dir, "import.json"))) !== JSON.stringify(build.pkg)) errors.push("import.json differs from what evidence.json produces. Run npm run interviews:build.");
    warnings.push(...build.issues);
    if (build.unresolved.length) warnings.push(`${build.unresolved.length} question(s) have an undetermined round and are not imported (see research-summary.md).`);
  }
  for (const p of legacyPackages(dir)) warnings.push(`${relative(dir, p)}: a one-round package from the earlier format; it is not imported. Move it into a "_" folder or delete it.`);

  if (existsSync(join(dir, "import.json"))) {
    const analysis = analyzeImportPackage(readJson(join(dir, "import.json")), DEFAULT_INTERVIEW_CATEGORIES);
    errors.push(...analysisErrors(analysis));
    warnings.push(...analysis.warnings);
    if (analysis.pkg) {
      console.log(`${analysis.pkg.company} (run ${analysis.pkg.researchRun})`);
      for (const page of analysis.pages) {
        const s = page.stats;
        console.log(`  ${page.role ?? "Company page"} → /${page.slug} · ${page.guide.accounts} accounts · ${s.rounds} rounds · ${s.questions} questions (${s.review} held for review) · ${page.advice.indexing}`);
        if (s.byCategory.length) console.log(`    ${s.byCategory.map((c) => `${c.label} ${c.count}`).join(" · ")}`);
      }
      for (const n of analysis.pkg.notIncluded) console.log(`  not included: ${n.role} — ${n.reason}`);
    }
  }
  return finish(errors, warnings);
}

function finish(errors: string[], warnings: string[]): number {
  for (const w of warnings) console.log(`  warning: ${w}`);
  for (const e of errors) console.log(`  ERROR: ${e}`);
  console.log(errors.length ? `\nNOT READY: ${errors.length} error(s). Fix the evidence and rebuild; do not import.` : "\nReady for human review. Read the role READMEs, then import import.json in Studio → Import.");
  return errors.length ? 1 : 0;
}

process.exit(main());
