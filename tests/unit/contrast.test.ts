import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CODE_BG, contrastRatio, ensureContrast } from "@/lib/contrast";
import { highlightCode } from "@/server/content/highlight";

describe("contrast helpers", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#66707b", "#f1ede4")).toBeCloseTo(4.31, 1);
  });

  it("leaves passing colours alone and lifts failing ones just enough", () => {
    expect(ensureContrast("#0e1116", CODE_BG.light)).toBe("#0e1116");
    const light = ensureContrast("#66707b", CODE_BG.light);
    const dark = ensureContrast("#768390", CODE_BG.dark);
    expect(contrastRatio(light, CODE_BG.light)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark, CODE_BG.dark)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light, CODE_BG.light)).toBeLessThan(5.5);
  });

  it("keeps CODE_BG in step with --code-bg in globals.css", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const values = [...css.matchAll(/--code-bg:\s*(#[0-9a-f]{3,8})/gi)].map((m) => m[1]!.toLowerCase());
    expect(values).toContain(CODE_BG.light);
    expect(values).toContain(CODE_BG.dark);
  });
});

describe("callout labels", () => {
  // Callouts tint the page background with 5% of their colour (renderer.tsx: bg-success/5 …);
  // their 11px uppercase label is set in that colour, so it needs 4.5:1 on the tint.
  const css = readFileSync("src/app/globals.css", "utf8");
  // The light theme's tokens are each token's first definition in the file.
  const token = (block: string, name: string) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  const tint = (bg: string, fg: string, t: number) => {
    const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [a, b] = [p(bg), p(fg)];
    return `#${a.map((v, i) => Math.round(v * (1 - t) + b[i]! * t).toString(16).padStart(2, "0")).join("")}`;
  };
  for (const name of ["info", "success", "warning"]) {
    it(`${name} meets 4.5:1 on its own tint in the light theme`, () => {
      const bg = token(css, "bg")!;
      const fg = token(css, name)!;
      expect(contrastRatio(fg, tint(bg, fg, 0.05))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("syntax highlighting contrast", () => {
  const samples: Array<[string, string]> = [
    ["java", '// a comment\n/** doc */\npublic final class A { @Override public String toString() { return "x" + 1; } }'],
    ["typescript", "// comment\nconst x: number = 1; /* block */ export type T = { a?: string };"],
    ["sql", "-- comment\nSELECT id, name FROM users WHERE id = 1 ORDER BY name;"],
    ["bash", "# comment\nexport A=1 && echo \"$A\" | grep x"],
    ["yaml", "# comment\nkey: value\nlist:\n  - 1"],
  ];
  for (const [lang, code] of samples) {
    it(`every ${lang} token meets 4.5:1 in both themes`, async () => {
      const out = await highlightCode(code, lang);
      for (const line of out.lines) for (const token of line) {
        if (token.style.color) expect(contrastRatio(token.style.color, CODE_BG.light), `${token.content} light`).toBeGreaterThanOrEqual(4.5);
        if (token.style["--shiki-dark"]) expect(contrastRatio(token.style["--shiki-dark"], CODE_BG.dark), `${token.content} dark`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
