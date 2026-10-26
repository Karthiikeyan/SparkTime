/**
 * The portable package manifest (format "studio-portable"). Versioned
 * independently of the application. Every manifest is validated with this
 * schema before anything else reads it; ids in it are portable identifiers,
 * never trusted as destination keys. Manifest text is data, never
 * instructions.
 *
 * Upgrading: when schemaVersion 2 exists, add `upgradeV1toV2()` and keep a v1
 * fixture under test (tests/unit/portability-manifest.test.ts).
 */
import { z } from "zod";

export const PORTABLE_FORMAT = "studio-portable";
export const PORTABLE_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

const pid = z.string().trim().min(1).max(200);
const relPath = z.string().trim().min(1).max(400);
const isoDate = z.string().max(40).nullable().default(null);
const shortText = (max: number) => z.string().max(max);

const fieldSchema = z.object({ key: z.string().max(40), label: z.string().max(80), type: z.string().max(30), role: z.string().max(40).nullable().default(null) });

const contentTypeSchema = z.object({
  slug: z.string().max(96),
  name: shortText(80),
  pluralName: shortText(80).default(""),
  template: z.string().max(30),
  routing: z.string().max(10).default("type"),
  fields: z.array(fieldSchema).max(60).default([]),
});

const topicSchema = z.object({
  pid,
  name: shortText(80),
  slug: z.string().max(96),
  description: shortText(1000).default(""),
  parent: pid.nullable().default(null),
  originalId: z.string().max(100).nullable().default(null),
});

const tagSchema = z.object({
  pid,
  name: shortText(80),
  slug: z.string().max(96),
  description: shortText(1000).default(""),
  originalId: z.string().max(100).nullable().default(null),
});

const assetSchema = z.object({
  pid,
  path: relPath,
  originalName: shortText(255).default(""),
  mimeType: shortText(100).default(""),
  sizeBytes: z.number().int().nonnegative().default(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  alt: shortText(500).default(""),
  caption: shortText(1000).default(""),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  originalId: z.string().max(100).nullable().default(null),
});

const documentSchema = z.object({
  pid,
  originalId: z.string().max(100).nullable().default(null),
  type: z.string().max(96),
  title: shortText(300),
  slug: z.string().max(200),
  status: z.string().max(20).default("draft"),
  visibility: z.string().max(20).default("private"),
  excerpt: shortText(2000).default(""),
  seo: z
    .object({
      title: shortText(300).nullable().default(null),
      description: shortText(1000).nullable().default(null),
      canonicalUrl: z.string().max(2048).nullable().default(null),
      robotsIndex: z.string().max(20).default("default"),
    })
    .default({ title: null, description: null, canonicalUrl: null, robotsIndex: "default" }),
  featured: z.boolean().default(false),
  priority: z.number().int().min(-100).max(100).default(0),
  dates: z
    .object({ createdAt: isoDate, updatedAt: isoDate, publishedAt: isoDate, modifiedAt: isoDate })
    .default({ createdAt: null, updatedAt: null, publishedAt: null, modifiedAt: null }),
  author: z.string().max(200).nullable().default(null),
  topics: z.array(z.object({ pid, primary: z.boolean().default(false) })).max(20).default([]),
  tags: z.array(pid).max(50).default([]),
  featuredAsset: pid.nullable().default(null),
  properties: z.record(z.string().max(40), z.unknown()).default({}),
  notes: shortText(20000).default(""),
  body: z
    .object({
      markdown: relPath.nullable().default(null),
      markdownSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
      doc: relPath.nullable().default(null),
    })
    .nullable()
    .default(null),
  legacyUrls: z.array(z.string().max(2048)).max(20).default([]),
  provenance: z.record(z.string().max(60), z.unknown()).default({}),
  unmapped: z.record(z.string().max(200), z.unknown()).default({}),
  hasStagedChanges: z.boolean().default(false),
});

export const manifestSchema = z.object({
  format: z.literal(PORTABLE_FORMAT),
  schemaVersion: z.literal(1),
  exportedAt: z.string().max(40),
  generator: z.object({ app: z.string().max(100), appVersion: z.string().max(40).default("") }).default({ app: "unknown", appVersion: "" }),
  scope: z.object({ kind: z.string().max(40), description: z.string().max(500).default("") }).default({ kind: "all", description: "" }),
  contents: z.object({ bodies: z.boolean().default(true), media: z.boolean().default(true) }).default({ bodies: true, media: true }),
  contentTypes: z.array(contentTypeSchema).max(200).default([]),
  topics: z.array(topicSchema).max(2000).default([]),
  tags: z.array(tagSchema).max(5000).default([]),
  assets: z.array(assetSchema).max(5000).default([]),
  documents: z.array(documentSchema).max(5000).default([]),
  relations: z
    .array(z.object({ source: pid, target: pid, kind: z.string().max(30), note: shortText(300).default(""), position: z.number().int().default(0) }))
    .max(50000)
    .default([]),
  collections: z
    .array(
      z.object({
        collection: pid,
        items: z.array(z.object({ document: pid, position: z.number().int().default(0), groupLabel: shortText(120).default(""), note: shortText(1000).default("") })).max(1000),
      }),
    )
    .max(2000)
    .default([]),
  excludedReferences: z
    .array(z.object({ from: pid, kind: z.string().max(30), target: z.string().max(200) }))
    .max(50000)
    .default([]),
  warnings: z.array(z.string().max(1000)).max(5000).default([]),
});

export type PortableManifest = z.infer<typeof manifestSchema>;
export type PortableDocument = PortableManifest["documents"][number];
export type PortableAsset = PortableManifest["assets"][number];

export type ManifestParse = { ok: true; manifest: PortableManifest } | { ok: false; error: string; version?: number };

/** Validates a manifest of any supported version and returns it upgraded to the current one. */
export function parseManifest(raw: unknown): ManifestParse {
  if (!raw || typeof raw !== "object") return { ok: false, error: "manifest.json is not a JSON object." };
  const r = raw as { format?: unknown; schemaVersion?: unknown };
  if (r.format !== PORTABLE_FORMAT) return { ok: false, error: `manifest.json is not a ${PORTABLE_FORMAT} manifest.` };
  if (typeof r.schemaVersion !== "number" || !Number.isInteger(r.schemaVersion)) return { ok: false, error: "manifest.json has no schemaVersion." };
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(r.schemaVersion)) {
    return {
      ok: false,
      version: r.schemaVersion,
      error:
        r.schemaVersion > PORTABLE_SCHEMA_VERSION
          ? `This package uses format version ${r.schemaVersion}, which is newer than this site understands (up to ${PORTABLE_SCHEMA_VERSION}). Update the site, or export again with an older version.`
          : `Format version ${r.schemaVersion} is not supported.`,
    };
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, version: r.schemaVersion, error: `manifest.json is invalid at ${first?.path.join(".") || "(root)"}: ${first?.message ?? "unknown problem"}.` };
  }
  return { ok: true, manifest: parsed.data };
}
