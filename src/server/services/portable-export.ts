import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { isUuid, sanitizeDoc } from "@/lib/content/blocks";
import { extractReferences } from "@/lib/content/derive";
import { docToMarkdown, frontMatter } from "@/lib/content/markdown";
import { documentPath } from "@/lib/content/paths";
import { toPortableDoc } from "@/lib/portability/doc-refs";
import { assetFileName, relativePath, rewriteForMarkdown } from "@/lib/portability/export-layout";
import { EXPORT_LIMITS } from "@/lib/portability/limits";
import { PORTABLE_FORMAT, PORTABLE_SCHEMA_VERSION, type PortableManifest } from "@/lib/portability/manifest";
import { sha256Hex } from "@/lib/portability/parse";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb } from "../db/client";
import { categories, collectionItems, documentCategories, documentRelations, documents, documentTags, media, portableIdentities, redirects, tags, type DocumentRow, type MediaRow } from "../db/schema";
import { siteUrl } from "../env";
import { invalid, notFound, ServiceError } from "../errors";
import { getStorage } from "../media/storage";
import { CONTENT_TYPE_BY_EXT } from "../media/validation";
import { recordAudit } from "./audit";
import { loadContentTypes, type ContentType } from "./content-types";

/**
 * Portable exports, assembled by the browser from three kinds of request:
 * the manifest (+ summary), pages of content files, and one media file at a
 * time. No single response is large, nothing is written to storage, and no
 * export artifact ever exists on the server.
 */

