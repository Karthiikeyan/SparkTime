import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * All application tables live in a dedicated `studio` schema. On Supabase the
 * auto-generated REST API only exposes `public`, so nothing here is reachable
 * through the anon key even before RLS (which the migrations also enable).
 */
export const studio = pgSchema("studio");

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = studio.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  githubLogin: text("github_login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const sessions = studio.table(
  "sessions",
  {
    /** SHA-256 of the session token. The raw token only ever lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

// ---------------------------------------------------------------------------
// Content model
// ---------------------------------------------------------------------------

export const contentTypes = studio.table(
  "content_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    pluralName: text("plural_name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    /** One of the allowlisted presentation templates (src/lib/content/templates.ts). */
    template: text("template").notNull(),
    /** schema.org type used for JSON-LD, from an allowlist. */
    schemaType: text("schema_type").notNull().default("CreativeWork"),
    icon: text("icon").notNull().default("file"),
    /** 'type' → /{type}/{slug}; 'root' → /{slug} (standalone pages). */
    routing: text("routing").notNull().default("type"),
    position: integer("position").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    indexable: boolean("indexable").notNull().default(true),
    inFeeds: boolean("in_feeds").notNull().default(true),
    showInQuickCreate: boolean("show_in_quick_create").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("content_types_routing_chk", sql`${t.routing} in ('type', 'root')`)],
);

export const contentTypeFields = studio.table(
  "content_type_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentTypeId: uuid("content_type_id")
      .notNull()
      .references(() => contentTypes.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    /** Optional semantic role that templates and JSON-LD bind to (e.g. "videoUrl"). */
    role: text("role"),
    required: boolean("required").notNull().default(false),
    helpText: text("help_text").notNull().default(""),
    options: jsonb("options").notNull().default({}),
    showInFacts: boolean("show_in_facts").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("content_type_fields_key_uq").on(t.contentTypeId, t.key),
    uniqueIndex("content_type_fields_role_uq")
      .on(t.contentTypeId, t.role)
      .where(sql`${t.role} is not null`),
  ],
);

export const media = studio.table(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    /** Server-generated object key of the original/primary rendition. Never user-controlled. */
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    originalName: text("original_name").notNull().default(""),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    variants: jsonb("variants").notNull().default([]),
    placeholder: text("placeholder"),
    dominantColor: text("dominant_color"),
    alt: text("alt").notNull().default(""),
    caption: text("caption").notNull().default(""),
    focalX: real("focal_x"),
    focalY: real("focal_y"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("media_kind_chk", sql`${t.kind} in ('image', 'file', 'audio')`), index("media_created_idx").on(t.createdAt)],
);

export const documents = studio.table(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    typeId: uuid("type_id")
      .notNull()
      .references(() => contentTypes.id, { onDelete: "restrict" }),
    title: text("title").notNull().default(""),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("draft"),
    visibility: text("visibility").notNull().default("private"),
    excerpt: text("excerpt").notNull().default(""),
    /** Editor document (ProseMirror JSON), validated against the block allowlist on every write. */
    content: jsonb("content").notNull().default({ type: "doc", content: [] }),
    plainText: text("plain_text").notNull().default(""),
    wordCount: integer("word_count").notNull().default(0),
    readingMinutes: integer("reading_minutes").notNull().default(0),
    properties: jsonb("properties").notNull().default({}),
    featuredMediaId: uuid("featured_media_id").references(() => media.id, { onDelete: "set null" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    canonicalUrl: text("canonical_url"),
    /** 'default' follows visibility rules; 'index'/'noindex' are explicit overrides. */
    robotsIndex: text("robots_index").notNull().default("default"),
    featured: boolean("featured").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    templateOverride: text("template_override"),
    /** Private editor notes. Never rendered publicly or returned by public APIs. */
    notes: text("notes").notNull().default(""),
    /** Staged body edits for a published document ("Publish changes" applies them). */
    workingCopy: jsonb("working_copy"),
    version: integer("version").notNull().default(1),
    /** Set exactly when status is 'trashed' (documents_trash_chk); cleared on restore. */
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    trashedBy: uuid("trashed_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Taxonomy names and searchable property values, maintained by the service layer. */
    searchExtra: text("search_extra").notNull().default(""),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(excerpt, '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce(search_extra, '')), 'B') || setweight(to_tsvector('english'::regconfig, left(coalesce(plain_text, ''), 250000)), 'D')`,
    ),
  },
  (t) => [
    unique("documents_type_slug_uq").on(t.typeId, t.slug),
    check("documents_status_chk", sql`${t.status} in ('idea', 'draft', 'scheduled', 'published', 'archived', 'trashed')`),
    check("documents_trash_chk", sql`(${t.status} = 'trashed') = (${t.trashedAt} is not null)`),
    check("documents_visibility_chk", sql`${t.visibility} in ('private', 'unlisted', 'public')`),
    check("documents_robots_chk", sql`${t.robotsIndex} in ('default', 'index', 'noindex')`),
    index("documents_public_idx").on(t.status, t.visibility, t.publishedAt),
    index("documents_type_idx").on(t.typeId, t.publishedAt),
    index("documents_updated_idx").on(t.updatedAt),
    index("documents_search_idx").using("gin", t.searchVector),
    index("documents_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
  ],
);

export const categories = studio.table(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    intro: jsonb("intro"),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    accent: text("accent"),
    featured: boolean("featured").notNull().default(false),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    robotsIndex: text("robots_index").notNull().default("auto"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("categories_robots_chk", sql`${t.robotsIndex} in ('auto', 'index', 'noindex')`), index("categories_parent_idx").on(t.parentId)],
);

export const tags = studio.table(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    robotsIndex: text("robots_index").notNull().default("auto"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("tags_robots_chk", sql`${t.robotsIndex} in ('auto', 'index', 'noindex')`)],
);

export const documentCategories = studio.table(
  "document_categories",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.categoryId] }), index("document_categories_category_idx").on(t.categoryId)],
);

