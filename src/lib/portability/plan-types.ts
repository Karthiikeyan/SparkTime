/**
 * Shapes shared by the planner (pure), the import service (server) and the
 * Studio preview (client). A plan is data only; nothing in it executes.
 */
import type { DocumentStatus, FieldDefinition, Visibility } from "../content/model";
import type { Indexing } from "../content/publication";
import type { DocTarget, Issue, MediaTarget, SourceFormat, SourceSystem, ValueFrom } from "./model";

// ---------------------------------------------------------------------------
// Destination snapshot (read-only view of the site, loaded by the server)
// ---------------------------------------------------------------------------

export type SnapshotType = {
  id: string;
  slug: string;
  name: string;
  pluralName: string;
  template: string;
  routing: "type" | "root";
  fields: FieldDefinition[];
};

export type SnapshotDocument = {
  id: string;
  typeId: string;
  slug: string;
  title: string;
  status: string;
  visibility: string;
  canonicalUrl: string | null;
  path: string;
};

export type DestinationSnapshot = {
  types: SnapshotType[];
  categories: Array<{ id: string; name: string; slug: string; parentId: string | null }>;
  tags: Array<{ id: string; name: string; slug: string }>;
  documents: SnapshotDocument[];
  /** portable_identities rows. */
  identities: Array<{ portableId: string; entity: "document" | "topic" | "tag" | "media"; entityId: string }>;
  /** Existing media: id and the public URL of its primary object. */
  media: Array<{ id: string; url: string }>;
  /** Existing collection memberships (collection document id → ordered members). */
  collectionItems: Array<{ collectionId: string; documentId: string; position: number }>;
  /** Content-type slugs, which own /{slug} in the root URL namespace (root pages and categories are listed above). */
  rootSlugs: string[];
  /** Existing redirect sources. */
  redirectPaths: string[];
  /** Changes whenever relevant destination state changes (stale-preview detection). */
  fingerprint: string;
};

// ---------------------------------------------------------------------------
// Decisions (the owner's edits in the preview)
// ---------------------------------------------------------------------------

export const UPDATE_FIELDS = ["title", "slug", "body", "excerpt", "seo", "status", "visibility", "topics", "tags", "relations", "cover", "dates", "properties", "notes"] as const;
export type UpdateField = (typeof UPDATE_FIELDS)[number];

/** Fields an explicit "clear" can apply to (empty value written instead of the incoming one). */
export const CLEARABLE_FIELDS = ["excerpt", "seo", "cover", "properties", "notes"] as const satisfies readonly UpdateField[];

export type ConflictAction = "skip" | "update" | "copy";

export type DocumentDecision = {
  include?: boolean;
  type?: string;
  title?: string;
  slug?: string;
  action?: ConflictAction;
  /** Which existing document an ambiguous duplicate refers to. */
  matchId?: string;
  updateFields?: UpdateField[];
  clearFields?: UpdateField[];
  status?: DocumentStatus;
  visibility?: Visibility;
  /** Search engines for this document; overrides the import-wide choice. */
  indexing?: Indexing;
  order?: number;
};

export type FolderRole = "topic" | "collection" | "tag" | "none";

export type FolderDecision = {
  role?: FolderRole;
  /** Content type for documents inside this folder. */
  type?: string;
  /** Collection type when role = collection. */
  collectionType?: string;
  collectionTitle?: string;
  /** Existing collection document to merge into. */
  collectionId?: string;
  /** Existing category to use for this folder instead of matching/creating. */
  topicId?: string;
};

export type TopicDecision = { mode: "existing"; id: string } | { mode: "create"; name: string; slug: string } | { mode: "skip" };

export type StatusPolicy =
  /** Drafts (stored public, so publishing one later makes it live). The default. */
  | { mode: "draft" }
  | { mode: "set"; status: DocumentStatus; visibility: Visibility }
  /** Honour the source's own status/visibility (explicit opt-in; publishing still goes through publish checks). */
  | { mode: "source" };

export type ImportDecisions = {
  defaultType?: string;
  typeAliases?: Record<string, string>;
  folders?: Record<string, FolderDecision>;
  documents?: Record<string, DocumentDecision>;
  topics?: Record<string, TopicDecision>;
  status?: StatusPolicy;
  /** Search engines for every document without its own choice. Automatic never lets a file opt a document in. */
  indexing?: Indexing;
  importReadmes?: boolean;
  /** Treat a single wrapper folder as a real folder (topic/collection) instead of the package root. */
  keepRootFolder?: boolean;
  /** Bulk duplicate action applied where a document has no decision of its own. */
  duplicateAction?: ConflictAction;
};

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type ExistingRef = { id: string; title: string; slug: string; typeSlug: string; status: string; visibility: string; path: string };

export type ConflictReason = "identity" | "slug" | "canonical" | "legacy";

export type DocumentAction = "create" | "update" | "skip" | "copy" | "excluded" | "blocked";

export type RefResolution =
  | { status: "incoming"; key: string }
  | { status: "existing"; id: string; path: string }
  | { status: "unresolved"; reason: string }
  | { status: "ambiguous"; candidates: string[] }
  /** Site link with no known target: kept as written. */
  | { status: "kept"; path: string };

