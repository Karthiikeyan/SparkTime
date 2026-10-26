/**
 * Resource limits for imports and exports. Shared by the browser (which
 * expands folders and ZIP archives before anything is sent) and the server
 * (which re-checks every value it receives — the browser is never trusted).
 *
 * The request ceiling is Vercel's ~4.5 MB body limit; batches stay well
 * under it so JSON overhead and headers never tip a request over.
 */
export const IMPORT_LIMITS = {
  /** Files of any kind in one import (after junk such as .DS_Store is ignored). */
  maxFiles: 2000,
  /** Documents (Markdown, HTML, text, manifest records) in one import. */
  maxDocuments: 1000,
  /** One text source (Markdown, HTML, text, JSON). */
  maxTextFileBytes: 2 * 1024 * 1024,
  /** All staged text in one import. */
  maxTotalTextBytes: 50 * 1024 * 1024,
  /** Media files referenced by one import. Each file is also bound by MAX_UPLOAD_MB. */
  maxMediaFiles: 1000,
  /** Characters in one relative path. */
  maxPathLength: 400,
  /** Folder nesting inside a package. */
  maxPathDepth: 16,
  /** An uploaded ZIP archive (browser-side; it never reaches the server whole). */
  maxArchiveBytes: 250 * 1024 * 1024,
  /** Sum of uncompressed sizes inside one archive (ZIP-bomb guard). */
  maxExtractedBytes: 600 * 1024 * 1024,
  /** Highest compression ratio accepted for one entry (ZIP-bomb guard). */
  maxCompressionRatio: 200,
  /** Archives nested inside archives (Notion exports wrap their parts in ZIPs). */
  maxArchiveNesting: 1,
  /** Bytes of JSON in one staging request. */
  maxBatchBytes: 3 * 1024 * 1024,
  /** YAML frontmatter block. */
  maxFrontmatterBytes: 64 * 1024,
  /** Values (scalars, list items, map entries) in one frontmatter block. */
  maxFrontmatterNodes: 4000,
  /** Leading bytes of a media file sent for signature sniffing during analysis. */
  mediaHeadBytes: 64,
} as const;

export const EXPORT_LIMITS = {
  /** Documents whose files are returned by one export page request. */
  documentsPerPage: 40,
  /** Approximate JSON bytes per export page before it is cut short. */
  maxPageBytes: 3 * 1024 * 1024,
  /** Media in one package. The browser holds the files, the ZIP and a Blob at once (about 2x), so keep it modest. */
  maxPackageMediaBytes: 200 * 1024 * 1024,
} as const;

/** Time budget for one `run` request before it hands control back to the browser. */
export const RUN_BUDGET_MS = 20_000;

/** How long a running import holds its lease without a heartbeat. */
export const RUN_LEASE_MS = 60_000;
