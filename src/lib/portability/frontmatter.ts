/**
 * YAML front matter. Parsed with js-yaml's CORE schema: strings, numbers,
 * booleans, null, lists and maps only — no custom tags, no timestamps-as-Date
 * (dates stay strings and are validated by the field mapper). The block and
 * the resulting value tree are both bounded, which also defuses alias
 * ("billion laughs") amplification.
 */
import { load, CORE_SCHEMA, YAMLException } from "js-yaml";
import { IMPORT_LIMITS } from "./limits";

export type FrontmatterResult =
  | { kind: "none"; body: string }
  | { kind: "ok"; data: Record<string, unknown>; body: string }
  | { kind: "error"; message: string; body: string };

const OPEN = /^﻿?---[ \t]*\r?\n/;
const TOML_OPEN = /^﻿?\+\+\+[ \t]*\r?\n/;

function countNodes(value: unknown, budget: { left: number }, depth = 0): void {
  if (--budget.left < 0) throw new Error("too many values");
  if (depth > 20) throw new Error("nested too deeply");
  if (Array.isArray(value)) for (const item of value) countNodes(item, budget, depth + 1);
  else if (value && typeof value === "object") for (const item of Object.values(value)) countNodes(item, budget, depth + 1);
}

export function splitFrontmatter(source: string): FrontmatterResult {
  if (TOML_OPEN.test(source)) {
    return { kind: "error", message: "TOML front matter (+++) is not supported. Convert it to YAML (---).", body: source };
  }
  const open = OPEN.exec(source);
  if (!open) return { kind: "none", body: source.replace(/^﻿/, "") };
  const rest = source.slice(open[0].length);
  const close = /^(?:---|\.\.\.)[ \t]*$/m.exec(rest);
  if (!close) return { kind: "error", message: "Front matter starts with --- but is never closed.", body: source };
  const yaml = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length).replace(/^\r?\n/, "");
  if (new TextEncoder().encode(yaml).length > IMPORT_LIMITS.maxFrontmatterBytes) {
    return { kind: "error", message: `Front matter is larger than ${IMPORT_LIMITS.maxFrontmatterBytes / 1024} KB.`, body };
  }
  if (!yaml.trim()) return { kind: "ok", data: {}, body };
  let data: unknown;
  try {
    data = load(yaml, { schema: CORE_SCHEMA, json: true });
  } catch (error) {
    const reason = error instanceof YAMLException ? (error.reason || error.message) : "invalid YAML";
    const line = error instanceof YAMLException && error.mark ? ` (line ${error.mark.line + 2})` : "";
    return { kind: "error", message: `Front matter is not valid YAML${line}: ${reason}.`, body };
  }
  if (data === null || data === undefined) return { kind: "ok", data: {}, body };
  if (typeof data !== "object" || Array.isArray(data)) {
    return { kind: "error", message: "Front matter must be a set of key: value pairs.", body };
  }
  try {
    countNodes(data, { left: IMPORT_LIMITS.maxFrontmatterNodes });
  } catch (error) {
    return { kind: "error", message: `Front matter is too complex (${error instanceof Error ? error.message : "limit exceeded"}).`, body };
  }
  return { kind: "ok", data: data as Record<string, unknown>, body };
}