const ids = z.array(z.string().refine(isUuid)).min(1).max(5000);
const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("documents"), ids }),
  z.object({ kind: z.literal("types"), ids }),
  z.object({ kind: z.literal("topics"), ids, includeSubtopics: z.boolean().default(true) }),
  z.object({ kind: z.literal("tags"), ids }),
  z.object({ kind: z.literal("collections"), ids }),
]);
export const exportRequestSchema = z.object({
  scope: scopeSchema,
  format: z.enum(["portable", "markdown", "manifest", "media"]),
  includePrivate: z.boolean().default(true),
  page: z.number().int().min(0).max(10000).default(0),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

export type ExportFile = { path: string; text: string };
export type ExportAsset = { id: string; pid: string; path: string; size: number; mimeType: string };

export type ExportSummary = {
  documents: number;
  privateOrDraft: number;
  byType: Record<string, number>;
  topics: number;
  tags: number;
  assets: number;
  assetBytes: number;
  relations: number;
  collections: number;
  excludedReferences: number;
  pages: number;
  warnings: string[];
};

function parseRequest(input: unknown): ExportRequest {
  const parsed = exportRequestSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid export request.");
  return parsed.data;
}

type Loaded = Awaited<ReturnType<typeof loadExport>>;

/** Selection + everything needed to serialise it, in a deterministic order. */
async function loadExport(req: ExportRequest) {
  const db = getDb();
  const [types, catRows, tagRows, allDocs, docCats, docTags, relRows, itemRows, identities, redirectRows] = await Promise.all([
    loadContentTypes(db),
    db.select().from(categories).orderBy(asc(categories.position), asc(categories.slug)),
    db.select().from(tags).orderBy(asc(tags.slug)),
    db.select().from(documents).orderBy(asc(documents.createdAt), asc(documents.id)),
    db.select().from(documentCategories),
    db.select().from(documentTags),
    db.select().from(documentRelations).orderBy(asc(documentRelations.position)),
    db.select().from(collectionItems).orderBy(asc(collectionItems.position)),
    db.select().from(portableIdentities),
    db.select().from(redirects),
  ]);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const scope = req.scope;
  let selected: DocumentRow[];
  switch (scope.kind) {
    case "all":
      selected = allDocs;
      break;
    case "documents":
      selected = allDocs.filter((d) => scope.ids.includes(d.id));
      break;
    case "types":
      selected = allDocs.filter((d) => scope.ids.includes(d.typeId));
      break;
    case "topics": {
      const wanted = new Set(scope.ids);
      if (scope.includeSubtopics) {
        let grew = true;
        while (grew) {
          grew = false;
          for (const c of catRows) {
            if (c.parentId && wanted.has(c.parentId) && !wanted.has(c.id)) {
              wanted.add(c.id);
              grew = true;
            }
          }
        }
      }
      const docIds = new Set(docCats.filter((dc) => wanted.has(dc.categoryId)).map((dc) => dc.documentId));
      selected = allDocs.filter((d) => docIds.has(d.id));
      break;
    }
    case "tags": {
      const docIds = new Set(docTags.filter((dt) => scope.ids.includes(dt.tagId)).map((dt) => dt.documentId));
      selected = allDocs.filter((d) => docIds.has(d.id));
      break;
    }
    case "collections": {
      const docIds = new Set([...scope.ids, ...itemRows.filter((i) => scope.ids.includes(i.collectionId)).map((i) => i.documentId)]);
      selected = allDocs.filter((d) => docIds.has(d.id));
      break;
    }
  }
  // The Trash is never exported: re-importing a package must not bring deleted work back.
  selected = selected.filter((d) => d.status !== "trashed");
  // Published-only means public and listed: no drafts, ideas, archived, private or unlisted documents.
  const isPublic = (d: DocumentRow) => d.status === "published" && d.visibility === "public";
  if (!req.includePrivate) selected = selected.filter(isPublic);
  const publicIds = new Set(allDocs.filter(isPublic).map((d) => d.id));
  const hidden = (id: string) => !req.includePrivate && !publicIds.has(id);
  // Stable order: format order, then creation.
  const typePos = new Map(types.map((t, i) => [t.id, i]));
  selected.sort((a, b) => (typePos.get(a.typeId) ?? 0) - (typePos.get(b.typeId) ?? 0) || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  if (!selected.length && req.format !== "media") throw invalid("Nothing matches this selection.");

  const selectedIds = new Set(selected.map((d) => d.id));
  const identityOf = (column: "documentId" | "categoryId" | "tagId" | "mediaId", id: string) => identities.find((i) => i[column] === id);
  const docPid = (id: string) => (selectedIds.has(id) ? (identityOf("documentId", id)?.portableId ?? `studio:document:${id}`) : null);

  // Media referenced by the selection (or the whole library for "all" + media-only).
  const mediaIds = new Set<string>();
  const storage = getStorage();
  const keyFromUrl = (src: string) => {
    const m = /(?:^|\/)((?:media|files|audio)\/\d{4}\/\d{2}\/[0-9a-f-]{36}(?:-w\d+)?\.\w+)$/.exec(src.split(/[?#]/)[0]!);
    return m ? m[1]!.replace(/-w\d+(?=\.)/, "") : null;
  };
  const urlKeys = new Set<string>();
  for (const doc of selected) {
    const type = typeById.get(doc.typeId);
    if (doc.featuredMediaId) mediaIds.add(doc.featuredMediaId);
    const content = sanitizeDoc(doc.content);
    extractReferences(content).mediaIds.forEach((id) => mediaIds.add(id));
    JSON.stringify(content).replace(/"src":"([^"]+)"/g, (_, src: string) => {
      const key = keyFromUrl(src);
      if (key) urlKeys.add(key);
      return "";
    });
    for (const field of type?.fields ?? []) {
      const value = (doc.properties as Record<string, unknown>)[field.key];
      if ((field.type === "image" || field.type === "file") && isUuid(value)) mediaIds.add(value);
    }
  }
  const mediaRows: MediaRow[] =
    req.format === "media" && req.scope.kind === "all" && req.includePrivate
      ? await db.select().from(media).orderBy(asc(media.createdAt))
      : mediaIds.size || urlKeys.size
        ? (await db.select().from(media).orderBy(asc(media.createdAt))).filter((m) => mediaIds.has(m.id) || urlKeys.has(m.storageKey))
        : [];
  const includeAssets = req.format === "portable" || req.format === "markdown" || req.format === "media";
  const assets = mediaRows.map((m) => ({
    row: m,
    pid: identityOf("mediaId", m.id)?.portableId && !identityOf("mediaId", m.id)!.portableId.startsWith("sha256:") ? identityOf("mediaId", m.id)!.portableId : `studio:media:${m.id}`,
    path: `media/${assetFileName(m.originalName || "file", m.id, m.storageKey)}`,
  }));
  const assetById = new Map(assets.map((a) => [a.row.id, a]));
  const assetByKey = new Map(assets.map((a) => [a.row.storageKey, a]));
  const assetFor = (mediaId: string | null, src: string) => (mediaId ? assetById.get(mediaId) : undefined) ?? (keyFromUrl(src) ? assetByKey.get(keyFromUrl(src)!) : undefined) ?? null;

  // Every document's path, so links to documents outside the selection can be reported as excluded.
  const pathToAnyId = new Map(allDocs.map((d) => [typeById.get(d.typeId) ? documentPath(typeById.get(d.typeId)!, d.slug) : `/${d.slug}`, d.id]));
  return { types, typeById, catRows, tagRows, selected, selectedIds, docCats, docTags, relRows, itemRows, identities, identityOf, docPid, assets, assetFor, includeAssets, redirectRows, storage, pathToAnyId, hidden };
}

function pathOf(l: Loaded, doc: DocumentRow): string {
  const type = l.typeById.get(doc.typeId);
  return type ? documentPath(type, doc.slug) : `/${doc.slug}`;
}

function contentFilePath(type: ContentType | undefined, slug: string): string {
  return `content/${type?.slug ?? "unknown"}/${slug}.md`;
}

/** Folder layout for the human-readable Markdown export: topics → sub-topics, collections as numbered folders. */
function markdownPaths(l: Loaded): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const catById = new Map(l.catRows.map((c) => [c.id, c]));
  const topicDir = (docId: string): string => {
    const links = l.docCats.filter((dc) => dc.documentId === docId);
    const primary = links.find((dc) => dc.isPrimary) ?? links[0];
    const trail: string[] = [];
    let cursor = primary ? catById.get(primary.categoryId) : undefined;
    while (cursor && trail.length < 4) {
      trail.unshift(cursor.slug);
      cursor = cursor.parentId ? catById.get(cursor.parentId) : undefined;
    }
    return trail.join("/");
  };
  const claim = (path: string) => {
    let candidate = path;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = path.replace(/\.md$/, `-${n}.md`);
    used.add(candidate.toLowerCase());
    return candidate;
  };
  // Collections first: they own their members' files.
  for (const doc of l.selected) {
    const type = l.typeById.get(doc.typeId);
    if (type?.template !== "collection") continue;
    const base = [topicDir(doc.id), doc.slug].filter(Boolean).join("/");
    out.set(doc.id, claim(`${base}/README.md`));
    const members = l.itemRows.filter((i) => i.collectionId === doc.id && l.selectedIds.has(i.documentId) && !out.has(i.documentId));
    const width = String(members.length).length < 2 ? 2 : String(members.length).length;
    members.forEach((item, n) => {
      const member = l.selected.find((d) => d.id === item.documentId)!;
      out.set(member.id, claim(`${base}/${String(n + 1).padStart(width, "0")}-${member.slug}.md`));
    });
  }
  for (const doc of l.selected) {
    if (out.has(doc.id)) continue;
    const type = l.typeById.get(doc.typeId);
    const dir = topicDir(doc.id) || type?.slug || "documents";
    out.set(doc.id, claim(`${dir}/${doc.slug}.md`));
  }
  return out;
}

type Built = { manifest: PortableManifest; files: Array<{ docId: string; files: ExportFile[] }>; extras: ExportFile[]; summary: ExportSummary };

async function build(req: ExportRequest): Promise<Built> {
  const l = await loadExport(req);
  const site = siteUrl();
  const excluded: PortableManifest["excludedReferences"] = [];
  const warnings: string[] = [];
  const catById = new Map(l.catRows.map((c) => [c.id, c]));
  const tagById = new Map(l.tagRows.map((t) => [t.id, t]));
  const docByPath = new Map(l.selected.map((d) => [pathOf(l, d), d]));
  const mdPaths = req.format === "markdown" ? markdownPaths(l) : null;
  const filePathOf = (doc: DocumentRow) => mdPaths?.get(doc.id) ?? contentFilePath(l.typeById.get(doc.typeId), doc.slug);

  // Topics used by the selection, with their ancestors so the hierarchy survives.
  const topicIds = new Set<string>();
  for (const dc of l.docCats) if (l.selectedIds.has(dc.documentId)) {
    let cursor: string | null = dc.categoryId;
    while (cursor && !topicIds.has(cursor)) {
      topicIds.add(cursor);
      cursor = catById.get(cursor)?.parentId ?? null;
    }
  }
  const topicPid = (id: string) => l.identityOf("categoryId", id)?.portableId ?? `studio:topic:${id}`;
  const tagPid = (id: string) => l.identityOf("tagId", id)?.portableId ?? `studio:tag:${id}`;
  const tagIds = new Set(l.docTags.filter((dt) => l.selectedIds.has(dt.documentId)).map((dt) => dt.tagId));

  const manifestDocs: PortableManifest["documents"] = [];
  const files: Built["files"] = [];
  let privateOrDraft = 0;
  const byType: Record<string, number> = {};
  for (const doc of l.selected) {
    const type = l.typeById.get(doc.typeId);
    byType[type?.slug ?? "unknown"] = (byType[type?.slug ?? "unknown"] ?? 0) + 1;
    if (doc.status !== "published" || doc.visibility === "private") privateOrDraft++;
    const pid = l.docPid(doc.id)!;
    const identity = l.identityOf("documentId", doc.id);
    const content = sanitizeDoc(doc.content);
    const portable = toPortableDoc(
      content,
      {
        docPid: (id) => l.docPid(id),
        docIdForPath: (path) => l.pathToAnyId.get(path) ?? null,
        hidden: l.hidden,
        assetPid: (mediaId, src) => (l.includeAssets ? (l.assetFor(mediaId, src)?.pid ?? null) : null),
        excluded: (kind, target) => excluded.push({ from: pid, kind, target: String(target).slice(0, 200) }),
      },
      site,
    );
    const filePath = filePathOf(doc);
    const properties: Record<string, unknown> = {};
    for (const field of type?.fields ?? []) {
      const value = (doc.properties as Record<string, unknown>)[field.key];
      if (value === undefined || value === null) continue;
      if (field.type === "image" || field.type === "file") {
        const asset = typeof value === "string" ? l.assetFor(value, "") : null;
        if (asset && l.includeAssets) properties[field.key] = req.format === "markdown" ? relativePath(filePath, asset.path) : `asset:${asset.pid}`;
        else excluded.push({ from: pid, kind: "media", target: String(value) });
      } else if (field.type === "relation") {
        const values = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string");
        const mapped = values.flatMap((v) => {
          const target = l.selected.find((d) => d.id === v);
          if (!target) {
            excluded.push({ from: pid, kind: "relation-field", target: v });
            return [];
          }
          return [req.format === "markdown" ? target.slug : `pid:${l.docPid(v)}`];
        });
        if (mapped.length) properties[field.key] = Array.isArray(value) ? mapped : mapped[0];
      } else properties[field.key] = value;
    }
    const legacyUrls = l.redirectRows.filter((r) => r.toPath === pathOf(l, doc) && r.matchType === "exact").map((r) => r.fromPath);
    const featured = doc.featuredMediaId && l.includeAssets ? (l.assetFor(doc.featuredMediaId, "") ?? null) : null;
    if (doc.featuredMediaId && !featured) excluded.push({ from: pid, kind: "media", target: doc.featuredMediaId });
    const topicLinks = l.docCats.filter((dc) => dc.documentId === doc.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    const docTagIds = l.docTags.filter((dt) => dt.documentId === doc.id).map((dt) => dt.tagId);
    const provenance: Record<string, unknown> = identity ? { ...((identity.metadata ?? {}) as Record<string, unknown>), importedAs: identity.source } : {};
    const unmapped = (provenance.unmapped as Record<string, unknown> | undefined) ?? {};
    delete provenance.unmapped;
    if (doc.workingCopy) warnings.push(`"${doc.title}" has unpublished staged edits; its live version was exported.`);

    // Markdown: links to other exported files become relative paths.
    const mdDoc = rewriteForMarkdown(
      content,
      {
        isHidden: (path) => {
          const id = l.pathToAnyId.get(path);
          return Boolean(id && l.hidden(id));
        },
        docHref: ({ path }) => {
          const target = path ? docByPath.get(path) : undefined;
          return target ? relativePath(filePath, filePathOf(target)) : null;
        },
        mediaHref: (mediaId, src) => {
          const asset = l.includeAssets ? l.assetFor(mediaId, src) : null;
          return asset ? relativePath(filePath, asset.path) : null;
        },
      },
      site,
    );
    const frontmatter: Record<string, unknown> = {
      id: pid,
      title: doc.title,
      slug: doc.slug,
      type: type?.slug,
      status: doc.status,
      visibility: doc.visibility,
      excerpt: doc.excerpt || undefined,
      seoTitle: doc.seoTitle ?? undefined,
      seoDescription: doc.seoDescription ?? undefined,
      canonical: doc.canonicalUrl ?? undefined,
      date: doc.publishedAt?.toISOString(),
      updated: (doc.modifiedAt ?? doc.updatedAt).toISOString(),
      created: doc.createdAt.toISOString(),
      categories: topicLinks.map((dc) => catById.get(dc.categoryId)?.slug).filter(Boolean),
      tags: docTagIds.map((id) => tagById.get(id)?.name).filter(Boolean),
      cover: featured ? relativePath(filePath, featured.path) : undefined,
      related: l.relRows.filter((r) => r.sourceId === doc.id && r.origin === "manual" && l.selectedIds.has(r.targetId)).map((r) => {
        const target = l.selected.find((d) => d.id === r.targetId)!;
        return req.format === "markdown" ? target.slug : relativePath(filePath, filePathOf(target));
      }),
      redirect_from: legacyUrls.length ? legacyUrls : undefined,
      ...(type?.template === "collection" && req.format === "markdown" ? { collection: true } : {}),
      ...properties,
      ...(Object.keys(unmapped).length ? { source: unmapped } : {}),
    };
    if (!(frontmatter.related as unknown[]).length) delete frontmatter.related;
    const markdown = frontMatter(frontmatter) + `# ${doc.title}\n\n` + docToMarkdown(mdDoc, {
      resolveDocument: (id) => {
        const target = l.selected.find((d) => d.id === id);
        return target ? { title: target.title, url: relativePath(filePath, filePathOf(target)) } : null;
      },
    });
    const docJsonPath = filePath.replace(/\.md$/, ".doc.json");
    const docFiles: ExportFile[] =
      req.format === "portable"
        ? [{ path: filePath, text: markdown }, { path: docJsonPath, text: JSON.stringify(portable) }]
        : req.format === "markdown"
          ? [{ path: filePath, text: markdown }]
          : [];
    files.push({ docId: doc.id, files: docFiles });

    manifestDocs.push({
      pid,
      originalId: doc.id,
      type: type?.slug ?? "unknown",
      title: doc.title,
      slug: doc.slug,
      status: doc.status,
      visibility: doc.visibility,
      excerpt: doc.excerpt,
      seo: { title: doc.seoTitle, description: doc.seoDescription, canonicalUrl: doc.canonicalUrl, robotsIndex: doc.robotsIndex },
      featured: doc.featured,
      priority: doc.priority,
      dates: { createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString(), publishedAt: doc.publishedAt?.toISOString() ?? null, modifiedAt: doc.modifiedAt?.toISOString() ?? null },
      author: null,
      topics: topicLinks.map((dc) => ({ pid: topicPid(dc.categoryId), primary: dc.isPrimary })),
      tags: docTagIds.map(tagPid),
      featuredAsset: featured?.pid ?? null,
      properties: req.format === "markdown" ? {} : properties,
      // Editor notes are private: only a full (include private) export carries them.
      notes: req.includePrivate ? doc.notes : "",
      body: req.format === "portable" ? { markdown: filePath, markdownSha256: await sha256Hex(markdown), doc: docJsonPath } : null,
      legacyUrls,
      provenance,
      unmapped,
      hasStagedChanges: doc.workingCopy !== null,
    });
  }

  const relations: PortableManifest["relations"] = [];
  for (const r of l.relRows) {
    if (r.origin !== "manual" || !l.selectedIds.has(r.sourceId)) continue;
    if (!l.selectedIds.has(r.targetId)) {
      excluded.push({ from: l.docPid(r.sourceId)!, kind: "relation", target: r.targetId });
      continue;
    }
    relations.push({ source: l.docPid(r.sourceId)!, target: l.docPid(r.targetId)!, kind: r.kind, note: r.note, position: r.position });
  }
  const collections: PortableManifest["collections"] = [];
  for (const doc of l.selected) {
    if (l.typeById.get(doc.typeId)?.template !== "collection") continue;
    const members = l.itemRows.filter((i) => i.collectionId === doc.id);
    for (const m of members) if (!l.selectedIds.has(m.documentId)) excluded.push({ from: l.docPid(doc.id)!, kind: "collection-item", target: m.documentId });
    collections.push({
      collection: l.docPid(doc.id)!,
      items: members.filter((m) => l.selectedIds.has(m.documentId)).map((m) => ({ document: l.docPid(m.documentId)!, position: m.position, groupLabel: m.groupLabel, note: m.note })),
    });
  }

  if (privateOrDraft) warnings.push(`${privateOrDraft} document${privateOrDraft === 1 ? " is" : "s are"} private or unpublished. Keep this export private.`);
  if (req.format === "manifest") warnings.push("Manifest only: document bodies and media files are not included; references to them are listed by identifier.");

  const manifest: PortableManifest = {
    format: PORTABLE_FORMAT,
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: { app: "karthikeyan-a-studio", appVersion: "1.0.0" },
    scope: { kind: req.scope.kind, description: scopeDescription(req) },
    contents: { bodies: req.format === "portable", media: l.includeAssets },
    contentTypes: l.types
      .filter((t) => l.selected.some((d) => d.typeId === t.id))
      .map((t) => ({ slug: t.slug, name: t.name, pluralName: t.pluralName, template: t.template, routing: t.routing, fields: t.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, role: f.role })) })),
    topics: l.catRows
      .filter((c) => topicIds.has(c.id))
      .map((c) => ({ pid: topicPid(c.id), name: c.name, slug: c.slug, description: c.description, parent: c.parentId && topicIds.has(c.parentId) ? topicPid(c.parentId) : null, originalId: c.id })),
    tags: l.tagRows.filter((t) => tagIds.has(t.id)).map((t) => ({ pid: tagPid(t.id), name: t.name, slug: t.slug, description: t.description, originalId: t.id })),
    assets: l.includeAssets
      ? l.assets.map((a) => ({ pid: a.pid, path: a.path, originalName: a.row.originalName, mimeType: a.row.mimeType, sizeBytes: a.row.sizeBytes, sha256: null, alt: a.row.alt, caption: a.row.caption, width: a.row.width, height: a.row.height, originalId: a.row.id }))
      : [],
    documents: req.format === "media" ? [] : manifestDocs,
    relations: req.format === "media" ? [] : relations,
    collections: req.format === "media" ? [] : collections,
    // In a published-only export even the ids of non-public documents are withheld.
    excludedReferences: req.includePrivate ? excluded : excluded.map((e) => (e.kind === "media" ? e : { ...e, target: "(not public)" })),
    warnings,
  };

  const extras: ExportFile[] = [{ path: req.format === "markdown" ? "EXPORT.md" : "README.md", text: readme(req, manifest) }];
  const pageSize = EXPORT_LIMITS.documentsPerPage;
  return {
    manifest,
    files,
    extras,
    summary: {
      documents: req.format === "media" ? 0 : manifestDocs.length,
      privateOrDraft,
      byType,
      topics: manifest.topics.length,
      tags: manifest.tags.length,
      assets: manifest.assets.length,
      assetBytes: manifest.assets.reduce((n, a) => n + a.sizeBytes, 0),
      relations: relations.length,
      collections: collections.length,
      excludedReferences: excluded.length,
      pages: req.format === "portable" || req.format === "markdown" ? Math.ceil(files.length / pageSize) : 0,
      warnings,
    },
  };
}