export type PlannedRef = { index: number; target: DocTarget; resolution: RefResolution; evidence: "link" | "wikilink" | "mention" | "related-block" };

export type PlannedMediaRef = { index: number; target: MediaTarget; mediaKey: string | null };

export type PlannedProperty =
  | { kind: "value"; value: unknown }
  | { kind: "media"; mediaKey: string }
  | { kind: "documents"; refs: RefResolution[]; multiple: boolean };

export type DocumentPlan = {
  key: string;
  sourcePath: string;
  sourceFormat: SourceFormat;
  /** Synthetic documents (folder collections) have no source file of their own. */
  synthetic: boolean;
  pid: string | null;
  title: string;
  titleFrom: ValueFrom | "decision";
  slug: string;
  slugFrom: ValueFrom | "decision" | "generated" | "existing";
  typeSlug: string | null;
  typeFrom: ValueFrom | "decision" | "alias";
  action: DocumentAction;
  conflict: null | { reason: ConflictReason; existing: ExistingRef; candidates: ExistingRef[] };
  updateFields: UpdateField[];
  clearFields: UpdateField[];
  status: DocumentStatus;
  visibility: Visibility;
  statusFrom: "default" | "decision" | "source" | "existing";
  topicKeys: string[];
  tagKeys: string[];
  collectionKey: string | null;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  robotsIndex: string | null;
  /** Where robotsIndex came from: a file may only ever ask for noindex; "decision" is the owner's explicit choice. */
  robotsFrom: "default" | "source" | "decision";
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  coverMediaKey: string | null;
  properties: Record<string, PlannedProperty>;
  unmapped: Record<string, unknown>;
  legacyUrls: string[];
  notes: string | null;
  featured: boolean | null;
  priority: number | null;
  refs: PlannedRef[];
  mediaRefs: PlannedMediaRef[];
  wordCount: number;
  blockCount: number;
  issues: Issue[];
};

export type TopicPlan = {
  key: string;
  label: string;
  /** Where the proposal came from: front matter values, a folder, a manifest record. */
  origin: "explicit" | "folder" | "manifest";
  action: "reuse" | "create" | "ambiguous" | "skip" | "invalid";
  existingId: string | null;
  candidates: Array<{ id: string; name: string; slug: string }>;
  create: { name: string; slug: string; parentKey: string | null; parentId: string | null } | null;
  documentCount: number;
  message: string | null;
};

export type TagPlan = {
  key: string;
  name: string;
  variants: string[];
  action: "reuse" | "create";
  existingId: string | null;
  documentCount: number;
};

export type CollectionPlan = {
  key: string;
  /** create: a new collection; merge: add members to an existing one; skip: leave the existing one untouched. */
  action: "create" | "merge" | "skip";
  /** Document key of the collection document (incoming) — or null when merging into an existing one only. */
  documentKey: string | null;
  existingId: string | null;
  folder: string | null;
  title: string;
  items: Array<{ documentKey: string; position: number; groupLabel: string; note: string }>;
  orderSource: "explicit" | "prefix" | "name" | "manifest";
  /** Existing members kept as they are (merges never remove members). */
  existingMemberCount: number;
};

export type RelationPlan = {
  sourceKey: string;
  target: RefResolution & { status: "incoming" | "existing" };
  kind: string;
  note: string;
  origin: "manual" | "content";
  evidence: "manifest" | "frontmatter" | "notion-hierarchy" | "link" | "wikilink" | "mention" | "related-block";
};

export type MediaPlan = {
  key: string;
  path: string | null;
  sha256: string | null;
  size: number;
  action: "upload" | "reuse" | "missing" | "external" | "unsupported" | "too_large";
  existingId: string | null;
  /** For reuse of a site URL: the URL itself. */
  url: string | null;
  alt: string;
  usedBy: string[];
  message: string | null;
};

export type DecisionRequired = { kind: "duplicate" | "topic" | "type"; key: string; message: string };

export type PlanSummary = {
  documents: number;
  create: number;
  update: number;
  skip: number;
  copy: number;
  excluded: number;
  blocked: number;
  topicsReuse: number;
  topicsCreate: number;
  tagsReuse: number;
  tagsCreate: number;
  collectionsCreate: number;
  collectionsModify: number;
  relations: number;
  inferredRelations: number;
  unresolvedRefs: number;
  slugCollisions: number;
  mediaUpload: number;
  mediaReuse: number;
  mediaMissing: number;
  mediaBytes: number;
  unsupported: number;
  warnings: number;
  errors: number;
};

export type ImportPlan = {
  version: 1;
  hash: string;
  source: {
    system: SourceSystem;
    assumptions: string[];
    rootFolder: string;
    schemaVersion: number | null;
    fileCount: number;
  };
  summary: PlanSummary;
  documents: DocumentPlan[];
  topics: TopicPlan[];
  tags: TagPlan[];
  collections: CollectionPlan[];
  relations: RelationPlan[];
  media: MediaPlan[];
  folders: Array<{ path: string; role: FolderRole; roleFrom: "decision" | "readme" | "inferred"; documentCount: number; topicKey: string | null; collectionKey: string | null }>;
  issues: Issue[];
  decisionsRequired: DecisionRequired[];
};
