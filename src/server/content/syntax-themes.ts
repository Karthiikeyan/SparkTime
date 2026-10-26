import "server-only";
import type { ThemeRegistrationRaw } from "shiki/core";

/**
 * Code colours: four, as in the design. Types and identifiers in the accent
 * green, keywords in rust, strings in ochre, comments muted; everything else
 * (names, numbers, punctuation, operators) in plain ink. Each colour clears
 * 4.5:1 on --code-bg in its theme (tests/unit/contrast.test.ts).
 */
type Palette = { ink: string; type: string; keyword: string; string: string; comment: string };

export const SYNTAX_LIGHT: Palette = { ink: "#17140f", type: "#1f5c4a", keyword: "#8a3b1f", string: "#7a5a12", comment: "#6e675c" };
export const SYNTAX_DARK: Palette = { ink: "#f2efe8", type: "#7bc4a6", keyword: "#e3a98b", string: "#e2c79b", comment: "#a39b8c" };

function theme(name: string, type: "light" | "dark", p: Palette, background: string): ThemeRegistrationRaw {
  return {
    name,
    type,
    colors: { "editor.background": background, "editor.foreground": p.ink },
    fg: p.ink,
    bg: background,
    settings: [
      { settings: { foreground: p.ink, background } },
      { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: p.comment } },
      { scope: ["string", "punctuation.definition.string", "constant.other.symbol"], settings: { foreground: p.string } },
      {
        scope: ["keyword", "storage", "storage.type.primitive", "storage.modifier", "constant.language", "variable.language", "keyword.control"],
        settings: { foreground: p.keyword },
      },
      // Operators and punctuation stay ink: only words are coloured.
      { scope: ["keyword.operator", "punctuation", "meta.brace"], settings: { foreground: p.ink } },
      {
        scope: [
          "entity.name.type",
          "entity.name.class",
          "entity.name.namespace",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
          "storage.type.java",
          "storage.type.generic",
          "storage.type.object",
          "meta.type.annotation",
        ],
        settings: { foreground: p.type },
      },
    ],
  };
}

export const SYNTAX_THEME_LIGHT = theme("sparklet-light", "light", SYNTAX_LIGHT, "#fbfaf7");
export const SYNTAX_THEME_DARK = theme("sparklet-dark", "dark", SYNTAX_DARK, "#151412");
