/**
 * Package-relative path handling. Every path that enters the importer —
 * from a ZIP entry, a folder upload's webkitRelativePath or a manifest — is
 * untrusted and goes through normalizePackagePath() before it is used as a
 * key, compared or resolved. Paths are only ever *names* inside a package:
 * nothing here touches a real filesystem.
 */
import { IMPORT_LIMITS } from "./limits";

export type PathResult = { ok: true; path: string } | { ok: false; reason: string };

/** C0/C1 control characters and the Unicode direction overrides used to disguise names. */
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;

/**
 * Normalises a relative path: forward slashes, NFC, no empty or "." segments.
 * Rejects absolute paths, drive letters, UNC paths, ".." anywhere, control
 * characters and anything over the length/depth limits.
 */
export function normalizePackagePath(raw: unknown): PathResult {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "Empty path." };
  if (raw.length > IMPORT_LIMITS.maxPathLength * 2) return { ok: false, reason: "Path is too long." };
  if (UNSAFE_CHARS.test(raw)) return { ok: false, reason: "Path contains control characters." };
  const unified = raw.normalize("NFC").replace(/\\/g, "/");
  if (unified.startsWith("/") || /^[a-zA-Z]:/.test(unified) || unified.startsWith("//")) {
    return { ok: false, reason: "Absolute paths are not allowed." };
  }
  const segments = unified.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) return { ok: false, reason: "Paths may not contain '..'." };
  if (segments.some((s) => s.trim() === "" || /[<>:"|?*]/.test(s))) return { ok: false, reason: "Path contains characters that are not allowed in file names." };
  if (segments.length === 0) return { ok: false, reason: "Empty path." };
  if (segments.length > IMPORT_LIMITS.maxPathDepth + 1) return { ok: false, reason: "Folders are nested too deeply." };
  const path = segments.join("/");
  if (path.length > IMPORT_LIMITS.maxPathLength) return { ok: false, reason: "Path is too long." };
  return { ok: true, path };
}

/** Files and folders that are never content: OS metadata, VCS, editor state. */
const JUNK_SEGMENTS = new Set(["__MACOSX", ".git", ".svn", ".hg", "node_modules", ".obsidian", ".trash", ".Trash", ".DS_Store", "Thumbs.db", "desktop.ini", ".gitkeep"]);

export function isJunkPath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((s) => JUNK_SEGMENTS.has(s))) return true;
  const base = segments.at(-1) ?? "";
  // AppleDouble resource forks ("._photo.jpg") and editor swap/backup files.
  return base.startsWith("._") || base.endsWith("~") || /\.(swp|tmp)$/i.test(base);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function extension(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i + 1).toLowerCase();
}

export function stem(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf(".");
  return i <= 0 ? base : base.slice(0, i);
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

/** Decodes %XX sequences when they form valid UTF-8; otherwise returns the input unchanged. */
export function safeDecodeUri(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Resolves a reference written inside `fromFile` (e.g. "../img/a%20b.png")
 * to a package path. Returns null for anything that is not a relative path
 * inside the package (URLs, absolute paths, escapes above the root).
 */
export function resolveRelative(fromFile: string, reference: string): { path: string; fragment: string | null } | null {
  const trimmed = reference.trim();
  if (!trimmed || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("#")) return null;
  // Markdown allows <angle-bracketed> destinations with spaces.
  const unwrapped = trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
  const hashAt = unwrapped.indexOf("#");
  const rawPath = (hashAt === -1 ? unwrapped : unwrapped.slice(0, hashAt)).split("?")[0]!;
  const fragment = hashAt === -1 ? null : safeDecodeUri(unwrapped.slice(hashAt + 1)) || null;
  if (!rawPath) return null;
  const decoded = safeDecodeUri(rawPath).normalize("NFC").replace(/\\/g, "/");
  const segments = decoded.startsWith("/") ? [] : dirname(fromFile).split("/").filter(Boolean);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length ? { path: segments.join("/"), fragment } : null;
}

/**
 * Folder uploads and ZIPs usually wrap everything in one top folder
 * ("articles/…", "Export-1234/…"). Strips it when every path shares it, so
 * the first meaningful folder becomes a topic, not the wrapper.
 */
export function commonRoot(paths: string[]): string {
  if (!paths.length) return "";
  const first = paths[0]!.split("/");
  if (first.length < 2) return "";
  const candidate = first[0]!;
  return paths.every((p) => p.startsWith(candidate + "/")) ? candidate : "";
}

export function stripRoot(path: string, root: string): string {
  return root && path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
}

/** Key used to detect names that collide on case-insensitive filesystems or after Unicode normalisation. */
export function collisionKey(path: string): string {
  return path.normalize("NFKC").toLowerCase();
}

export type FileKind = "markdown" | "mdx" | "html" | "text" | "json" | "media" | "archive" | "csv" | "unsupported";

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  mkd: "markdown",
  mdx: "mdx",
  html: "html",
  htm: "html",
  txt: "text",
  json: "json",
  zip: "archive",
  csv: "csv",
  jpg: "media",
  jpeg: "media",
  png: "media",
  gif: "media",
  webp: "media",
  avif: "media",
  pdf: "media",
  mp3: "media",
  m4a: "media",
};

export function fileKind(path: string): FileKind {
  return KIND_BY_EXTENSION[extension(path)] ?? "unsupported";
}

export function isTextKind(kind: FileKind): boolean {
  return kind === "markdown" || kind === "mdx" || kind === "html" || kind === "text" || kind === "json" || kind === "csv";
}