function scopeDescription(req: ExportRequest): string {
  const s = req.scope;
  const what = s.kind === "all" ? "Entire site" : `${s.ids.length} selected ${s.kind}`;
  return `${what}${req.includePrivate ? "" : " (published, non-private only)"} — ${req.format}`;
}

function readme(req: ExportRequest, manifest: PortableManifest): string {
  const lines = [
    `# Content export`,
    "",
    `Exported ${manifest.exportedAt} from ${siteUrl()} (${manifest.scope.description}).`,
    "",
  ];
  if (req.format === "markdown") {
    lines.push(
      "One Markdown file per document with YAML front matter. Folders follow topics; collections and courses are folders with a README.md and numbered lessons.",
      "Images and files are in `media/` and are linked with relative paths, so this folder works without the original site.",
      "",
      "Importing this folder into the studio again recreates topics, tags, collections and order (front matter `id` keeps identity).",
    );
  } else {
    lines.push(
      "This is a portable studio package (`manifest.json`, format `studio-portable` v1).",
      "",
      "- `manifest.json` — every record with portable ids, topics, tags, relations, collections, media checksums and anything the site couldn't map.",
      "- `content/<format>/<slug>.md` — readable Markdown with front matter.",
      "- `content/<format>/<slug>.doc.json` — the exact editor document, used when importing (unless the .md was edited).",
      "- `media/` — images, PDFs and audio referenced by the content.",
      "",
      "Import it from Studio → Import. Database ids are informational only; identity travels through the portable ids.",
    );
  }
  if (manifest.excludedReferences.length) lines.push("", `${manifest.excludedReferences.length} reference(s) point outside this export; they are listed in manifest.json → excludedReferences.`);
  if (manifest.warnings.length) lines.push("", "## Warnings", "", ...manifest.warnings.map((w) => `- ${w}`));
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

export async function exportSummary(actor: Actor, input: unknown): Promise<ExportSummary> {
  assertAdmin(actor);
  return (await build(parseRequest(input))).summary;
}

/** Manifest, extra files (README) and the asset list; content files come from exportPage(). */
export async function exportManifest(actor: Actor, input: unknown): Promise<{ manifest: PortableManifest; extras: ExportFile[]; assets: ExportAsset[]; summary: ExportSummary }> {
  assertAdmin(actor);
  const req = parseRequest(input);
  const built = await build(req);
  await recordAudit(actor, "export.start", "export", null, built.manifest.scope.description, { documents: built.summary.documents, assets: built.summary.assets, format: req.format });
  return {
    manifest: built.manifest,
    extras: built.extras,
    assets: built.manifest.assets.map((a) => ({ id: a.originalId!, pid: a.pid, path: a.path, size: a.sizeBytes, mimeType: a.mimeType })),
    summary: built.summary,
  };
}

export async function exportPage(actor: Actor, input: unknown): Promise<{ files: ExportFile[]; page: number; pages: number }> {
  assertAdmin(actor);
  const req = parseRequest(input);
  const built = await build(req);
  const size = EXPORT_LIMITS.documentsPerPage;
  const slice = built.files.slice(req.page * size, (req.page + 1) * size).flatMap((f) => f.files);
  const bytes = slice.reduce((n, f) => n + f.text.length, 0);
  if (bytes > EXPORT_LIMITS.maxPageBytes * 1.4) throw new ServiceError("too_large", "This export page is unusually large; export fewer documents at once.");
  return { files: slice, page: req.page, pages: built.summary.pages };
}

/** One stored media object (primary rendition) for the browser to add to the package. */
export async function exportAsset(actor: Actor, id: string): Promise<{ bytes: Buffer; mimeType: string; name: string }> {
  assertAdmin(actor);
  if (!isUuid(id)) throw notFound("Media");
  const [row] = await getDb().select().from(media).where(eq(media.id, id)).limit(1);
  if (!row) throw notFound("Media");
  const bytes = await getStorage().get(row.storageKey);
  if (!bytes) throw new ServiceError("storage_error", `"${row.originalName}" is missing from storage.`);
  const ext = row.storageKey.slice(row.storageKey.lastIndexOf(".") + 1);
  return { bytes, mimeType: CONTENT_TYPE_BY_EXT[ext] ?? row.mimeType, name: assetFileName(row.originalName || "file", row.id, row.storageKey) };
}

