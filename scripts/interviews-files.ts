import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * One-round package.json files from the earlier research format, anywhere
 * under a company folder. Folders starting with "_" (archived material) and
 * node_modules are skipped.
 */
export function legacyPackages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith("_")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...legacyPackages(path));
    else if (name === "package.json") out.push(path);
  }
  return out;
}
