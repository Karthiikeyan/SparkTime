/**
 * The normalised intermediate representation. Markdown folders, HTML,
 * Notion and Obsidian exports and native portable packages are all parsed
 * into these shapes, so there is exactly one planner and one executor.
 *
 * Nothing here has been mapped to the destination yet: values are what the
 * source said, with where each came from. Source information is never
 * discarded — anything without a home goes into `unmapped`.
 */
import type { Doc } from "../content/blocks";

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type IssueLevel = "error" | "warning" | "info";

export type IssueCode =
  // files and packages
  | "file.path_invalid"
  | "file.path_collision"
  | "file.too_large"
  | "file.unsupported"
  | "file.encoding"
  | "file.duplicate"
  | "archive.invalid"
  | "manifest.invalid"
  | "manifest.version"
  | "manifest.body_edited"
  // parsing
  | "frontmatter.malformed"
  | "frontmatter.unknown"
  | "frontmatter.invalid_value"
  | "body.too_large"
  | "body.transformed"
  | "body.unsupported"
  | "mdx.unsupported"
  | "html.stripped"
  // mapping and planning
  | "type.unknown"
  | "type.unsupported"
  | "type.defaulted"
  | "slug.generated"
  | "slug.collision"
  | "slug.changed"
  | "title.missing"
  | "topic.ambiguous"
  | "topic.created"
  | "topic.depth"
  | "topic.namespace"
  | "tag.unrepresentable"
  | "tag.merged"
  | "property.invalid"
  | "property.unmapped"
  | "reference.unresolved"
  | "reference.ambiguous"
  | "reference.excluded"
  | "relation.self"
  | "media.missing"
  | "media.external"
  | "media.unsupported"
  | "media.too_large"
  | "collection.detected"
  | "collection.existing"
  | "duplicate.detected"
  | "readme.metadata"
  | "status.not_applied"
  | "robots.not_applied"
  | "legacy_url.not_applied"
  | "author.unmapped"
  | "date.invalid";

export type Issue = {
  level: IssueLevel;
  code: IssueCode;
  message: string;
  /** Package path of the file the issue belongs to. */
  path?: string;
  /** Short machine-friendly context (the original reference, field name…). */
  detail?: string;
};

export function issue(level: IssueLevel, code: IssueCode, message: string, extra: { path?: string; detail?: string } = {}): Issue {
  return { level, code, message, ...extra };
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * A reference to another document, found in a body, frontmatter or manifest.
 * Bodies carry placeholders (`ref:<index>`) that point into `refs`.
 */
export type DocTarget =
  /** Relative file reference ("../java/02-oop.md"), already resolved against the referring file. */
  | { kind: "path"; path: string; fragment: string | null }
  /** Obsidian/Notion-style name reference ("[[OOP Basics]]"). */
  | { kind: "wiki"; name: string; fragment: string | null }
  /** Portable identifier from a manifest or `.doc.json`. */
  | { kind: "pid"; pid: string }
  /** A path on this site ("/article/x") or a slug, from frontmatter or a site link. */
  | { kind: "site"; path: string }
  | { kind: "slug"; slug: string };

export type MediaTarget =
  | { kind: "path"; path: string }
  | { kind: "wiki"; name: string }
  | { kind: "asset"; pid: string }
  /** Already a media URL of this site (/media/… or the R2 origin) — kept only if it resolves. */
  | { kind: "site"; src: string; mediaId: string | null }
  /** Remote URL — never fetched. */
  | { kind: "external"; url: string };

export const REF_PREFIX = "ref:";
export const MEDIA_PREFIX = "asset-ref:";

// ---------------------------------------------------------------------------
// Documents and folders
// ---------------------------------------------------------------------------

export type SourceSystem = "folder" | "notion" | "obsidian" | "studio-portable" | "studio-bundle";
export type SourceFormat = "markdown" | "mdx" | "html" | "text" | "portable" | "bundle";

export type ValueFrom = "manifest" | "frontmatter" | "metadata" | "heading" | "filename" | "readme" | "folder" | "default";

export type Sourced<T> = { value: T; from: ValueFrom };

export type ParsedRelation = { target: DocTarget; kind: string; note: string; from: ValueFrom };

export type NormalizedDocument = {
  /** Stable key inside this import (the package path, or `pid:<id>` for manifest records). */
  key: string;
  sourcePath: string;
  sourceFormat: SourceFormat;
  sourceSystem: SourceSystem;
  /** Explicit portable identifier, when the source declares one. */
  pid: string | null;
  /** Informational only: the id this record had where it came from. */
  originalId: string | null;
  title: Sourced<string>;
  slug: Sourced<string> | null;
  type: Sourced<string> | null;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  robotsIndex: string | null;
  /** What the source said; applied only when the owner explicitly opts in. */
  sourceStatus: string | null;
  sourceVisibility: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  topics: Array<{ value: string; primary: boolean; from: ValueFrom }>;
  tags: Array<{ value: string; from: ValueFrom }>;
  /** Explicit sequence (frontmatter `order`, manifest position). */
  order: number | null;
  cover: MediaTarget | null;
  /** Raw candidate property values, keyed as the source wrote them. */
  properties: Record<string, unknown>;
  relations: ParsedRelation[];
  /** Earlier URLs of this document (site paths become redirects only for public imports). */
  legacyUrls: string[];
  aliases: string[];
  author: string | null;
  notes: string | null;
  featured: boolean | null;
  priority: number | null;
  body: Doc;
  refs: DocTarget[];
  mediaRefs: MediaTarget[];
  unmapped: Record<string, unknown>;
  issues: Issue[];
  /** True for README/index files, which are folder metadata unless configured otherwise. */
  isReadme: boolean;
};

export type FolderMetadata = {
  path: string;
  readmePath: string | null;
  title: string | null;
  description: string | null;
  type: string | null;
  /** README says this folder is (or is not) an ordered collection. */
  collection: boolean | null;
  topics: string[];
  tags: string[];
  /** Member file names in explicit order (README frontmatter `order`, or an ordered list of links). */
  order: string[];
  cover: MediaTarget | null;
  importReadme: boolean;
  slug: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type MediaFile = {
  path: string;
  size: number;
  sha256: string;
  /** Leading bytes, base64, for signature sniffing during analysis. */
  head: string;
};

/** Collection definition from a portable manifest. */
export type ManifestCollection = {
  collectionKey: string;
  items: Array<{ documentKey: string; position: number; groupLabel: string; note: string }>;
};

export type ParsedPackage = {
  sourceSystem: SourceSystem;
  /** Human-readable assumptions shown in the preview ("Detected a Notion export…"). */
  assumptions: string[];
  rootFolder: string;
  documents: NormalizedDocument[];
  /** README/_index files: folder metadata, and the introduction of a folder collection. */
  readmes: NormalizedDocument[];
  folders: FolderMetadata[];
  media: MediaFile[];
  manifestCollections: ManifestCollection[];
  /** Topics/tags declared by a manifest (with portable ids). */
  manifestTopics: Array<{ pid: string; name: string; slug: string; description: string; parentPid: string | null }>;
  manifestTags: Array<{ pid: string; name: string; slug: string; description: string }>;
  /** Assets declared by a manifest (pid → package path). */
  manifestAssets: Array<{ pid: string; path: string; alt: string; caption: string; sha256: string | null }>;
  schemaVersion: number | null;
  issues: Issue[];
};
