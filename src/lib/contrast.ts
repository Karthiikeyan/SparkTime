/**
 * WCAG 2.x contrast helpers. Used to keep syntax-highlighting tokens readable on
 * the site's own code background: Shiki's themes are tuned for white/near-black,
 * and a few of their colours (comments, mostly) fall just under 4.5:1 on the
 * warmer paper and ink backgrounds.
 */

/** Must match --code-bg in src/app/globals.css (light and dark). tests/unit/contrast.test.ts checks this. */
export const CODE_BG = { light: "#fbfaf7", dark: "#151412" } as const;

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return 0;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Returns `fg` unchanged when it already meets `min` against `bg`; otherwise the
 * closest colour on the line from `fg` towards black (light background) or white
 * (dark background) that does. Hue is kept, so a theme's palette stays recognisable.
 * Alpha in 8-digit colours is dropped from the adjusted value only.
 */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  if (!f || !b || contrastRatio(fg, bg) >= min) return fg;
  const target: Rgb = luminance(b) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const mixed = toHex(f.map((v, i) => v + (target[i]! - v) * t) as Rgb);
    if (contrastRatio(mixed, bg) >= min) return mixed;
  }
  return toHex(target);
}
