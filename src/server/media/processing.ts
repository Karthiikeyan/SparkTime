import "server-only";
import sharp, { type Metadata } from "sharp";

/**
 * Image processing with defensive limits:
 *  - decode is capped at 40 MP (decompression-bomb guard),
 *  - the *decoded* format must be in our allowlist (libvips sniffs bytes
 *    itself; this rejects anything that slipped past signature checks),
 *  - EXIF orientation is applied and ALL metadata (EXIF/GPS/XMP) is stripped,
 *  - output is always re-encoded WebP (animated GIF → animated WebP).
 */

sharp.cache(false);
sharp.concurrency(1);

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_WIDTH = 2400;
export const VARIANT_WIDTHS = [480, 960, 1440] as const;
const DECODED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "heif", "avif"]);

export type ProcessedImage = {
  primary: { buffer: Buffer; width: number; height: number };
  variants: Array<{ width: number; height: number; buffer: Buffer }>;
  animated: boolean;
  placeholder: string;
  dominantColor: string;
  ext: "webp";
};

export class ImageProcessingError extends Error {}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).metadata();
  } catch {
    throw new ImageProcessingError("The image could not be read. It may be corrupt or too large.");
  }
  if (!meta.format || !DECODED_FORMATS.has(meta.format)) throw new ImageProcessingError("Unsupported image format.");
  if (!meta.width || !meta.height) throw new ImageProcessingError("The image has no dimensions.");
  // Check the header's claimed size before decoding a single pixel.
  if (meta.width * (meta.pageHeight ?? meta.height) > MAX_INPUT_PIXELS) throw new ImageProcessingError("The image is too large (max 40 megapixels).");
  try {
    return await encode(input, meta);
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    throw new ImageProcessingError("The image could not be processed. It may be corrupt.");
  }
}

async function encode(input: Buffer, meta: Metadata): Promise<ProcessedImage> {
  if (!meta.width || !meta.height) throw new ImageProcessingError("The image has no dimensions.");

  const animated = (meta.pages ?? 1) > 1 && (meta.format === "gif" || meta.format === "webp");
  const base = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated }).rotate();

  const primaryPipeline = base().resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 82, effort: 4 });
  const { data: primaryBuffer, info } = await primaryPipeline.toBuffer({ resolveWithObject: true });
  const pageHeight = animated && meta.pageHeight ? Math.round((meta.pageHeight * info.width) / meta.width) : info.height;

  const variants: ProcessedImage["variants"] = [];
  if (!animated) {
    for (const width of VARIANT_WIDTHS) {
      if (width >= info.width) continue;
      const { data, info: vInfo } = await base().resize({ width }).webp({ quality: 80, effort: 4 }).toBuffer({ resolveWithObject: true });
      variants.push({ width: vInfo.width, height: vInfo.height, buffer: data });
    }
  }

  const tiny = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate().resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
  const stats = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).stats();
  const { r, g, b } = stats.dominant;
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

  return {
    primary: { buffer: primaryBuffer, width: info.width, height: pageHeight },
    variants,
    animated,
    placeholder: `data:image/webp;base64,${tiny.toString("base64")}`,
    dominantColor: `#${hex(r)}${hex(g)}${hex(b)}`,
    ext: "webp",
  };
}
