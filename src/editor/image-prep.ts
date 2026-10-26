"use client";

/**
 * Client-side pre-processing for pasted/dropped images: very large photos
 * are downscaled (≤ 2800px) and re-encoded before upload so they fit the
 * hosting platform's request limit. The server still validates and
 * re-processes everything — this is only a transport optimisation.
 */
const MAX_EDGE = 2800;
const TARGET_BYTES = 3.5 * 1024 * 1024;

export async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (file.size <= TARGET_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    for (const quality of [0.9, 0.82, 0.72]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && (blob.size <= TARGET_BYTES || quality === 0.72)) {
        return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".webp", { type: "image/webp" });
      }
    }
  } catch {
    // fall through with the original; the server will report if it's too large
  }
  return file;
}

export function clipboardFileName(file: File): string {
  // Pasted screenshots are usually called "image.png" — give them a useful name.
  if (!file.name || /^image\.(png|jpe?g|webp)$/i.test(file.name)) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return `pasted-${stamp}.${(file.type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`;
  }
  return file.name;
}
