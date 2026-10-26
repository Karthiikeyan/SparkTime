"use client";

/**
 * Browser side of an import: turns dropped folders, picked files and ZIP
 * archives into a flat list of package files, then stages them in small
 * batches. Archives are expanded here (with limits) so nothing large ever
 * crosses the network in one request; the server re-validates everything.
 */
import { planBatches } from "@/lib/portability/batching";
import { IMPORT_LIMITS } from "@/lib/portability/limits";
import { fileKind, isJunkPath, isTextKind, normalizePackagePath } from "@/lib/portability/paths";
import { extractZipEntry, readZipEntries, ZipError } from "@/lib/portability/zip";
import { browserInflateRaw, sourceFromBlob, supportsCompressionStreams } from "@/lib/portability/zip-browser";
import { api } from "../api";

export type PickedFile = { path: string; blob: Blob };

export type IngestedFile = {
  path: string;
  size: number;
  kind: ReturnType<typeof fileKind>;
  text: string | null;
  sha256: string | null;
  head: string | null;
  blob: Blob | null;
};

export type IngestResult = { files: IngestedFile[]; rejected: Array<{ path: string; reason: string }>; obsidianVault: boolean; sourceName: string };

export type IngestProgress = (message: string, done: number, total: number) => void;

// ---------------------------------------------------------------------------
// Collecting files
// ---------------------------------------------------------------------------

/** From <input type=file> (folder pickers fill webkitRelativePath). */
export function fromFileList(list: FileList | File[]): PickedFile[] {
  return Array.from(list).map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, blob: file }));
}

