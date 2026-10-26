/**
 * Upload validation by file signature. The browser-declared MIME type is only
 * a hint: the stored type is always the one detected from the bytes, and the
 * two must agree on the family (image / pdf / audio).
 *
 * SVG is deliberately NOT allowed: it is a script-capable document format.
 */

export type MediaKind = "image" | "file" | "audio";

export type DetectedType = { mime: string; kind: MediaKind; ext: string };

const ALLOWED: Record<string, DetectedType> = {
  "image/jpeg": { mime: "image/jpeg", kind: "image", ext: "jpg" },
  "image/png": { mime: "image/png", kind: "image", ext: "png" },
  "image/gif": { mime: "image/gif", kind: "image", ext: "gif" },
  "image/webp": { mime: "image/webp", kind: "image", ext: "webp" },
  "image/avif": { mime: "image/avif", kind: "image", ext: "avif" },
  "application/pdf": { mime: "application/pdf", kind: "file", ext: "pdf" },
  "audio/mpeg": { mime: "audio/mpeg", kind: "audio", ext: "mp3" },
  "audio/mp4": { mime: "audio/mp4", kind: "audio", ext: "m4a" },
};

export const ALLOWED_MIME_TYPES = Object.keys(ALLOWED);

/** Per-kind size ceilings (bytes). The platform request limit may be lower. */
export const MAX_BYTES: Record<MediaKind, number> = {
  image: 15 * 1024 * 1024,
  file: 25 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
};

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buf.subarray(start, Math.min(end, buf.length)));
}

/** Detects the real file type from its leading bytes, or null if not allowed. */
export function sniffType(buf: Uint8Array): DetectedType | null {
  if (buf.length < 12) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return ALLOWED["image/jpeg"]!;
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ALLOWED["image/png"]!;
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") return ALLOWED["image/gif"]!;
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return ALLOWED["image/webp"]!;
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (brand === "avif" || brand === "avis") return ALLOWED["image/avif"]!;
    if (brand === "M4A " || brand === "M4B ") return ALLOWED["audio/mp4"]!;
    return null;
  }
  if (ascii(buf, 0, 5) === "%PDF-") return ALLOWED["application/pdf"]!;
  if (ascii(buf, 0, 3) === "ID3") return ALLOWED["audio/mpeg"]!;
  // MPEG audio frame sync (11 set bits) with a valid layer.
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0 && (buf[1]! & 0x06) !== 0) return ALLOWED["audio/mpeg"]!;
  return null;
}

export type ValidationResult = { ok: true; type: DetectedType } | { ok: false; reason: string; status: 413 | 415 | 400 };

export function validateUpload(buf: Uint8Array, declaredMime: string, maxBytesOverride?: number): ValidationResult {
  if (buf.length === 0) return { ok: false, reason: "The file is empty.", status: 400 };
  const type = sniffType(buf);
  if (!type) return { ok: false, reason: "This file type is not allowed. Upload JPEG, PNG, GIF, WebP, AVIF, PDF, MP3 or M4A.", status: 415 };
  const declared = (declaredMime || "").toLowerCase().split(";")[0]!.trim();
  // An empty/generic declared type is acceptable (clipboard pastes often have none).
  if (declared && declared !== "application/octet-stream") {
    const declaredFamily = declared.startsWith("image/") ? "image" : declared === "application/pdf" ? "file" : declared.startsWith("audio/") ? "audio" : "other";
    if (declaredFamily !== type.kind) return { ok: false, reason: "The file's contents don't match its declared type.", status: 415 };
  }
  const limit = Math.min(MAX_BYTES[type.kind], maxBytesOverride ?? Number.POSITIVE_INFINITY);
  if (buf.length > limit) return { ok: false, reason: `File is too large (max ${Math.floor(limit / 1024 / 1024)} MB).`, status: 413 };
  return { ok: true, type };
}

/** Display-only filename: no paths, no control characters, bounded length. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\x00-\x1F\x7F<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || "file";
}

/** Server-generated object keys only: {folder}/{yyyy}/{mm}/{uuid}[-w{width}].{ext}. */
export const OBJECT_KEY_PATTERN = /^(media|files|audio)\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-w\d{2,4}|-lqip)?\.(webp|gif|pdf|mp3|m4a)$/;

export function isValidObjectKey(key: string): boolean {
  return OBJECT_KEY_PATTERN.test(key) && !key.includes("..");
}

export function buildObjectKey(kind: MediaKind, id: string, ext: string, suffix = "", now = new Date()): string {
  const folder = kind === "image" ? "media" : kind === "audio" ? "audio" : "files";
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const key = `${folder}/${yyyy}/${mm}/${id}${suffix}.${ext}`;
  if (!isValidObjectKey(key)) throw new Error("Refusing to build an invalid object key.");
  return key;
}

export const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
};
