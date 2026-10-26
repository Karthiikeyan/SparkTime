/**
 * Builds every logo file the site uses from the one source image,
 * public/images/Logo.png (the dark-green pen nib on a transparent background).
 *
 *   node scripts/make-brand-assets.mjs
 *
 * Outputs (all committed, so a deploy never needs to run this):
 *   public/images/logo-mark.png        trimmed mark for the header and footer (light theme)
 *   public/images/logo-mark-dark.png   the same mark in the dark theme's accent colour
 *   public/images/icon-192.png         manifest icons, on the paper background
 *   public/images/icon-512.png
 *   src/app/icon.png                   the browser-tab icon (512 px; browsers scale it down)
 *   src/app/apple-icon.png             home-screen icon (180 px)
 *   src/app/favicon.ico                16/32/48 px, for crawlers and old browsers that ask for /favicon.ico
 *
 * The tab and home-screen icons sit on the light paper colour so the dark-green mark stays
 * readable in a dark browser theme too.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "public/images/Logo.png");
const PAPER = { r: 0xf7, g: 0xf5, b: 0xf0, alpha: 1 };
const DARK_ACCENT = { r: 0x7b, g: 0xc4, b: 0xa6 };

/** The mark cropped to its visible pixels. */
const trimmed = await sharp(source).trim({ threshold: 10 }).png().toBuffer();
const trimmedMeta = await sharp(trimmed).metadata();
console.log(`mark: ${trimmedMeta.width}×${trimmedMeta.height}`);

const out = (path) => resolve(root, path);

// Header/footer mark: 3× a 40 px display height.
const MARK_HEIGHT = 240;
const mark = await sharp(trimmed).resize({ height: MARK_HEIGHT }).png({ compressionLevel: 9 }).toBuffer();
await sharp(mark).toFile(out("public/images/logo-mark.png"));

// Same silhouette in the dark theme's accent: keep the alpha channel, replace the colour.
const { width, height } = await sharp(mark).metadata();
const alpha = await sharp(mark).ensureAlpha().extractChannel(3).toBuffer();
await sharp({ create: { width, height, channels: 3, background: DARK_ACCENT } })
  .joinChannel(alpha)
  .png({ compressionLevel: 9 })
  .toFile(out("public/images/logo-mark-dark.png"));

/** A square icon: the mark centred on the paper colour, `fill` of the side tall. */
async function square(size, { fill = 0.66, radius = 0 } = {}) {
  const inner = await sharp(trimmed)
    .resize({ height: Math.round(size * fill), fit: "inside", width: Math.round(size * fill) })
    .toBuffer();
  const flat = await sharp({ create: { width: size, height: size, channels: 4, background: PAPER } })
    .composite([{ input: inner, gravity: "centre" }])
    .png()
    .toBuffer();
  if (!radius) return sharp(flat).png({ compressionLevel: 9 }).toBuffer();
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}"/></svg>`);
  return sharp(flat).composite([{ input: mask, blend: "dest-in" }]).png({ compressionLevel: 9 }).toBuffer();
}

// Rounded corners on the large icon (tab, manifest); the iOS icon is square because iOS rounds it itself.
const icon512 = await square(512, { radius: 112 });
writeFileSync(out("src/app/icon.png"), icon512);
writeFileSync(out("public/images/icon-512.png"), icon512);
writeFileSync(out("public/images/icon-192.png"), await square(192, { radius: 42 }));
writeFileSync(out("src/app/apple-icon.png"), await square(180));

// favicon.ico: an ICO container holding PNG images.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => square(s, { fill: 0.78, radius: Math.round(s * 0.22) })));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((png, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(sizes[i], 0); // width
  entry.writeUInt8(sizes[i], 1); // height
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
writeFileSync(out("src/app/favicon.ico"), Buffer.concat([header, ...entries, ...images]));
console.log("brand assets written");
