import "server-only";
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { CODE_BG, ensureContrast } from "@/lib/contrast";
import { SYNTAX_THEME_DARK, SYNTAX_THEME_LIGHT } from "./syntax-themes";

/**
 * Server-side syntax highlighting. A fine-grained Shiki core with a fixed
 * language set and the JavaScript regex engine (no WASM), producing tokens —
 * not HTML — that the renderer turns into React elements. Readers download
 * zero highlighting JavaScript.
 */

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  jsx: "jsx",
  json: "json",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  python: "python",
  py: "python",
  java: "java",
  kotlin: "kotlin",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  css: "css",
  go: "go",
  rust: "rust",
  markdown: "markdown",
  md: "markdown",
  diff: "diff",
  dockerfile: "docker",
  docker: "docker",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "csharp",
  "c#": "csharp",
  xml: "xml",
  graphql: "graphql",
};

export const LANGUAGE_LABELS: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  json: "JSON",
  bash: "Shell",
  python: "Python",
  java: "Java",
  kotlin: "Kotlin",
  sql: "SQL",
  yaml: "YAML",
  html: "HTML",
  css: "CSS",
  go: "Go",
  rust: "Rust",
  markdown: "Markdown",
  diff: "Diff",
  docker: "Dockerfile",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  xml: "XML",
  graphql: "GraphQL",
};

let highlighter: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [SYNTAX_THEME_LIGHT, SYNTAX_THEME_DARK],
    langs: [
      import("@shikijs/langs/javascript"),
      import("@shikijs/langs/typescript"),
      import("@shikijs/langs/tsx"),
      import("@shikijs/langs/jsx"),
      import("@shikijs/langs/json"),
      import("@shikijs/langs/bash"),
      import("@shikijs/langs/python"),
      import("@shikijs/langs/java"),
      import("@shikijs/langs/kotlin"),
      import("@shikijs/langs/sql"),
      import("@shikijs/langs/yaml"),
      import("@shikijs/langs/html"),
      import("@shikijs/langs/css"),
      import("@shikijs/langs/go"),
      import("@shikijs/langs/rust"),
      import("@shikijs/langs/markdown"),
      import("@shikijs/langs/diff"),
      import("@shikijs/langs/docker"),
      import("@shikijs/langs/c"),
      import("@shikijs/langs/cpp"),
      import("@shikijs/langs/csharp"),
      import("@shikijs/langs/xml"),
      import("@shikijs/langs/graphql"),
    ],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

export type HighlightedCode = { language: string | null; label: string | null; lines: Array<Array<{ content: string; style: Record<string, string> }>> };

const MAX_HIGHLIGHT_CHARS = 60_000;

export async function highlightCode(code: string, language: string | null): Promise<HighlightedCode> {
  const lang = language ? LANGUAGE_ALIASES[language] : undefined;
  const plain = (): HighlightedCode => ({
    language: lang ?? null,
    label: lang ? LANGUAGE_LABELS[lang] ?? null : null,
    lines: code.split("\n").map((line) => [{ content: line, style: {} }]),
  });
  if (!lang || code.length > MAX_HIGHLIGHT_CHARS) return plain();
  try {
    const h = await getHighlighter();
    const result = h.codeToTokens(code, { lang, themes: { light: SYNTAX_THEME_LIGHT.name!, dark: SYNTAX_THEME_DARK.name! } });
    return {
      language: lang,
      label: LANGUAGE_LABELS[lang] ?? null,
      lines: result.tokens.map((line: ThemedToken[]) =>
        line.map((token) => ({ content: token.content, style: toStyle(token.htmlStyle) })),
      ),
    };
  } catch {
    return plain();
  }
}

/**
 * Only colour-related style keys survive (defence in depth; values are theme-derived).
 * Colours are lifted to WCAG AA (4.5:1) against the site's code background: the
 * themes' comment colours measured 4.31:1 (light) and 4.49:1 (dark) on it.
 */
export function toStyle(style: ThemedToken["htmlStyle"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style || typeof style !== "object") return out;
  for (const [key, value] of Object.entries(style)) {
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(value)) continue;
    if (key === "color") out.color = ensureContrast(value, CODE_BG.light);
    else if (key === "--shiki-dark") out["--shiki-dark"] = ensureContrast(value, CODE_BG.dark);
  }
  return out;
}