export const documentTags = studio.table(
  "document_tags",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.tagId] }), index("document_tags_tag_idx").on(t.tagId)],
);

export const documentRelations = studio.table(
  "document_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** 'manual' = curated in the editor; 'content' = extracted from links/mentions in the body. */
    origin: text("origin").notNull().default("manual"),
    note: text("note").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_relations_uq").on(t.sourceId, t.targetId, t.kind, t.origin),
    check("document_relations_self_chk", sql`${t.sourceId} <> ${t.targetId}`),
    check("document_relations_origin_chk", sql`${t.origin} in ('manual', 'content')`),
    index("document_relations_target_idx").on(t.targetId),
  ],
);

export const collectionItems = studio.table(
  "collection_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    groupLabel: text("group_label").notNull().default(""),
    note: text("note").notNull().default(""),
  },
  (t) => [
    unique("collection_items_uq").on(t.collectionId, t.documentId),
    check("collection_items_self_chk", sql`${t.collectionId} <> ${t.documentId}`),
    index("collection_items_document_idx").on(t.documentId),
    index("collection_items_collection_idx").on(t.collectionId),
  ],
);

// ---------------------------------------------------------------------------
// Site structure
// ---------------------------------------------------------------------------

export const redirects = studio.table(
  "redirects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromPath: text("from_path").notNull().unique(),
    toPath: text("to_path").notNull(),
    matchType: text("match_type").notNull().default("exact"),
    statusCode: integer("status_code").notNull().default(308),
    source: text("source").notNull().default("manual"),
    hits: integer("hits").notNull().default(0),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("redirects_match_chk", sql`${t.matchType} in ('exact', 'prefix')`),
    check("redirects_status_chk", sql`${t.statusCode} in (301, 302, 307, 308)`),
    check("redirects_distinct_chk", sql`${t.fromPath} <> ${t.toPath}`),
  ],
);

export const navigationItems = studio.table(
  "navigation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    location: text("location").notNull(),
    label: text("label").notNull(),
    linkType: text("link_type").notNull(),
    href: text("href"),
    refId: uuid("ref_id"),
    parentId: uuid("parent_id").references((): AnyPgColumn => navigationItems.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    visible: boolean("visible").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("navigation_location_chk", sql`${t.location} in ('primary', 'footer')`),
    check("navigation_link_type_chk", sql`${t.linkType} in ('internal', 'external', 'content_type', 'category', 'document', 'group')`),
  ],
);

export const siteSettings = studio.table("site_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Operational
// ---------------------------------------------------------------------------

export const contactMessages = studio.table(
  "contact_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    reason: text("reason").notNull().default(""),
    message: text("message").notNull(),
    /** HMAC of the client IP — lets abuse be spotted without storing addresses. */
    ipHash: text("ip_hash").notNull().default(""),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("contact_messages_created_idx").on(t.createdAt)],
);

