import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * Social card renderer. Tries to fetch a subset of Newsreader (only the
 * glyphs needed) for the title; falls back to the built-in font on any
 * failure so image generation never breaks a share.
 */
async function loadSerif(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@72,500&text=${encodeURIComponent(text)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; og-image)" },
      signal: AbortSignal.timeout(3000),
    }).then((r) => r.text());
    const url = css.match(/src: url\((https:[^)]+)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export const OG_SIZE = { width: 1200, height: 630 };

/** The logo mark as a data URI (built by scripts/make-brand-assets.mjs); null if the file can't be read, so a card still renders. */
async function loadLogo(): Promise<string | null> {
  try {
    const png = await readFile(join(process.cwd(), "public/images/logo-mark.png"));
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

/** `brand` is the product's wordmark (SparkTime), `byline` who wrote it. Flat paper and ink, one accent: no gradients. */
export async function renderOgImage(input: { title: string; eyebrow: string; brand: string; byline: string; footer?: string }) {
  const title = input.title.length > 110 ? `${input.title.slice(0, 107)}…` : input.title;
  const [serif, logo] = await Promise.all([loadSerif(`${title}${input.brand}`), loadLogo()]);
  const size = title.length > 70 ? 58 : title.length > 40 ? 68 : 80;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "#f7f5f0", color: "#17140f" }}>
        <div style={{ display: "flex", fontSize: 22, letterSpacing: 3, textTransform: "uppercase", color: "#1f5c4a" }}>{input.eyebrow}</div>
        <div style={{ display: "flex", fontFamily: serif ? "Newsreader" : undefined, fontSize: size, lineHeight: 1.08, letterSpacing: -1.5, maxWidth: 1000 }}>{title}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "2px solid #e3ded3", paddingTop: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img>
              <img src={logo} alt="" width={36} height={50} style={{ marginRight: 4 }} />
            )}
            <div style={{ display: "flex", fontFamily: serif ? "Newsreader" : undefined, fontSize: 38 }}>{input.brand}</div>
            <div style={{ display: "flex", fontSize: 22, color: "#5c564c" }}>{input.byline}</div>
          </div>
          {input.footer && <div style={{ display: "flex", fontSize: 22, color: "#5c564c" }}>{input.footer}</div>}
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: serif ? [{ name: "Newsreader", data: serif, weight: 500, style: "normal" }] : undefined },
  );
}
