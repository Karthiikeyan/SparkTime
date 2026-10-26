/**
 * Turn a company's candidate experiences into what Studio imports:
 *
 *   npm run interviews:build -- research/interviews/amazon           # writes import.json and the READMEs
 *   npm run interviews:build -- research/interviews/amazon --check   # writes nothing; fails if the files are stale
 *
 * Reads <company>/evidence.json (the experiences: who said what, in which
 * round, with verbatim quotes) and writes:
 *
 *   <company>/import.json          the company page + one guide per role with enough evidence
 *   <company>/research-summary.md  counts, what becomes a page and what doesn't, review items
 *   <company>/<role>/README.md     every role: sequences, rounds and each question, for review
 *
 * Nothing here touches the database or the network.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildCompanyImport } from "../src/lib/interviews/research";
import { renderRoleReadme, renderSummary } from "../src/lib/interviews/research-report";
import { legacyPackages } from "./interviews-files";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function main(): number {
  const dir = process.argv[2];
  const check = process.argv.includes("--check");
  if (!dir || dir.startsWith("--")) {
    console.error("Usage: npm run interviews:build -- <research/interviews/company> [--check]");
    return 2;
  }
  const evidencePath = join(dir, "evidence.json");
  if (!existsSync(evidencePath)) {
    console.error(`Missing ${evidencePath}.`);
    return 2;
  }
  const { build, errors } = buildCompanyImport(JSON.parse(readFileSync(evidencePath, "utf8")));
  if (!build) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    return 1;
  }

  const outputs = new Map<string, string>();
  if (build.pkg) outputs.set(join(dir, "import.json"), json(build.pkg));
  for (const r of build.roles) outputs.set(join(dir, r.slug, "README.md"), renderRoleReadme(build, r));
  outputs.set(join(dir, "research-summary.md"), renderSummary(build));

  const stale: string[] = [];
  for (const [path, content] of outputs) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === content) continue;
    stale.push(relative(dir, path));
    if (!check) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content);
    }
  }
  if (!build.pkg && existsSync(join(dir, "import.json"))) {
    stale.push("import.json (no role has enough evidence for a page any more)");
    if (!check) rmSync(join(dir, "import.json"));
  }
  for (const p of legacyPackages(dir)) console.log(`warning: ${relative(dir, p)} is a one-round package from the earlier format. Studio imports import.json now; move it into a folder starting with "_" or delete it.`);

  for (const issue of build.issues) console.log(`note: ${issue}`);
  const pages = build.roles.filter((r) => r.page);
  console.log(`${build.company}: ${build.roles.length} roles found; pages: the company page + ${pages.map((r) => `${r.role} (${r.rounds.length} rounds, ${r.questions} questions)`).join(", ") || "none"}.`);
  for (const r of build.roles.filter((x) => !x.page)) console.log(`  no page for ${r.role}: ${r.reason}`);
  if (check) {
    for (const s of stale) console.log(`  stale: ${s}`);
    console.log(stale.length ? "\nOut of date: run npm run interviews:build." : "Up to date.");
    return stale.length ? 1 : 0;
  }
  console.log(stale.length ? `Wrote ${stale.length} files.` : "Nothing changed.");
  return 0;
}

process.exit(main());