/** From a drop: walks dropped folders recursively (webkitGetAsEntry). */
export async function fromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(dt.items)
    .map((item) => (item.kind === "file" ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (!entries.length) return fromFileList(dt.files);
  const out: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    if (depth > IMPORT_LIMITS.maxPathDepth + 2 || out.length > IMPORT_LIMITS.maxFiles * 2) return;
    if (entry.isFile) {
      const file = await new Promise<File>((ok, err) => (entry as FileSystemFileEntry).file(ok, err));
      out.push({ path: entry.fullPath.replace(/^\/+/, ""), blob: file });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns batches until an empty one.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, err) => reader.readEntries(ok, err));
        if (!batch.length) break;
        for (const child of batch) await walk(child, depth + 1);
      }
    }
  };
  for (const entry of entries) await walk(entry, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

async function sha256(blob: Blob): Promise<{ hex: string; head: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  let bin = "";
  for (const b of bytes.subarray(0, IMPORT_LIMITS.mediaHeadBytes)) bin += String.fromCharCode(b);
  return { hex, head: btoa(bin) };
}

async function isZip(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

async function expandArchive(name: string, blob: Blob, depth: number, progress: IngestProgress, prefix: string): Promise<{ files: PickedFile[]; rejected: IngestResult["rejected"] }> {
  if (!supportsCompressionStreams()) throw new ZipError("This browser can't open ZIP files. Unzip the archive and choose the folder instead.");
  if (blob.size > IMPORT_LIMITS.maxArchiveBytes) throw new ZipError(`"${name}" is larger than ${IMPORT_LIMITS.maxArchiveBytes / 1024 / 1024} MB.`);
  const source = sourceFromBlob(blob);
  const entries = await readZipEntries(source);
  const files: PickedFile[] = [];
  const rejected: IngestResult["rejected"] = [];
  for (const [i, entry] of entries.entries()) {
    progress(`Expanding ${name}`, i, entries.length);
    const checked = normalizePackagePath(entry.name);
    if (!checked.ok) {
      rejected.push({ path: entry.name.slice(0, 200), reason: checked.reason });
      continue;
    }
    if (isJunkPath(checked.path)) continue;
    const data = await extractZipEntry(source, entry, browserInflateRaw);
    const path = prefix ? `${prefix}/${checked.path}` : checked.path;
    if (fileKind(path) === "archive" && depth < IMPORT_LIMITS.maxArchiveNesting) {
      // Notion wraps large exports in part-ZIPs inside the ZIP.
      const inner = await expandArchive(checked.path, new Blob([data as BlobPart]), depth + 1, progress, path.replace(/\.zip$/i, ""));
      files.push(...inner.files);
      rejected.push(...inner.rejected);
    } else files.push({ path, blob: new Blob([data as BlobPart]) });
  }
  return { files, rejected };
}

/** Expands archives, hashes media, decodes text. Nothing is uploaded yet. */
export async function ingest(picked: PickedFile[], progress: IngestProgress): Promise<IngestResult> {
  const rejected: IngestResult["rejected"] = [];
  const obsidianVault = picked.some((p) => /(^|\/)\.obsidian\//.test(p.path));
  const archives = picked.filter((p) => fileKind(p.path) === "archive");
  const flat: PickedFile[] = picked.filter((p) => fileKind(p.path) !== "archive");
  for (const archive of archives) {
    if (!(await isZip(archive.blob))) {
      rejected.push({ path: archive.path, reason: "Not a ZIP archive." });
      continue;
    }
    const prefix = archives.length > 1 || flat.length ? archive.path.replace(/\.zip$/i, "") : "";
    const expanded = await expandArchive(archive.path, archive.blob, 0, progress, prefix);
    flat.push(...expanded.files);
    rejected.push(...expanded.rejected);
  }
  if (flat.length > IMPORT_LIMITS.maxFiles * 2) throw new Error(`That's ${flat.length} files; an import can hold ${IMPORT_LIMITS.maxFiles}. Import a smaller folder.`);

  const files: IngestedFile[] = [];
  const sourceName = archives[0]?.path.split("/").pop() ?? picked[0]?.path.split("/")[0] ?? "Import";
  for (const [i, p] of flat.entries()) {
    progress("Reading files", i, flat.length);
    const checked = normalizePackagePath(p.path);
    if (!checked.ok) {
      rejected.push({ path: p.path.slice(0, 200), reason: checked.reason });
      continue;
    }
    if (isJunkPath(checked.path)) continue;
    const kind = fileKind(checked.path);
    if (isTextKind(kind)) {
      if (p.blob.size > IMPORT_LIMITS.maxTextFileBytes) {
        rejected.push({ path: checked.path, reason: `Larger than ${IMPORT_LIMITS.maxTextFileBytes / 1024 / 1024} MB.` });
        continue;
      }
      let text: string | null = null;
      try {
        text = strictUtf8.decode(await p.blob.arrayBuffer());
      } catch {
        rejected.push({ path: checked.path, reason: "Not valid UTF-8 text." });
        continue;
      }
      files.push({ path: checked.path, size: p.blob.size, kind, text, sha256: null, head: null, blob: null });
    } else if (kind === "media") {
      const { hex, head } = await sha256(p.blob);
      files.push({ path: checked.path, size: p.blob.size, kind, text: null, sha256: hex, head, blob: p.blob });
    } else {
      files.push({ path: checked.path, size: p.blob.size, kind, text: null, sha256: null, head: null, blob: null });
    }
  }
  return { files, rejected, obsidianVault, sourceName };
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

/**
 * Sends files in batches whose JSON bodies are measured exactly (UTF-8 bytes)
 * and kept under the batch limit. The server's own cap is a little higher, and
 * Vercel's request limit (~4.5 MB) is higher still. Re-sending a batch is harmless.
 */
export async function stage(jobId: string, files: IngestedFile[], progress: IngestProgress): Promise<{ skipped: Array<{ path: string; reason: string }> }> {
  const skipped: Array<{ path: string; reason: string }> = [];
  const items = files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, head: f.head, text: f.text }));
  // The server accepts bodies up to maxBatchBytes + 512 KB; a file that needs more than that alone can't be sent.
  const { batches, oversized } = planBatches(items, IMPORT_LIMITS.maxBatchBytes, IMPORT_LIMITS.maxBatchBytes + 384 * 1024);
  for (const item of oversized) skipped.push({ path: item.path, reason: "Too large to send in one request once encoded (special characters make it larger). Split the file." });
  let sent = 0;
  for (const batch of batches) {
    const result = await api<{ skipped: Array<{ path: string; reason: string }> }>(`/api/admin/import/jobs/${jobId}/files`, { method: "POST", body: { files: batch } });
    skipped.push(...result.skipped);
    sent += batch.length;
    progress("Uploading text for analysis", sent, items.length);
  }
  return { skipped };
}

/**
 * Picked media, keyed so the server's package paths find them. The server asks for
 * "assets/a.png" even when the folder was picked as "site/assets/a.png" (a wrapper
 * folder is treated as the package root), so each file is also filed under its
 * path without the first segment.
 */
export function blobIndex(files: Array<{ path: string; blob: Blob | null }>, into: Map<string, Blob> = new Map()): Map<string, Blob> {
  for (const f of files) {
    if (!f.blob) continue;
    into.set(f.path, f.blob);
    const slash = f.path.indexOf("/");
    if (slash > 0 && !into.has(f.path.slice(slash + 1))) into.set(f.path.slice(slash + 1), f.blob);
  }
  return into;
}

/** Exact path first, then a unique match that differs only by a leading wrapper folder. */
export function findBlob(index: Map<string, Blob>, path: string): Blob | undefined {
  const exact = index.get(path);
  if (exact) return exact;
  const matches = new Set<Blob>();
  for (const [key, blob] of index) if (key.endsWith(`/${path}`) || path.endsWith(`/${key}`)) matches.add(blob);
  return matches.size === 1 ? [...matches][0] : undefined;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