export const rateLimits = studio.table("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export const auditLogs = studio.table(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull().default(""),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    // Bulk operations write one row per batch, grouped (and undone) by this id.
    index("audit_logs_operation_idx")
      .on(sql`(${t.metadata}->>'operationId')`)
      .where(sql`${t.metadata} ? 'operationId'`),
  ],
);

// ---------------------------------------------------------------------------
// Import / export (docs/IMPORT-EXPORT-ARCHITECTURE.md)
// ---------------------------------------------------------------------------

/** One import, from staging through preview to its final report. Resumable: all state lives here. */
export const importJobs = studio.table(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("staging"),
    sourceName: text("source_name").notNull().default(""),
    sourceSystem: text("source_system"),
    schemaVersion: integer("schema_version"),
    /** Parse options and browser-side hints (e.g. an .obsidian folder was present). */
    options: jsonb("options").notNull().default({}),
    decisions: jsonb("decisions").notNull().default({}),
    /** The latest dry-run plan (no document bodies). */
    plan: jsonb("plan"),
    planHash: text("plan_hash"),
    /** Planned and final counts, shown in history. */
    summary: jsonb("summary").notNull().default({}),
    error: text("error"),
    fileCount: integer("file_count").notNull().default(0),
    textBytes: integer("text_bytes").notNull().default(0),
    /** A `run` request holds this lease so two tabs can't execute the same job at once. */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check("import_jobs_status_chk", sql`${t.status} in ('staging', 'analyzed', 'running', 'completed', 'partial', 'failed', 'cancelled')`),
    index("import_jobs_created_idx").on(t.createdAt),
  ],
);

/** Staged source files. Text is deleted when the job finishes; only metadata stays. */
export const importFiles = studio.table(
  "import_files",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256"),
    /** Leading bytes of media files (base64), for signature checks during analysis. */
    head: text("head"),
    content: text("content"),
    createdAt: createdAt(),
  },
  (t) => [unique("import_files_path_uq").on(t.jobId, t.path)],
);

/** One unit of approved work and its outcome. Retries run only items that are not done. */
export const importItems = studio.table(
  "import_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    stage: text("stage").notNull(),
    key: text("key").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    label: text("label").notNull().default(""),
    targetId: uuid("target_id"),
    error: text("error"),
    payload: jsonb("payload").notNull().default({}),
    result: jsonb("result").notNull().default({}),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("import_items_key_uq").on(t.jobId, t.key),
    check("import_items_status_chk", sql`${t.status} in ('pending', 'done', 'skipped', 'failed', 'cancelled')`),
    index("import_items_queue_idx").on(t.jobId, t.status, t.seq),
  ],
);

/**
 * Stable identifiers that survive moving content between sites. Exactly one
 * entity column is set; it cascades, so identities vanish with their record.
 */
export const portableIdentities = studio.table(
  "portable_identities",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    portableId: text("portable_id").notNull(),
    entity: text("entity").notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").references(() => tags.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "cascade" }),
    /** Where the identity came from: "studio-portable", "folder", "notion", "obsidian"… */
    source: text("source").notNull().default(""),
    /** Provenance (source path, original id) and source metadata this site couldn't map. */
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("portable_identities_uq").on(t.entity, t.portableId),
    check("portable_identities_entity_chk", sql`${t.entity} in ('document', 'topic', 'tag', 'media')`),
    check(
      "portable_identities_target_chk",
      sql`(${t.entity} = 'document' and ${t.documentId} is not null and ${t.categoryId} is null and ${t.tagId} is null and ${t.mediaId} is null)
       or (${t.entity} = 'topic' and ${t.categoryId} is not null and ${t.documentId} is null and ${t.tagId} is null and ${t.mediaId} is null)
       or (${t.entity} = 'tag' and ${t.tagId} is not null and ${t.documentId} is null and ${t.categoryId} is null and ${t.mediaId} is null)
       or (${t.entity} = 'media' and ${t.mediaId} is not null and ${t.documentId} is null and ${t.categoryId} is null and ${t.tagId} is null)`,
    ),
    index("portable_identities_document_idx").on(t.documentId),
    index("portable_identities_category_idx").on(t.categoryId),
    index("portable_identities_tag_idx").on(t.tagId),
    index("portable_identities_media_idx").on(t.mediaId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type ContentTypeRow = typeof contentTypes.$inferSelect;
export type ContentTypeFieldRow = typeof contentTypeFields.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
export type RedirectRow = typeof redirects.$inferSelect;
export type NavigationItemRow = typeof navigationItems.$inferSelect;
export type ContactMessageRow = typeof contactMessages.$inferSelect;
