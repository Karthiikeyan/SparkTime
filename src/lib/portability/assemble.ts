/**
 * Builds an export package from the server's paginated responses. Runs in
 * the browser (Studio → Export) and in tests, with injected transport and
 * compression. The package is validated before it is handed to the user:
 * every file listed is present, Markdown checksums still match (nothing was
 * edited mid-export), and the manifest re-parses.
 */
import { parseManifest, type PortableManifest } from "./manifest";
import { sha256Hex } from "./parse";
import { EXPORT_LIMITS } from "./limits";
import { createZip, readZipEntries, type DeflateRaw, type RandomAccessSource } from "./zip";

export type ExportFormat = "portable" | "markdown" | "manifest" | "media";

export type ManifestResponse = {
  manifest: PortableManifest;
  extras: Array<{ path: string; text: string }>;
  assets: Array<{ id: string; pid: string; path: string; size: number; mimeType: string }>;
  summary: { pages: number; documents: number; assets: number; warnings: string[] };
};

export type AssembleOptions = {
  format: ExportFormat;
  fetchManifest(): Promise<ManifestResponse>;
  fetchPage(page: number): Promise<{ files: Array<{ path: string; text: string }> }>;
  fetchAsset(id: string): Promise<Uint8Array>;
  deflate: DeflateRaw;
  onProgress?(stage: "manifest" | "content" | "media" | "packaging" | "validating", done: number, total: number): void;
  signal?: AbortSignal;
};

export type AssembleResult = {
  chunks: Uint8Array[];
  size: number;
  files: number;
  manifest: PortableManifest;
  missingAssets: string[];
  warnings: string[];
};

export class ExportValidationError extends Error {}

const encoder = new TextEncoder();

export async function assemblePackage(opts: AssembleOptions): Promise<AssembleResult> {
  const check = () => {
    if (opts.signal?.aborted) throw new DOMException("Export cancelled.", "AbortError");
  };
  opts.onProgress?.("manifest", 0, 1);
  const head = await opts.fetchManifest();
  const manifest = structuredClone(head.manifest);
  const warnings = [...head.summary.warnings];
  check();

  const contentFiles: Array<{ path: string; text: string }> = [];
  for (let page = 0; page < head.summary.pages; page++) {
    opts.onProgress?.("content", page, head.summary.pages);
    contentFiles.push(...(await opts.fetchPage(page)).files);
    check();
  }

  // Bodies changed between the manifest and a page? The package would be inconsistent: stop.
  if (opts.format === "portable") {
    const byPath = new Map(contentFiles.map((f) => [f.path, f]));
    for (const doc of manifest.documents) {
      if (!doc.body?.markdown) continue;
      const file = byPath.get(doc.body.markdown);
      if (!file) throw new ExportValidationError(`"${doc.title}" is missing from the export. Try again.`);
      if (doc.body.markdownSha256 && (await sha256Hex(file.text)) !== doc.body.markdownSha256) {
        throw new ExportValidationError(`"${doc.title}" changed while exporting. Export again.`);
      }
    }
  }

  const mediaBytes = head.assets.reduce((n, a) => n + a.size, 0);
  if (opts.format !== "manifest" && mediaBytes > EXPORT_LIMITS.maxPackageMediaBytes) {
    throw new ExportValidationError(
      `This export's media is ${Math.round(mediaBytes / 1024 / 1024)} MB, more than a browser can safely package (${EXPORT_LIMITS.maxPackageMediaBytes / 1024 / 1024} MB). Export by topic, tag or collection instead, or choose a manifest-only export.`,
    );
  }
  const media: Array<{ path: string; data: Uint8Array }> = [];
  const missingAssets: string[] = [];
  const wantsMedia = opts.format !== "manifest";
  for (const [i, asset] of head.assets.entries()) {
    opts.onProgress?.("media", i, head.assets.length);
    if (!wantsMedia) break;
    try {
      const data = await opts.fetchAsset(asset.id);
      media.push({ path: asset.path, data });
      const entry = manifest.assets.find((a) => a.pid === asset.pid);
      if (entry) {
        entry.sha256 = await sha256Hex(data);
        entry.sizeBytes = data.length;
      }
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") throw error;
      missingAssets.push(asset.path);
    }
    check();
  }
  if (missingAssets.length) {
    const note = `${missingAssets.length} media file(s) couldn't be downloaded and are not in the package: ${missingAssets.slice(0, 5).join(", ")}.`;
    warnings.push(note);
    manifest.warnings.push(note);
    manifest.assets = manifest.assets.filter((a) => !missingAssets.includes(a.path));
  }

  opts.onProgress?.("packaging", 0, 1);
  const entries: Array<{ path: string; data: Uint8Array; compress?: boolean }> = [];
  if (opts.format !== "markdown") entries.push({ path: "manifest.json", data: encoder.encode(JSON.stringify(manifest, null, 2)) });
  for (const extra of head.extras) entries.push({ path: extra.path, data: encoder.encode(extra.text) });
  for (const file of contentFiles) entries.push({ path: file.path, data: encoder.encode(file.text) });
  // Images are already compressed (WebP); storing them is faster and no bigger.
  for (const m of media) entries.push({ path: m.path, data: m.data, compress: !/\.(webp|gif|mp3|m4a|jpe?g|png|avif)$/i.test(m.path) });
  const chunks = await createZip(entries, opts.deflate);

  opts.onProgress?.("validating", 0, 1);
  // Validate through a Blob (no second in-memory copy of the whole package).
  const blob = new Blob(chunks as BlobPart[]);
  const source: RandomAccessSource = { size: blob.size, read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()) };
  const listed = await readZipEntries(source);
  const names = new Set(listed.map((e) => e.name));
  for (const e of entries) if (!names.has(e.path)) throw new ExportValidationError(`The package is missing ${e.path}.`);
  if (opts.format !== "markdown") {
    const reparsed = parseManifest(JSON.parse(new TextDecoder().decode(entries[0]!.data)));
    if (!reparsed.ok) throw new ExportValidationError(`The generated manifest is invalid: ${reparsed.error}`);
    // Manifest-only packages deliberately carry no media files.
    if (opts.format !== "manifest") for (const asset of reparsed.manifest.assets) if (!names.has(asset.path)) throw new ExportValidationError(`The package is missing ${asset.path}.`);
  }
  return { chunks, size: blob.size, files: entries.length, manifest, missingAssets, warnings };
}
