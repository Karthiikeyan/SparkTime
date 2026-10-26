/**
 * The import planner: ParsedPackage + DestinationSnapshot + decisions →
 * ImportPlan. Pure and deterministic — the same input, destination state and
 * decisions always produce the same plan (and hash). It never writes; the
 * dry run IS this function.
 *
 * Priority rules (explicit beats inferred everywhere):
 *   type   decision → manifest/front matter (or alias) → folder decision/README → default
 *   title  decision → manifest → front matter/metadata → leading H1 → file name
 *   slug   decision → manifest/front matter → existing (updates) → generated from title
 *   topics decision → manifest/front matter → folder
 *   order  decision → front matter/manifest → README order → numeric prefix → natural name
 */
import { isUuid } from "../content/blocks";
import { deriveContent } from "../content/derive";
import { isDocumentStatus, isRelationKind, isVisibility, type DocumentStatus, type FieldDefinition, type Visibility } from "../content/model";
import { documentPath } from "../content/paths";
import { validateProperties } from "../content/properties";
import { isReservedRootSlug, isValidSlug, MAX_SLUG_LENGTH, RESERVED_ROOT_SLUGS, slugify } from "../slug";
import { safeExternalUrl, safeHref } from "../url";
import { list, normalizeKey, parseDate } from "./field-map";
import { issue, type DocTarget, type FolderMetadata, type Issue, type MediaFile, type MediaTarget, type NormalizedDocument, type ParsedPackage } from "./model";
import { looksSequenced, orderItems, stripNumericPrefix } from "./order";
import { sha256Hex } from "./parse";
import { basename, dirname, resolveRelative, stem } from "./paths";
import {
  CLEARABLE_FIELDS,
  UPDATE_FIELDS,
  type CollectionPlan,
  type ConflictAction,
  type ConflictReason,
  type DecisionRequired,
  type DestinationSnapshot,
  type DocumentDecision,
  type DocumentPlan,
  type ExistingRef,
  type FolderRole,
  type ImportDecisions,
  type ImportPlan,
  type MediaPlan,
  type PlannedProperty,
  type PlannedRef,
  type RefResolution,
  type RelationPlan,
  type SnapshotType,
  type TagPlan,
  type TopicPlan,
  type UpdateField,
} from "./plan-types";

export type PlanOptions = {
  maxUploadBytes: number;
  /** Signature check for staged media heads (server: media/validation sniffType). */
  sniffMedia: (head: Uint8Array) => { kind: "image" | "file" | "audio" } | null;
  /** Where uploads will go, shown in the preview when media is uploaded (and when that is blocked). */
  mediaStorageNote?: { text: string; blocked: boolean } | null;
};

const MAX_TOPIC_DEPTH = 3;
const NOTION_ID = / [0-9a-f]{32}$/;

const byKey = <T extends { key: string }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

function humanize(name: string): string {
  const words = stripNumericPrefix(name.replace(NOTION_ID, "")).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || name;
  return words === words.toLowerCase() ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

function base64ToBytes(b64: string): Uint8Array {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}

export async function planImport(pkg: ParsedPackage, snapshot: DestinationSnapshot, decisions: ImportDecisions, options: PlanOptions): Promise<ImportPlan> {
  const planner = new Planner(pkg, snapshot, decisions, options);
  return planner.run();
}

class Planner {
  private readonly issues: Issue[] = [];
  private readonly decisionsRequired: DecisionRequired[] = [];
  private readonly typeById: Map<string, SnapshotType>;
  private readonly docById: Map<string, DestinationSnapshot["documents"][number]>;
  private readonly identity: Map<string, string>;
  private readonly docs: NormalizedDocument[];
  private readonly docByKey = new Map<string, NormalizedDocument>();
  private readonly plans = new Map<string, DocumentPlan>();
  private readonly topicPlans = new Map<string, TopicPlan>();
  private readonly tagPlans = new Map<string, TagPlan>();
  private readonly mediaPlans = new Map<string, MediaPlan>();
  private readonly collections: CollectionPlan[] = [];
  private readonly folderRoles = new Map<string, { role: FolderRole; roleFrom: "decision" | "readme" | "inferred" }>();
  private readonly syntheticBodies = new Map<string, NormalizedDocument | null>();
  private readonly mediaByPath: Map<string, MediaFile>;
  /** Slugs used by documents of root-routed types (/about, /colophon). */
  private readonly rootPageSlugs: Map<string, string>;

  constructor(
    private readonly pkg: ParsedPackage,
    private readonly snapshot: DestinationSnapshot,
    private readonly decisions: ImportDecisions,
    private readonly options: PlanOptions,
  ) {
    this.typeById = new Map(snapshot.types.map((t) => [t.id, t]));
    this.docById = new Map(snapshot.documents.map((d) => [d.id, d]));
    this.identity = new Map(snapshot.identities.map((i) => [`${i.entity}:${i.portableId}`, i.entityId]));
    this.docs = [...pkg.documents].sort(byKey);
    for (const doc of this.docs) this.docByKey.set(doc.key, doc);
    this.mediaByPath = new Map(pkg.media.map((m) => [m.path, m]));
    const rootTypes = new Set(snapshot.types.filter((t) => t.routing === "root").map((t) => t.id));
    this.rootPageSlugs = new Map(snapshot.documents.filter((d) => rootTypes.has(d.typeId)).map((d) => [d.slug, d.id]));
  }

  async run(): Promise<ImportPlan> {
    this.issues.push(...this.pkg.issues);
    this.planFolders();
    for (const doc of this.docs) this.plans.set(doc.key, this.initialPlan(doc));
    this.planCollections();
    this.planTopics();
    this.planTags();
    this.planIdentityAndSlugs();
    this.planReferences();
    this.planProperties();
    this.planMedia();
    const relations = this.planRelations();
    this.planStatus();
    this.planIndexing();
    this.finishDecisions();
    this.countUsage();
    const note = this.options.mediaStorageNote;
    if (note && [...this.mediaPlans.values()].some((m) => m.action === "upload")) {
      this.issues.push(issue(note.blocked ? "error" : "warning", "media.unsupported", note.text));
    }

    const documents = [...this.plans.values()].sort(byKey);
    const topics = [...this.topicPlans.values()].sort(byKey);
    const tags = [...this.tagPlans.values()].sort(byKey);
    const media = [...this.mediaPlans.values()].sort(byKey);
    const collections = [...this.collections].sort(byKey);
    const folders = [...this.folderRoles.entries()]
      .map(([path, r]) => ({
        path,
        role: r.role,
        roleFrom: r.roleFrom,
        documentCount: this.docs.filter((d) => dirname(d.sourcePath) === path).length,
        topicKey: r.role === "topic" && this.topicPlans.has(`folder:${path}`) ? `folder:${path}` : null,
        collectionKey: r.role === "collection" ? `collection:${path}` : null,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));

    const allIssues = [...this.issues, ...documents.flatMap((d) => d.issues)];
    const summary = {
      documents: documents.length,
      create: documents.filter((d) => d.action === "create").length,
      update: documents.filter((d) => d.action === "update").length,
      skip: documents.filter((d) => d.action === "skip").length,
      copy: documents.filter((d) => d.action === "copy").length,
      excluded: documents.filter((d) => d.action === "excluded").length,
      blocked: documents.filter((d) => d.action === "blocked").length,
      topicsReuse: topics.filter((t) => t.action === "reuse").length,
      topicsCreate: topics.filter((t) => t.action === "create").length,
      tagsReuse: tags.filter((t) => t.action === "reuse").length,
      tagsCreate: tags.filter((t) => t.action === "create").length,
      collectionsCreate: collections.filter((c) => c.action === "create").length,
      collectionsModify: collections.filter((c) => c.action === "merge").length,
      relations: relations.filter((r) => r.origin === "manual").length,
      inferredRelations: relations.filter((r) => r.origin === "content").length,
      unresolvedRefs: documents.reduce((n, d) => n + d.refs.filter((r) => r.resolution.status === "unresolved" || r.resolution.status === "ambiguous").length, 0),
      slugCollisions: allIssues.filter((i) => i.code === "slug.collision").length,
      mediaUpload: media.filter((m) => m.action === "upload").length,
      mediaReuse: media.filter((m) => m.action === "reuse").length,
      mediaMissing: media.filter((m) => m.action !== "upload" && m.action !== "reuse").length,
      mediaBytes: media.filter((m) => m.action === "upload").reduce((n, m) => n + m.size, 0),
      unsupported: allIssues.filter((i) => i.code.endsWith("unsupported")).length,
      warnings: allIssues.filter((i) => i.level === "warning").length,
      errors: allIssues.filter((i) => i.level === "error").length,
    };

    const plan: Omit<ImportPlan, "hash"> = {
      version: 1,
      source: {
        system: this.pkg.sourceSystem,
        assumptions: this.pkg.assumptions,
        rootFolder: this.pkg.rootFolder,
        schemaVersion: this.pkg.schemaVersion,
        fileCount: this.pkg.documents.length + this.pkg.readmes.length + this.pkg.media.length,
      },
      summary,
      documents,
      topics,
      tags,
      collections,
      relations,
      media,
      folders,
      issues: this.issues,
      decisionsRequired: this.decisionsRequired.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    };
    const hash = await sha256Hex(JSON.stringify({ plan, fingerprint: this.snapshot.fingerprint }));
    return { ...plan, hash };
  }

  /**
   * Identity for files without an explicit id: their path inside the
   * package, including the wrapper folder, so importing the same folder
   * again finds what it created last time.
   */
  private pathPid(path: string): string {
    const root = this.pkg.rootFolder;
    return `path:${root ? `${root}/` : ""}${path}`;
  }

  // -------------------------------------------------------------------------
  // Folders
  // -------------------------------------------------------------------------

  private folderMeta(path: string): FolderMetadata | undefined {
    return this.pkg.folders.find((f) => f.path === path);
  }

  private planFolders(): void {
    const system = this.pkg.sourceSystem;
    if (system === "studio-portable" || system === "studio-bundle") return;
    const pageFolders = new Set(this.docs.map((d) => `${dirname(d.sourcePath)}/${stem(d.sourcePath)}`.replace(/^\//, "")));
    const collectionFolders = new Set<string>();
    for (const folder of [...this.pkg.folders].sort((a, b) => a.path.split("/").length - b.path.split("/").length || (a.path < b.path ? -1 : 1))) {
      if (!folder.path) continue;
      const decision = this.decisions.folders?.[folder.path];
      const insideCollection = [...collectionFolders].some((c) => folder.path.startsWith(c + "/"));
      const direct = this.docs.filter((d) => dirname(d.sourcePath) === folder.path).map((d) => basename(d.sourcePath));
      const readmeType = folder.type ? this.findType(folder.type) : null;
      let role: FolderRole;
      let roleFrom: "decision" | "readme" | "inferred" = "inferred";
      if (decision?.role) {
        role = decision.role;
        roleFrom = "decision";
      } else if (insideCollection) {
        role = "none"; // module/group folder inside a collection
      } else if (folder.collection === true || readmeType?.template === "collection") {
        role = "collection";
        roleFrom = "readme";
      } else if (folder.collection === false) {
        role = "topic";
        roleFrom = "readme";
      } else if (system === "notion" && pageFolders.has(folder.path)) {
        role = "none";
      } else if (system === "notion" || system === "obsidian") {
        // Vault and workspace folders are organisation, not taxonomy, unless chosen.
        role = looksSequenced(direct) ? "collection" : "none";
      } else if (looksSequenced(direct) || this.sequencedGroups(folder.path)) {
        role = "collection";
      } else {
        role = folder.path.split("/").length <= MAX_TOPIC_DEPTH ? "topic" : "tag";
      }
      if (role === "collection" && !this.collectionTypes().length) {
        role = "topic";
        this.issues.push(issue("warning", "type.unsupported", `"${folder.path}" looks like an ordered collection, but this site has no collection-type format. It was mapped to a topic instead.`, { path: folder.path }));
      }
      if (role === "collection") collectionFolders.add(folder.path);
      this.folderRoles.set(folder.path, { role, roleFrom });
    }
    if (system === "notion" || system === "obsidian") {
      this.pkg.assumptions.push("Folders are not mapped to topics by default for this source; choose a role per folder if you want them to be.");
    }
  }

  /** A folder of numbered sub-folders that hold documents (course → modules → lessons). */
  private sequencedGroups(path: string): boolean {
    const subfolders = this.pkg.folders.filter((f) => dirname(f.path) === path && f.path !== path).map((f) => basename(f.path));
    return looksSequenced(subfolders) && subfolders.every((sf) => this.docs.some((d) => dirname(d.sourcePath) === `${path}/${sf}`));
  }

  private collectionTypes(): SnapshotType[] {
    return this.snapshot.types.filter((t) => t.template === "collection");
  }

  private roleOf(path: string): FolderRole {
    return this.folderRoles.get(path)?.role ?? "none";
  }

  /** Nearest ancestor folder (inclusive) with the collection role. */
  private collectionFolderOf(path: string): string | null {
    let dir = path;
    let found: string | null = null;
    while (dir) {
      if (this.roleOf(dir) === "collection") found = dir;
      dir = dirname(dir);
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // Types
  // -------------------------------------------------------------------------

  private findType(value: string): SnapshotType | null {
    const v = norm(value);
    const alias = this.decisions.typeAliases?.[v];
    const candidates = alias ? [alias] : [v];
    for (const c of candidates) {
      const found = this.snapshot.types.find((t) => t.slug === c || norm(t.name) === c || norm(t.pluralName) === c || t.slug === slugify(c));
      if (found) return found;
    }
    return null;
  }

  private defaultType(): SnapshotType | null {
    if (this.decisions.defaultType) {
      const chosen = this.findType(this.decisions.defaultType);
      if (chosen) return chosen;
    }
    return (
      this.snapshot.types.find((t) => t.slug === "article") ??
      this.snapshot.types.find((t) => t.template !== "collection" && t.routing === "type") ??
      this.snapshot.types[0] ??
      null
    );
  }

  private resolveType(doc: NormalizedDocument, decision: DocumentDecision | undefined): { type: SnapshotType | null; from: DocumentPlan["typeFrom"] } {
    if (decision?.type) {
      const t = this.findType(decision.type);
      if (t) return { type: t, from: "decision" };
    }
    if (doc.type) {
      const t = this.findType(doc.type.value);
      if (t) return { type: t, from: this.decisions.typeAliases?.[norm(doc.type.value)] ? "alias" : doc.type.from };
      this.decisionsRequired.push({ kind: "type", key: doc.key, message: `"${doc.type.value}" is not a format on this site. Map it to an existing format.` });
      (this.plans.get(doc.key)?.issues ?? []).push(issue("warning", "type.unknown", `The source format "${doc.type.value}" doesn't exist here; the default format is used until you choose one.`, { path: doc.sourcePath, detail: doc.type.value }));
    }
    let dir = dirname(doc.sourcePath);
    while (true) {
      const folderType = this.decisions.folders?.[dir]?.type;
      if (folderType) {
        const t = this.findType(folderType);
        if (t) return { type: t, from: "decision" };
      }
      const readmeType = this.folderMeta(dir)?.type;
      if (readmeType) {
        const t = this.findType(readmeType);
        if (t && t.template !== "collection") return { type: t, from: "readme" };
      }
      if (!dir) break;
      dir = dirname(dir);
    }
    return { type: this.defaultType(), from: "default" };
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  private initialPlan(doc: NormalizedDocument): DocumentPlan {
    const decision = this.decisions.documents?.[doc.key];
    const plan: DocumentPlan = {
      key: doc.key,
      sourcePath: doc.sourcePath,
      sourceFormat: doc.sourceFormat,
      synthetic: false,
      pid: doc.pid ?? this.pathPid(doc.sourcePath),
      title: decision?.title?.trim() || doc.title.value,
      titleFrom: decision?.title?.trim() ? "decision" : doc.title.from,
      slug: "",
      slugFrom: "generated",
      typeSlug: null,
      typeFrom: "default",
      action: "create",
      conflict: null,
      updateFields: [],
      clearFields: [],
      status: "draft",
      visibility: "private",
      statusFrom: "default",
      topicKeys: [],
      tagKeys: [],
      collectionKey: null,
      excerpt: doc.excerpt ? doc.excerpt.slice(0, 600) : null,
      seoTitle: doc.seoTitle ? doc.seoTitle.slice(0, 120) : null,
      seoDescription: doc.seoDescription ? doc.seoDescription.slice(0, 320) : null,
      canonicalUrl: null,
      // A file can keep a document out of search engines, never put one in (planIndexing reports an ignored "index").
      robotsIndex: doc.robotsIndex === "noindex" ? "noindex" : null,
      robotsFrom: doc.robotsIndex === "noindex" ? "source" : "default",
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      publishedAt: doc.publishedAt,
      coverMediaKey: null,
      properties: {},
      unmapped: { ...doc.unmapped },
      legacyUrls: [],
      notes: doc.notes,
      featured: doc.featured,
      priority: doc.priority,
      refs: [],
      mediaRefs: [],
      wordCount: deriveContent(doc.body).wordCount,
      blockCount: doc.body.content.length,
      issues: [...doc.issues],
    };
    this.plans.set(doc.key, plan);
    if (doc.excerpt && doc.excerpt.length > 600) plan.issues.push(issue("info", "body.transformed", "The excerpt was shortened to 600 characters.", { path: doc.sourcePath }));
    if (doc.seoDescription && doc.seoDescription.length > 320) plan.issues.push(issue("info", "body.transformed", "The SEO description was shortened to 320 characters.", { path: doc.sourcePath }));
    if (doc.canonicalUrl) {
      const url = safeExternalUrl(doc.canonicalUrl);
      if (url) plan.canonicalUrl = url;
      else {
        plan.unmapped.canonicalUrl = doc.canonicalUrl;
        plan.issues.push(issue("warning", "frontmatter.invalid_value", "The canonical URL isn't an absolute http(s) URL, so it was not used.", { path: doc.sourcePath, detail: doc.canonicalUrl }));
      }
    }
    if (doc.author) plan.issues.push(issue("info", "author.unmapped", `Author "${doc.author}" is kept as source metadata; documents here are attributed to you.`, { path: doc.sourcePath }));
    for (const url of doc.legacyUrls) {
      const path = url.startsWith("/") ? safeHref(url.split(/[?#]/)[0]) : null;
      if (path && path.startsWith("/")) plan.legacyUrls.push(path);
      else plan.unmapped.legacyUrls = [...((plan.unmapped.legacyUrls as string[]) ?? []), url];
    }
    if (doc.issues.some((i) => i.level === "error")) plan.action = "blocked";
    if (decision?.include === false) plan.action = "excluded";
    const resolved = this.resolveType(doc, decision);
    plan.typeSlug = resolved.type?.slug ?? null;
    plan.typeFrom = resolved.from;
    if (!resolved.type) {
      plan.action = "blocked";
      plan.issues.push(issue("error", "type.unsupported", "No content format is available for this document.", { path: doc.sourcePath }));
    }
    return plan;
  }

  // -------------------------------------------------------------------------
  // Collections (folder-based and manifest-defined)
  // -------------------------------------------------------------------------

  private planCollections(): void {
    for (const [folder, { role }] of [...this.folderRoles.entries()].sort()) {
      if (role !== "collection") continue;
      const meta = this.folderMeta(folder);
      const decision = this.decisions.folders?.[folder];
      const readme = this.pkg.readmes.find((r) => dirname(r.sourcePath) === folder) ?? null;
      const key = `collection:${folder}`;
      const type = (decision?.collectionType && this.findType(decision.collectionType)) || (meta?.type && this.findType(meta.type)?.template === "collection" ? this.findType(meta.type) : null) || this.collectionTypes().find((t) => t.slug === "course") || this.collectionTypes()[0]!;
      const title = decision?.collectionTitle?.trim() || meta?.title || humanize(basename(folder));
      const synthetic: DocumentPlan = {
        ...this.emptySynthetic(key, folder, readme),
        title,
        titleFrom: decision?.collectionTitle ? "decision" : meta?.title ? "readme" : "folder",
        typeSlug: type.slug,
        typeFrom: decision?.collectionType ? "decision" : meta?.type ? "readme" : "folder",
        excerpt: meta?.description ? meta.description.slice(0, 600) : null,
        seoTitle: meta?.seoTitle ?? null,
        seoDescription: meta?.seoDescription ?? null,
        pid: readme?.pid ?? this.pathPid(`${folder}/`),
      };
      if (meta?.slug) synthetic.unmapped.readmeSlug = meta.slug;
      this.plans.set(key, synthetic);
      this.syntheticBodies.set(key, readme);
      if (readme) synthetic.issues.push(issue("info", "readme.metadata", "The folder's README supplies this collection's title, description and introduction.", { path: readme.sourcePath }));

      // Members: documents in the folder, plus documents in group sub-folders (modules).
      const direct = this.docs.filter((d) => dirname(d.sourcePath) === folder);
      const groups = this.pkg.folders.filter((f) => dirname(f.path) === folder && this.roleOf(f.path) === "none");
      const orderedGroups = orderItems(groups.map((g) => ({ path: g.path, explicit: null })), meta?.order ?? []).items;
      const memberOrder = (docs: NormalizedDocument[], folderOrder: string[]) =>
        orderItems(docs.map((d) => ({ path: d.sourcePath, explicit: this.decisions.documents?.[d.key]?.order ?? d.order, key: d.key })), folderOrder);
      const first = memberOrder(direct, meta?.order ?? []);
      const items: CollectionPlan["items"] = first.items.map((m) => ({ documentKey: m.key, position: 0, groupLabel: "", note: "" }));
      for (const group of orderedGroups) {
        const groupDocs = this.docs.filter((d) => dirname(d.sourcePath) === group.path || d.sourcePath.startsWith(group.path + "/"));
        const label = this.folderMeta(group.path)?.title || humanize(basename(group.path));
        items.push(...memberOrder(groupDocs, this.folderMeta(group.path)?.order ?? []).items.map((m) => ({ documentKey: m.key, position: 0, groupLabel: label, note: "" })));
      }
      items.forEach((item, i) => (item.position = i));
      for (const item of items) this.plans.get(item.documentKey)!.collectionKey = key;
      this.collections.push({ key, action: "create", documentKey: key, existingId: null, folder, title, items, orderSource: first.source, existingMemberCount: 0 });
      this.issues.push(issue("info", "collection.detected", `"${folder}" will become the ${type.name.toLowerCase()} "${title}" with ${items.length} ordered item${items.length === 1 ? "" : "s"} (order from ${first.source === "explicit" ? "explicit metadata" : first.source === "prefix" ? "numbered file names" : "file names"}).`, { path: folder }));
    }

    for (const mc of this.pkg.manifestCollections) {
      if (!this.docByKey.has(mc.collectionKey)) {
        // The collection document itself isn't in this package: merge into an existing one if its identity is known.
        const pid = mc.collectionKey.slice(4);
        const existingId = this.existingDocIdForPid(pid);
        if (!existingId) {
          this.issues.push(issue("warning", "reference.excluded", `A collection referenced by the package (${pid}) is not included and doesn't exist here; its membership was skipped.`));
          continue;
        }
        const items = [...mc.items].filter((i) => this.docByKey.has(i.documentKey)).sort((a, b) => a.position - b.position);
        this.collections.push({ key: mc.collectionKey, action: "merge", documentKey: null, existingId, folder: null, title: this.docById.get(existingId)?.title ?? pid, items: items.map((i, position) => ({ ...i, position })), orderSource: "manifest", existingMemberCount: this.snapshot.collectionItems.filter((i) => i.collectionId === existingId).length });
        continue;
      }
      const items = [...mc.items].sort((a, b) => a.position - b.position);
      for (const item of items) {
        if (!this.docByKey.has(item.documentKey) && !this.existingDocIdForPid(item.documentKey.slice(4))) {
          this.issues.push(issue("warning", "reference.excluded", `A collection item (${item.documentKey.slice(4)}) is not in the package and doesn't exist here.`));
        }
        const plan = this.plans.get(item.documentKey);
        if (plan) plan.collectionKey = mc.collectionKey;
      }
      const collectionPlan = this.plans.get(mc.collectionKey)!;
      this.collections.push({ key: mc.collectionKey, action: "create", documentKey: mc.collectionKey, existingId: null, folder: null, title: collectionPlan.title, items: items.map((i, position) => ({ ...i, position })), orderSource: "manifest", existingMemberCount: 0 });
    }
  }

  private emptySynthetic(key: string, folder: string, readme: NormalizedDocument | null): DocumentPlan {
    return {
      key,
      sourcePath: readme?.sourcePath ?? `${folder}/`,
      sourceFormat: readme?.sourceFormat ?? "markdown",
      synthetic: true,
      pid: null,
      title: "",
      titleFrom: "folder",
      slug: "",
      slugFrom: "generated",
      typeSlug: null,
      typeFrom: "folder",
      action: "create",
      conflict: null,
      updateFields: [],
      clearFields: [],
      status: "draft",
      visibility: "private",
      statusFrom: "default",
      topicKeys: [],
      tagKeys: [],
      collectionKey: null,
      excerpt: null,
      seoTitle: null,
      seoDescription: null,
      canonicalUrl: null,
      robotsIndex: null,
      robotsFrom: "default",
      createdAt: null,
      updatedAt: null,
      publishedAt: null,
      coverMediaKey: null,
      properties: {},
      unmapped: {},
      legacyUrls: [],
      notes: null,
      featured: null,
      priority: null,
      refs: [],
      mediaRefs: [],
      wordCount: readme ? deriveContent(readme.body).wordCount : 0,
      blockCount: readme?.body.content.length ?? 0,
      issues: [],
    };
  }

  /** The source document behind a plan (README for folder collections). */
  sourceOf(key: string): NormalizedDocument | null {
    return this.docByKey.get(key) ?? this.syntheticBodies.get(key) ?? null;
  }

  // -------------------------------------------------------------------------
  // Topics
  // -------------------------------------------------------------------------

  private planTopics(): void {
    const manifestTopics = new Map(this.pkg.manifestTopics.map((t) => [t.pid, t]));
    const ensureManifestTopic = (pid: string): string | null => {
      const key = `pid:${pid}`;
      if (this.topicPlans.has(key)) return key;
      const record = manifestTopics.get(pid);
      if (!record) return null;
      const parentKey = record.parentPid ? ensureManifestTopic(record.parentPid) : null;
      this.topicPlans.set(key, this.resolveTopic(key, record.name, "manifest", { slug: record.slug, pid, parentKey }));
      return key;
    };

    for (const plan of [...this.plans.values()].sort(byKey)) {
      const doc = this.sourceOf(plan.key);
      const keys: string[] = [];
      for (const t of doc?.topics ?? []) {
        const key = t.value.startsWith("pid:") ? ensureManifestTopic(t.value.slice(4)) : this.explicitTopic(t.value);
        if (key && !keys.includes(key)) keys.push(key);
      }
      if (!keys.length && doc) {
        // No explicit topics: the nearest topic folder (with its parents) decides.
        let dir = plan.synthetic ? dirname(plan.key.slice("collection:".length)) : dirname(doc.sourcePath);
        while (dir) {
          if (this.roleOf(dir) === "topic") {
            const key = this.folderTopic(dir);
            if (key) keys.push(key);
            break;
          }
          dir = dirname(dir);
        }
      }
      plan.topicKeys = keys;
    }
    for (const topic of this.topicPlans.values()) {
      if (topic.action === "ambiguous") this.decisionsRequired.push({ kind: "topic", key: topic.key, message: topic.message ?? `Choose which topic "${topic.label}" means.` });
    }
  }

  private explicitTopic(value: string): string {
    const key = `name:${slugify(value, "") || norm(value)}`;
    if (!this.topicPlans.has(key)) this.topicPlans.set(key, this.resolveTopic(key, value, "explicit", { slug: null, pid: null, parentKey: null }));
    return key;
  }

  private folderTopic(path: string): string | null {
    const key = `folder:${path}`;
    if (this.topicPlans.has(key)) return key;
    let parentKey: string | null = null;
    let dir = dirname(path);
    while (dir) {
      if (this.roleOf(dir) === "topic") {
        parentKey = this.folderTopic(dir);
        break;
      }
      dir = dirname(dir);
    }
    const meta = this.folderMeta(path);
    const decision = this.decisions.folders?.[path];
    const label = meta?.title || humanize(basename(path));
    if (decision?.topicId) {
      const cat = this.snapshot.categories.find((c) => c.id === decision.topicId);
      if (cat) {
        this.topicPlans.set(key, { key, label, origin: "folder", action: "reuse", existingId: cat.id, candidates: [], create: null, documentCount: 0, message: null });
        return key;
      }
    }
    this.topicPlans.set(key, this.resolveTopic(key, label, "folder", { slug: slugify(basename(path).replace(NOTION_ID, ""), ""), pid: null, parentKey, folderName: basename(path) }));
    return key;
  }

  private depthOfKey(key: string | null): number {
    let depth = 0;
    let cursor = key;
    while (cursor) {
      depth++;
      const plan = this.topicPlans.get(cursor);
      if (!plan) break;
      if (plan.existingId) {
        let id: string | null = plan.existingId;
        depth--;
        while (id) {
          depth++;
          id = this.snapshot.categories.find((c) => c.id === id)?.parentId ?? null;
        }
        break;
      }
      cursor = plan.create?.parentKey ?? null;
    }
    return depth;
  }

  private resolveTopic(key: string, label: string, origin: TopicPlan["origin"], hints: { slug: string | null; pid: string | null; parentKey: string | null; folderName?: string }): TopicPlan {
    const decision = this.decisions.topics?.[key];
    const base: TopicPlan = { key, label, origin, action: "create", existingId: null, candidates: [], create: null, documentCount: 0, message: null };
    if (decision?.mode === "skip") return { ...base, action: "skip" };
    if (decision?.mode === "existing") {
      const cat = this.snapshot.categories.find((c) => c.id === decision.id);
      if (cat) return { ...base, action: "reuse", existingId: cat.id };
    }
    if (hints.pid) {
      const id = this.identity.get(`topic:${hints.pid}`);
      if (id && this.snapshot.categories.some((c) => c.id === id)) return { ...base, action: "reuse", existingId: id };
    }
    const wantedSlug = decision?.mode === "create" ? decision.slug : (hints.slug || slugify(label, ""));
    if (decision?.mode !== "create") {
      const bySlug = wantedSlug ? this.snapshot.categories.filter((c) => c.slug === wantedSlug) : [];
      const byName = this.snapshot.categories.filter((c) => norm(c.name) === norm(label) || (hints.folderName && norm(c.name) === norm(humanize(hints.folderName))));
      const candidates = [...new Map([...bySlug, ...byName].map((c) => [c.id, c])).values()];
      if (candidates.length === 1) return { ...base, action: "reuse", existingId: candidates[0]!.id };
      if (candidates.length > 1) {
        return { ...base, action: "ambiguous", candidates: candidates.map((c) => ({ id: c.id, name: c.name, slug: c.slug })), message: `"${label}" matches ${candidates.length} existing topics (${candidates.map((c) => c.name).join(", ")}). Choose one, or create a new topic.` };
      }
    }
    if (!wantedSlug || !isValidSlug(wantedSlug)) {
      return { ...base, action: "invalid", message: `"${label}" has no URL-safe form (letters a–z or digits), so it can't become a topic. Choose an existing topic or skip it.` };
    }
    const parentKey = hints.parentKey;
    const parentPlan = parentKey ? this.topicPlans.get(parentKey) : undefined;
    const create = { name: decision?.mode === "create" ? decision.name : /^[a-z0-9-]+$/.test(label) ? humanize(label) : label.slice(0, 80), slug: wantedSlug, parentKey, parentId: parentPlan?.existingId ?? null };
    // Namespace: topics share the root URL space with content types, root pages and reserved words.
    if (isReservedRootSlug(wantedSlug) || this.snapshot.rootSlugs.includes(wantedSlug) || this.rootPageSlugs.has(wantedSlug)) {
      return { ...base, action: "ambiguous", create, message: `A new topic "${label}" would use /${wantedSlug}, which is already taken by a page, format or the site itself. Choose an existing topic, rename it, or skip it.` };
    }
    if (parentKey && this.depthOfKey(parentKey) + 1 > MAX_TOPIC_DEPTH) {
      return { ...base, action: "ambiguous", create: { ...create, parentKey: null, parentId: null }, message: `"${label}" would be nested deeper than ${MAX_TOPIC_DEPTH} topic levels. It can be created as a top-level topic, mapped to an existing one, or skipped.` };
    }
    return { ...base, action: "create", create, message: null };
  }

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  private planTags(): void {
    const manifestTags = new Map(this.pkg.manifestTags.map((t) => [t.pid, t]));
    for (const plan of [...this.plans.values()].sort(byKey)) {
      const doc = this.sourceOf(plan.key);
      const labels: Array<{ label: string; pid: string | null }> = [];
      for (const t of doc?.tags ?? []) {
        if (t.value.startsWith("pid:")) {
          const record = manifestTags.get(t.value.slice(4));
          if (record) labels.push({ label: record.name, pid: record.pid });
        } else labels.push({ label: t.value, pid: null });
      }
      // Folders mapped to tags, and README tags of enclosing folders.
      let dir = plan.synthetic ? plan.key.slice("collection:".length) : dirname(plan.sourcePath);
      while (dir) {
        if (this.roleOf(dir) === "tag") labels.push({ label: humanize(basename(dir)), pid: null });
        for (const t of this.folderMeta(dir)?.tags ?? []) labels.push({ label: t, pid: null });
        dir = dirname(dir);
      }
      const keys: string[] = [];
      const unrepresentable: string[] = [];
      for (const { label, pid } of labels) {
        const identityId = pid ? this.identity.get(`tag:${pid}`) : undefined;
        const existingById = identityId ? this.snapshot.tags.find((t) => t.id === identityId) : undefined;
        const slug = existingById?.slug ?? (pid ? manifestTags.get(pid)?.slug : null) ?? slugify(label, "");
        if (!slug || !isValidSlug(slug)) {
          unrepresentable.push(label);
          continue;
        }
        const key = slug;
        if (!keys.includes(key)) keys.push(key);
        const existing = existingById ?? this.snapshot.tags.find((t) => t.slug === slug);
        const tagPlan = this.tagPlans.get(key) ?? { key, name: existing?.name ?? label.slice(0, 60), variants: [], action: existing ? "reuse" : "create", existingId: existing?.id ?? null, documentCount: 0 };
        if (!tagPlan.variants.includes(label)) tagPlan.variants.push(label);
        this.tagPlans.set(key, tagPlan);
      }
      plan.tagKeys = keys;
      if (unrepresentable.length) {
        plan.unmapped.tags = unrepresentable;
        plan.issues.push(issue("warning", "tag.unrepresentable", `Tags without a URL-safe form were kept as source metadata, not created: ${unrepresentable.join(", ")}.`, { path: plan.sourcePath }));
      }
    }
    for (const tag of this.tagPlans.values()) {
      if (tag.variants.length > 1) this.issues.push(issue("info", "tag.merged", `${tag.variants.map((v) => `"${v}"`).join(", ")} are the same tag (/tag/${tag.key}) and were merged as "${tag.name}".`));
    }
  }

  // -------------------------------------------------------------------------
  // Identity, duplicates and slugs
  // -------------------------------------------------------------------------

  private existingDocIdForPid(pid: string): string | null {
    const mapped = this.identity.get(`document:${pid}`);
    if (mapped && this.docById.has(mapped)) return mapped;
    const native = /^studio:document:([0-9a-f-]{36})$/.exec(pid);
    if (native && isUuid(native[1]) && this.docById.has(native[1]!)) return native[1]!;
    return null;
  }

  private existingRef(id: string): ExistingRef {
    const d = this.docById.get(id)!;
    return { id, title: d.title, slug: d.slug, typeSlug: this.typeById.get(d.typeId)?.slug ?? "", status: d.status, visibility: d.visibility, path: d.path };
  }

  private findDuplicates(plan: DocumentPlan, type: SnapshotType, slug: string): { reason: ConflictReason; ids: string[] } | null {
    if (plan.pid) {
      const id = this.existingDocIdForPid(plan.pid);
      if (id) return { reason: "identity", ids: [id] };
    }
    if (plan.canonicalUrl) {
      const ids = this.snapshot.documents.filter((d) => d.canonicalUrl && d.canonicalUrl === plan.canonicalUrl).map((d) => d.id);
      if (ids.length) return { reason: "canonical", ids };
    }
    const sameSlug = this.snapshot.documents.filter((d) => d.typeId === type.id && d.slug === slug).map((d) => d.id);
    if (sameSlug.length) return { reason: "slug", ids: sameSlug };
    const legacy = this.snapshot.documents.filter((d) => plan.legacyUrls.includes(d.path)).map((d) => d.id);
    if (legacy.length) return { reason: "legacy", ids: legacy };
    return null;
  }

  private takenSlugs = new Set<string>();
  private takenRoot = new Set<string>();

  private slugTaken(type: SnapshotType, slug: string, exceptId: string | null): boolean {
    if (this.takenSlugs.has(`${type.id}/${slug}`)) return true;
    if (this.snapshot.documents.some((d) => d.typeId === type.id && d.slug === slug && d.id !== exceptId)) return true;
    if (type.routing === "root") {
      // Same rules as services/namespace.ts: system-page slugs are allowed for pages, reserved words never.
      if (this.takenRoot.has(slug) || RESERVED_ROOT_SLUGS.has(slug)) return true;
      const page = this.rootPageSlugs.get(slug);
      if (page && page !== exceptId) return true;
      if (this.snapshot.rootSlugs.includes(slug) || this.snapshot.categories.some((c) => c.slug === slug)) return true;
      if ([...this.topicPlans.values()].some((t) => t.action === "create" && t.create?.slug === slug)) return true;
    }
    return false;
  }

  private claim(type: SnapshotType, slug: string): void {
    this.takenSlugs.add(`${type.id}/${slug}`);
    if (type.routing === "root") this.takenRoot.add(slug);
  }

  private uniqueSlug(type: SnapshotType, base: string, exceptId: string | null): string {
    const root = (isValidSlug(base) ? base : slugify(base)).slice(0, MAX_SLUG_LENGTH);
    for (let n = 1; n < 500; n++) {
      const candidate = n === 1 ? root : `${root.slice(0, 90)}-${n}`;
      if (!this.slugTaken(type, candidate, exceptId)) return candidate;
    }
    return `${root.slice(0, 80)}-import`;
  }

  private planIdentityAndSlugs(): void {
    // Folder collections are planned before their members so a course claims its slug first.
    const order = [...this.plans.values()].sort((a, b) => Number(b.synthetic) - Number(a.synthetic) || byKey(a, b));
    for (const plan of order) {
      const type = this.snapshot.types.find((t) => t.slug === plan.typeSlug);
      if (!type) continue;
      const doc = this.sourceOf(plan.key);
      const decision = this.decisions.documents?.[plan.key];

      // Candidate slug before uniqueness.
      let candidate: string;
      let from: DocumentPlan["slugFrom"];
      const explicit = plan.synthetic ? ((plan.unmapped.readmeSlug as string | undefined) ?? null) : (doc?.slug?.value ?? null);
      delete plan.unmapped.readmeSlug;
      if (decision?.slug) {
        candidate = decision.slug.trim();
        from = "decision";
        if (!isValidSlug(candidate)) {
          plan.issues.push(issue("error", "slug.changed", `"${candidate}" is not a valid URL slug (lowercase letters, numbers, single hyphens).`, { path: plan.sourcePath }));
          plan.action = "blocked";
          candidate = slugify(candidate);
        }
      } else if (explicit) {
        candidate = isValidSlug(explicit) ? explicit : slugify(explicit, "");
        from = plan.synthetic ? "readme" : (doc?.slug?.from ?? "frontmatter");
        if (candidate !== explicit) plan.issues.push(issue("info", "slug.changed", `The slug "${explicit}" was normalised to "${candidate}".`, { path: plan.sourcePath }));
      } else {
        candidate = slugify(plan.title, "");
        from = "generated";
        if (!candidate) candidate = slugify(plan.synthetic ? basename(plan.key) : stem(plan.sourcePath).replace(NOTION_ID, ""), "");
        if (!candidate) {
          candidate = `imported-${Math.abs(hashCode(plan.key)).toString(36)}`;
          plan.issues.push(issue("info", "slug.generated", "The title has no URL-safe letters, so a neutral slug was generated. You can change it later.", { path: plan.sourcePath }));
        }
      }
      if (!candidate) candidate = "untitled";

      if (plan.action === "blocked" || plan.action === "excluded") {
        plan.slug = candidate;
        plan.slugFrom = from;
        continue;
      }

      // Duplicates.
      const duplicate = this.findDuplicates(plan, type, candidate);
      if (duplicate) {
        const ids = decision?.matchId && duplicate.ids.includes(decision.matchId) ? [decision.matchId] : duplicate.ids;
        const candidates = duplicate.ids.map((id) => this.existingRef(id));
        plan.conflict = { reason: duplicate.reason, existing: this.existingRef(ids[0]!), candidates };
        const chosen: ConflictAction | undefined = decision?.action ?? this.decisions.duplicateAction;
        if (ids.length > 1 && !decision?.matchId) {
          plan.action = "skip";
          this.decisionsRequired.push({ kind: "duplicate", key: plan.key, message: `"${plan.title}" matches ${ids.length} existing documents. Choose which one it is, then skip, update or copy.` });
        } else if (!chosen) {
          plan.action = "skip";
          this.decisionsRequired.push({ kind: "duplicate", key: plan.key, message: `"${plan.title}" already exists as "${plan.conflict.existing.title}" (${plan.conflict.existing.path}). Choose skip, update or copy.` });
        } else plan.action = chosen;
        plan.issues.push(issue("warning", "duplicate.detected", `Matches the existing document "${plan.conflict.existing.title}" (${duplicate.reason === "identity" ? "same identity as a previous import or export" : duplicate.reason === "slug" ? "same format and slug" : duplicate.reason === "canonical" ? "same canonical URL" : "an old URL of this document"}).`, { path: plan.sourcePath }));
      }

      const existing = plan.conflict?.existing ?? null;
      if (plan.action === "update" && existing) {
        const fields = (decision?.updateFields ?? []).filter((f): f is UpdateField => (UPDATE_FIELDS as readonly string[]).includes(f));
        plan.updateFields = fields;
        plan.clearFields = (decision?.clearFields ?? []).filter((f) => (CLEARABLE_FIELDS as readonly string[]).includes(f));
        if (!fields.length && !plan.clearFields.length) plan.issues.push(issue("info", "duplicate.detected", "Update is selected but no fields are; nothing will change. Pick the incoming fields to apply.", { path: plan.sourcePath }));
        const existingType = this.snapshot.types.find((t) => t.slug === existing.typeSlug);
        if (existingType && existingType.id !== type.id) {
          plan.typeSlug = existingType.slug;
          plan.issues.push(issue("info", "type.defaulted", `Updates keep the existing document's format (${existingType.name}).`, { path: plan.sourcePath }));
        }
        if (fields.includes("slug") && candidate !== existing.slug) {
          plan.slug = this.uniqueSlug(existingType ?? type, candidate, existing.id);
          plan.slugFrom = from;
          plan.issues.push(issue("warning", "slug.changed", `The URL changes from ${existing.path}; a redirect keeps the old URL working if it was ever public.`, { path: plan.sourcePath }));
        } else {
          plan.slug = existing.slug;
          plan.slugFrom = "existing";
        }
        this.claim(existingType ?? type, plan.slug);
        continue;
      }
      if (plan.action === "skip" && existing) {
        plan.slug = existing.slug;
        plan.slugFrom = "existing";
        continue;
      }
      const baseSlug = plan.action === "copy" ? `${candidate}-copy` : candidate;
      const slug = this.uniqueSlug(type, baseSlug, null);
      if (slug !== baseSlug && plan.action !== "copy") {
        plan.issues.push(issue("warning", "slug.collision", `The slug "${baseSlug}" is already used${this.takenSlugs.has(`${type.id}/${baseSlug}`) ? " by another document in this import" : ""}; "${slug}" will be used instead.`, { path: plan.sourcePath, detail: baseSlug }));
      }
      plan.slug = slug;
      plan.slugFrom = from;
      this.claim(type, slug);
    }

    // A folder collection that matches an existing collection merges into it.
    for (const collection of this.collections) {
      const plan = collection.documentKey ? this.plans.get(collection.documentKey) : undefined;
      if (!plan) continue;
      if (plan.action === "blocked" || plan.action === "excluded") {
        collection.action = "skip";
        continue;
      }
      if (!plan.conflict || plan.action === "copy") continue;
      const existingType = this.snapshot.types.find((t) => t.slug === plan.conflict!.existing.typeSlug);
      if (existingType?.template !== "collection") {
        // A matching document that isn't a collection can't receive members.
        if (plan.action === "update") {
          collection.action = "skip";
          plan.issues.push(issue("warning", "collection.existing", `The matching document "${plan.conflict.existing.title}" isn't a collection, so the folder's items can't be added to it. Choose "copy" to create a new collection.`, { path: plan.sourcePath }));
        } else collection.action = "skip";
        continue;
      }
      collection.existingId = plan.conflict.existing.id;
      collection.existingMemberCount = this.snapshot.collectionItems.filter((i) => i.collectionId === plan.conflict!.existing.id).length;
      collection.action = plan.action === "update" ? "merge" : "skip";
      this.issues.push(
        issue(
          "info",
          "collection.existing",
          collection.action === "merge"
            ? `"${collection.title}" already exists with ${collection.existingMemberCount} item${collection.existingMemberCount === 1 ? "" : "s"}. New items are added after them; nothing is removed or reordered.`
            : `"${collection.title}" already exists and is skipped: its items and order stay as they are. Choose "update" to add the new items.`,
          { path: collection.folder ?? undefined },
        ),
      );
    }
  }

  // -------------------------------------------------------------------------
  // References (body links, mentions, related front matter)
  // -------------------------------------------------------------------------

  private wikiIndex: Map<string, string[]> | null = null;

  private buildWikiIndex(): Map<string, string[]> {
    const index = new Map<string, string[]>();
    const add = (name: string, key: string) => {
      const k = norm(name);
      if (!k) return;
      const list = index.get(k) ?? [];
      if (!list.includes(key)) list.push(key);
      index.set(k, list);
    };
    for (const doc of this.docs) {
      add(stem(doc.sourcePath).replace(NOTION_ID, ""), doc.key);
      add(doc.title.value, doc.key);
      for (const alias of doc.aliases) add(alias, doc.key);
    }
    return index;
  }

  private plannedPath(key: string): string | null {
    const plan = this.plans.get(key);
    if (!plan) return null;
    const type = this.snapshot.types.find((t) => t.slug === plan.typeSlug);
    return type ? documentPath(type, plan.slug) : null;
  }

  /** Where references to an incoming document actually land, given its planned action. */
  private landing(key: string): RefResolution {
    const plan = this.plans.get(key);
    if (!plan) return { status: "unresolved", reason: "Not in this import." };
    if (plan.action === "blocked" || plan.action === "excluded") return { status: "unresolved", reason: `"${plan.title}" is not being imported.` };
    if (plan.action === "skip" || plan.action === "update") {
      const existing = plan.conflict?.existing;
      if (existing) return { status: "existing", id: existing.id, path: plan.action === "update" ? (this.plannedPath(key) ?? existing.path) : existing.path };
    }
    return { status: "incoming", key };
  }

  resolveTarget(target: DocTarget, fromKey: string): RefResolution {
    switch (target.kind) {
      case "path": {
        const candidates = [target.path, `${target.path}.md`, `${target.path}.mdx`, `${target.path}.html`, `${target.path}/README.md`, `${target.path}/index.md`];
        for (const path of candidates) {
          const doc = this.docs.find((d) => d.sourcePath === path);
          if (doc) return this.landing(doc.key);
          const collection = this.collections.find((c) => c.folder && (`${c.folder}/README.md` === path || `${c.folder}/readme.md` === path));
          if (collection?.documentKey) return this.landing(collection.documentKey);
        }
        // Notion re-encodes names inconsistently; fall back to the page id in the file name.
        const notionId = / ([0-9a-f]{32})(?:\.\w+)?$/.exec(target.path)?.[1];
        if (notionId) {
          const doc = this.docs.find((d) => d.pid === `notion:${notionId}`);
          if (doc) return this.landing(doc.key);
        }
        return { status: "unresolved", reason: `No file "${target.path}" in the import.` };
      }
      case "wiki": {
        this.wikiIndex ??= this.buildWikiIndex();
        const name = target.name.replace(/\.(md|mdx)$/i, "");
        if (name.includes("/")) {
          const doc = this.docs.find((d) => d.sourcePath.replace(/\.(md|mdx)$/i, "").toLowerCase().endsWith(name.toLowerCase()));
          if (doc) return this.landing(doc.key);
        }
        const keys = this.wikiIndex.get(norm(basename(name))) ?? [];
        if (keys.length === 1) return this.landing(keys[0]!);
        if (keys.length > 1) {
          const fromDir = dirname(this.plans.get(fromKey)?.sourcePath ?? "");
          const same = keys.filter((k) => dirname(this.docByKey.get(k)?.sourcePath ?? "") === fromDir);
          if (same.length === 1) return this.landing(same[0]!);
          return { status: "ambiguous", candidates: keys };
        }
        return { status: "unresolved", reason: `No note named "${target.name}" in the import.` };
      }
      case "pid": {
        const doc = this.docs.find((d) => d.pid === target.pid);
        if (doc) return this.landing(doc.key);
        const id = this.existingDocIdForPid(target.pid);
        if (id) return { status: "existing", id, path: this.docById.get(id)!.path };
        return { status: "unresolved", reason: `The referenced document (${target.pid}) is not in this import and not on this site.` };
      }
      case "site": {
        const path = target.path.replace(/\/+$/, "") || "/";
        for (const plan of this.plans.values()) {
          if (this.plannedPath(plan.key) === path) return this.landing(plan.key);
        }
        const existing = this.snapshot.documents.find((d) => d.path === path);
        if (existing) return { status: "existing", id: existing.id, path: existing.path };
        return { status: "kept", path };
      }
      case "slug": {
        const slug = target.slug;
        // Exact slug or file name only: titles are never identity evidence.
        const incoming = [...this.plans.values()].filter((p) => !p.synthetic && (p.slug === slug || stem(p.sourcePath) === slug));
        if (incoming.length === 1) return this.landing(incoming[0]!.key);
        const existing = this.snapshot.documents.filter((d) => d.slug === slug);
        if (!incoming.length && existing.length === 1) return { status: "existing", id: existing[0]!.id, path: existing[0]!.path };
        if (incoming.length + existing.length > 1) return { status: "ambiguous", candidates: [...incoming.map((p) => p.key), ...existing.map((d) => d.id)] };
        return { status: "unresolved", reason: `No document with the slug "${slug}".` };
      }
    }
  }

  private planReferences(): void {
    for (const plan of this.plans.values()) {
      const doc = this.sourceOf(plan.key);
      if (!doc) continue;
      plan.refs = doc.refs.map((target, index) => {
        const resolution = this.resolveTarget(target, plan.key);
        const evidence: PlannedRef["evidence"] = target.kind === "wiki" ? "wikilink" : target.kind === "pid" ? "mention" : "link";
        return { index, target, resolution, evidence };
      });
      for (const ref of plan.refs) {
        if (ref.resolution.status === "unresolved") {
          plan.issues.push(issue("warning", "reference.unresolved", `Link to ${describeTarget(ref.target)} doesn't resolve; the text is kept without the link. ${ref.resolution.reason}`, { path: plan.sourcePath, detail: describeTarget(ref.target) }));
        } else if (ref.resolution.status === "ambiguous") {
          plan.issues.push(issue("warning", "reference.ambiguous", `Link to ${describeTarget(ref.target)} matches ${ref.resolution.candidates.length} documents, so no link was made. Rename one, or use a path.`, { path: plan.sourcePath, detail: describeTarget(ref.target) }));
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  private planProperties(): void {
    for (const plan of this.plans.values()) {
      const doc = this.sourceOf(plan.key);
      const type = this.snapshot.types.find((t) => t.slug === plan.typeSlug);
      if (!doc || !type || plan.synthetic) continue;
      const remaining = new Map(Object.entries(doc.properties));
      const values: Record<string, unknown> = {};
      for (const field of type.fields) {
        const match = [...remaining.keys()].find((k) => k === field.key || normalizeKey(k) === normalizeKey(field.key) || normalizeKey(k) === normalizeKey(field.label));
        if (match === undefined) continue;
        const raw = remaining.get(match);
        remaining.delete(match);
        const planned = this.planPropertyValue(field, raw, plan, doc);
        if (planned) {
          if (planned.kind === "value") values[field.key] = planned.value;
          plan.properties[field.key] = planned;
        } else plan.unmapped[match] = raw;
      }
      // Validate plain values with the same rules the editor uses, and keep the normalised result.
      const { values: validated, errors } = validateProperties(type.fields.filter((f) => plan.properties[f.key]?.kind === "value"), values, "draft");
      for (const [key, value] of Object.entries(validated)) plan.properties[key] = { kind: "value", value };
      for (const [key, message] of Object.entries(errors)) {
        plan.unmapped[key] = values[key];
        delete plan.properties[key];
        plan.issues.push(issue("warning", "property.invalid", `"${key}" wasn't imported: ${message} The original value is kept as source metadata.`, { path: plan.sourcePath, detail: key }));
      }
      for (const [key, value] of remaining) plan.unmapped[key] = value;
      if (remaining.size) {
        plan.issues.push(issue("info", "property.unmapped", `Metadata with no matching ${type.name} field is preserved (shown in the import record and exports): ${[...remaining.keys()].join(", ")}.`, { path: plan.sourcePath }));
      }
    }
  }

  private planPropertyValue(field: FieldDefinition, raw: unknown, plan: DocumentPlan, doc: NormalizedDocument): PlannedProperty | null {
    if (raw === null || raw === undefined || raw === "") return null;
    switch (field.type) {
      case "text":
        return { kind: "value", value: Array.isArray(raw) ? list(raw).join(", ") : typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : raw };
      case "long_text":
        return { kind: "value", value: Array.isArray(raw) ? list(raw, 200).join("\n") : typeof raw === "string" ? raw.replace(/\s+$/, "") : raw };
      case "select": {
        const v = String(raw).trim();
        const choice = (field.options.choices ?? []).find((c) => c.value === v || norm(c.value) === norm(v) || norm(c.label) === norm(v));
        return { kind: "value", value: choice?.value ?? v };
      }
      case "multi_select": {
        const values = list(raw, 40).map((v) => (field.options.choices ?? []).find((c) => norm(c.value) === norm(v) || norm(c.label) === norm(v))?.value ?? v);
        return { kind: "value", value: values };
      }
      case "number":
      case "boolean":
      case "url":
      case "email":
      case "datetime":
      case "interview_guide":
        return { kind: "value", value: raw };
      case "date": {
        const iso = parseDate(raw);
        return { kind: "value", value: iso ? iso.slice(0, 10) : raw };
      }
      case "image":
      case "file": {
        const value = String(raw);
        const target: MediaTarget | null = value.startsWith("asset:")
          ? { kind: "asset", pid: value.slice(6) }
          : isUuid(value)
            ? { kind: "site", src: "", mediaId: value }
            : (() => {
                const resolved = /^https?:/.test(value) ? null : resolveRelative(doc.sourcePath, value);
                return resolved ? { kind: "path" as const, path: resolved.path } : /^https?:/.test(value) ? { kind: "external" as const, url: value } : null;
              })();
        if (!target) return null;
        const key = this.mediaKeyFor(target, plan.key, "");
        return key ? { kind: "media", mediaKey: key } : null;
      }
      case "relation": {
        const values = list(raw, 30);
        const refs = values.map((v) => {
          const uuid: boolean = isUuid(v);
          const target: DocTarget = v.startsWith("pid:") ? { kind: "pid", pid: v.slice(4) } : uuid ? { kind: "pid", pid: `studio:document:${v}` } : v.startsWith("/") ? { kind: "site", path: v } : { kind: "slug", slug: v };
          return this.resolveTarget(target, plan.key);
        });
        for (const [i, r] of refs.entries()) {
          if (r.status === "unresolved" || r.status === "ambiguous") plan.issues.push(issue("warning", "reference.unresolved", `"${field.label}" refers to "${values[i]}", which doesn't resolve.`, { path: plan.sourcePath, detail: field.key }));
        }
        return { kind: "documents", refs, multiple: field.options.multiple === true };
      }
      default:
        return null;
    }
  }

  // -------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------

  private findMediaFile(target: MediaTarget, fromPath: string): { path: string } | { ambiguous: string[] } | null {
    if (target.kind === "asset") {
      const asset = this.pkg.manifestAssets.find((a) => a.pid === target.pid);
      return asset && this.mediaByPath.has(asset.path) ? { path: asset.path } : null;
    }
    if (target.kind === "path") {
      if (this.mediaByPath.has(target.path)) return { path: target.path };
      // Exported tools often flatten or move attachments; fall back to a unique file name.
      const byName = this.pkg.media.filter((m) => basename(m.path).toLowerCase() === basename(target.path).toLowerCase());
      if (byName.length === 1) return { path: byName[0]!.path };
      if (byName.length > 1) return { ambiguous: byName.map((m) => m.path) };
      return null;
    }
    if (target.kind === "wiki") {
      const name = target.name.toLowerCase();
      const matches = this.pkg.media.filter((m) => m.path.toLowerCase() === name || basename(m.path).toLowerCase() === basename(name));
      if (matches.length === 1) return { path: matches[0]!.path };
      if (matches.length > 1) {
        const fromDir = dirname(fromPath);
        const near = matches.filter((m) => dirname(m.path) === fromDir);
        if (near.length === 1) return { path: near[0]!.path };
        const sorted = [...matches].sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
        return { path: sorted[0]!.path };
      }
      return null;
    }
    return null;
  }

  private mediaKeyFor(target: MediaTarget, docKey: string, alt: string): string | null {
    const plan = this.plans.get(docKey);
    const fromPath = plan?.sourcePath ?? "";
    let mediaPlan: MediaPlan;
    if (target.kind === "external") {
      const key = `external:${target.url}`;
      mediaPlan = this.mediaPlans.get(key) ?? { key, path: null, sha256: null, size: 0, action: "external", existingId: null, url: target.url, alt, usedBy: [], message: "Remote images are never downloaded during import. Add the file to the package to import it." };
    } else if (target.kind === "site") {
      const existing = target.mediaId ? this.snapshot.media.find((m) => m.id === target.mediaId) : this.snapshot.media.find((m) => m.url === target.src || m.url.endsWith(target.src));
      const key = existing ? `media:${existing.id}` : `site:${target.mediaId ?? target.src}`;
      mediaPlan = this.mediaPlans.get(key) ?? (existing ? { key, path: null, sha256: null, size: 0, action: "reuse", existingId: existing.id, url: existing.url, alt, usedBy: [], message: null } : { key, path: null, sha256: null, size: 0, action: "missing", existingId: null, url: target.src || null, alt, usedBy: [], message: "This media belongs to another site and isn't included in the package." });
    } else {
      const found = this.findMediaFile(target, fromPath);
      if (!found || "ambiguous" in found) {
        const label = target.kind === "asset" ? target.pid : target.kind === "path" ? target.path : target.name;
        const key = `missing:${label}`;
        mediaPlan = this.mediaPlans.get(key) ?? { key, path: null, sha256: null, size: 0, action: "missing", existingId: null, url: null, alt, usedBy: [], message: found ? `"${label}" matches several files (${found.ambiguous.join(", ")}).` : `"${label}" is not in the import.` };
      } else {
        const file = this.mediaByPath.get(found.path)!;
        const key = `file:${found.path}`;
        if (!this.mediaPlans.has(key)) {
          const reusedId = file.sha256 ? this.identity.get(`media:sha256:${file.sha256}`) : undefined;
          const reused = reusedId ? this.snapshot.media.find((m) => m.id === reusedId) : undefined;
          const manifestAsset = this.pkg.manifestAssets.find((a) => a.path === found.path);
          const sniffed = file.head ? this.options.sniffMedia(base64ToBytes(file.head)) : null;
          const base: MediaPlan = { key, path: found.path, sha256: file.sha256 || null, size: file.size, action: "upload", existingId: null, url: null, alt: alt || manifestAsset?.alt || "", usedBy: [], message: null };
          if (reused) mediaPlan = { ...base, action: "reuse", existingId: reused.id, url: reused.url, message: "Identical to a file imported before; the existing copy is reused." };
          else if (!sniffed) mediaPlan = { ...base, action: "unsupported", message: `"${basename(found.path)}" isn't a supported media type (JPEG, PNG, GIF, WebP, AVIF, PDF, MP3, M4A), or its contents don't match its extension.` };
          else if (file.size > this.options.maxUploadBytes) mediaPlan = { ...base, action: "too_large", message: `"${basename(found.path)}" is larger than the ${Math.floor(this.options.maxUploadBytes / 1024 / 1024)} MB upload limit.` };
          else mediaPlan = base;
        } else mediaPlan = this.mediaPlans.get(key)!;
      }
    }
    if (!mediaPlan.usedBy.includes(docKey)) mediaPlan.usedBy.push(docKey);
    this.mediaPlans.set(mediaPlan.key, mediaPlan);
    return mediaPlan.key;
  }

  private planMedia(): void {
    for (const plan of [...this.plans.values()].sort(byKey)) {
      const doc = this.sourceOf(plan.key);
      if (!doc) continue;
      plan.mediaRefs = doc.mediaRefs.map((target, index) => ({ index, target, mediaKey: this.mediaKeyFor(target, plan.key, "") }));
      const folderCover = plan.synthetic ? this.folderMeta(plan.key.slice("collection:".length))?.cover : null;
      const cover = doc.cover ?? folderCover ?? null;
      if (cover) plan.coverMediaKey = this.mediaKeyFor(cover, plan.key, "");
    }
    for (const media of this.mediaPlans.values()) {
      media.usedBy.sort();
      if (media.action === "upload" || media.action === "reuse") continue;
      for (const key of media.usedBy) {
        const plan = this.plans.get(key);
        plan?.issues.push(issue("warning", media.action === "external" ? "media.external" : media.action === "too_large" ? "media.too_large" : media.action === "unsupported" ? "media.unsupported" : "media.missing", `${media.message ?? "Media not available."} A visible placeholder marks the spot (it blocks publishing until replaced).`, { path: plan.sourcePath, detail: media.path ?? media.url ?? media.key }));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Relations
  // -------------------------------------------------------------------------

  private planRelations(): RelationPlan[] {
    const out: RelationPlan[] = [];
    const seen = new Set<string>();
    const push = (rel: RelationPlan) => {
      const targetId = rel.target.status === "incoming" ? rel.target.key : rel.target.id;
      if (targetId === rel.sourceKey || (rel.target.status === "existing" && this.plans.get(rel.sourceKey)?.conflict?.existing.id === rel.target.id)) {
        this.plans.get(rel.sourceKey)?.issues.push(issue("info", "relation.self", "A link from the document to itself was ignored as a relationship.", { path: this.plans.get(rel.sourceKey)?.sourcePath }));
        return;
      }
      const key = `${rel.sourceKey}|${targetId}|${rel.kind}|${rel.origin}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(rel);
    };
    for (const plan of [...this.plans.values()].sort(byKey)) {
      if (plan.action === "blocked" || plan.action === "excluded" || plan.action === "skip") continue;
      const doc = this.sourceOf(plan.key);
      for (const rel of doc?.relations ?? []) {
        const resolution = this.resolveTarget(rel.target, plan.key);
        if (resolution.status !== "incoming" && resolution.status !== "existing") {
          plan.issues.push(issue("warning", "reference.unresolved", `The ${rel.kind.replace("_", " ")} relationship to ${describeTarget(rel.target)} doesn't resolve${resolution.status === "ambiguous" ? " unambiguously" : ""}, so it was not created.`, { path: plan.sourcePath, detail: describeTarget(rel.target) }));
          continue;
        }
        const kind = isRelationKind(rel.kind) ? rel.kind : "related";
        if (kind !== rel.kind) plan.issues.push(issue("info", "body.transformed", `Relationship kind "${rel.kind}" isn't supported; "related" is used.`, { path: plan.sourcePath }));
        push({ sourceKey: plan.key, target: resolution, kind, note: rel.note.slice(0, 300), origin: "manual", evidence: rel.from === "folder" ? "notion-hierarchy" : rel.from === "manifest" ? "manifest" : "frontmatter" });
      }
      for (const ref of plan.refs) {
        if (ref.resolution.status !== "incoming" && ref.resolution.status !== "existing") continue;
        push({ sourceKey: plan.key, target: ref.resolution, kind: "references", note: "", origin: "content", evidence: ref.evidence });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Status and visibility
  // -------------------------------------------------------------------------

  private planStatus(): void {
    const policy = this.decisions.status ?? { mode: "draft" };
    for (const plan of this.plans.values()) {
      const decision = this.decisions.documents?.[plan.key];
      const doc = this.sourceOf(plan.key);
      if (plan.action === "update" || plan.action === "skip") {
        const existing = plan.conflict!.existing;
        plan.status = (isDocumentStatus(existing.status) ? existing.status : "draft") as DocumentStatus;
        plan.visibility = (isVisibility(existing.visibility) ? existing.visibility : "private") as Visibility;
        plan.statusFrom = "existing";
        if (plan.action === "update" && (plan.updateFields.includes("status") || plan.updateFields.includes("visibility"))) {
          const next = this.statusFor(policy, decision, doc, plan.action);
          if (plan.updateFields.includes("status")) plan.status = next.status;
          if (plan.updateFields.includes("visibility")) plan.visibility = next.visibility;
          plan.statusFrom = next.from;
        }
        continue;
      }
      const next = this.statusFor(policy, decision, doc, plan.action);
      plan.status = next.status;
      plan.visibility = next.visibility;
      plan.statusFrom = next.from;
      if (doc?.sourceStatus && next.from === "default" && ["published", "public", "live", "done"].includes(doc.sourceStatus)) {
        plan.issues.push(issue("info", "status.not_applied", `The source marks this as "${doc.sourceStatus}". It is imported as a draft; choose Published or "Follow each file's status" to change that.`, { path: plan.sourcePath }));
      }
      if (plan.legacyUrls.length && !(plan.status === "published" && plan.visibility !== "private")) {
        plan.issues.push(issue("info", "legacy_url.not_applied", `Old URLs (${plan.legacyUrls.join(", ")}) are kept as source metadata; redirects are created only for documents imported as published.`, { path: plan.sourcePath }));
      }
    }
  }

  private statusFor(policy: NonNullable<ImportDecisions["status"]>, decision: DocumentDecision | undefined, doc: NormalizedDocument | null, action: DocumentPlan["action"]): { status: DocumentStatus; visibility: Visibility; from: DocumentPlan["statusFrom"] } {
    if (decision?.status || decision?.visibility) {
      return { status: decision.status ?? "draft", visibility: decision.visibility ?? "public", from: "decision" };
    }
    // Drafts are stored public: a draft is never served, and publishing it later should make it live, as in the editor.
    if (action === "copy") return { status: "draft", visibility: "public", from: "default" };
    if (policy.mode === "set") return { status: policy.status, visibility: policy.visibility, from: "decision" };
    if (policy.mode === "source" && doc) {
      const s = doc.sourceStatus === "public" || doc.sourceStatus === "live" ? "published" : doc.sourceStatus;
      const status = isDocumentStatus(s) && s !== "scheduled" ? s : "draft";
      const visibility = isVisibility(doc.sourceVisibility) ? doc.sourceVisibility : "public";
      return { status, visibility, from: "source" };
    }
    return { status: "draft", visibility: "public", from: "default" };
  }

  /**
   * Search engines. Automatic keeps the type's default, plus a file's own
   * "noindex"; a file's "index" is never applied (reported instead), so an
   * import can't opt a page into the index by itself. Index/Noindex are the
   * owner's explicit choices, import-wide or per document, and win.
   */
  private planIndexing(): void {
    for (const plan of this.plans.values()) {
      if (plan.action === "skip" || plan.action === "excluded" || plan.action === "blocked") continue;
      const choice = this.decisions.documents?.[plan.key]?.indexing ?? this.decisions.indexing ?? "auto";
      if (choice === "index" || choice === "noindex") {
        plan.robotsIndex = choice;
        plan.robotsFrom = "decision";
        continue;
      }
      if (this.sourceOf(plan.key)?.robotsIndex === "index") {
        plan.issues.push(issue("info", "robots.not_applied", "The source asks search engines to index this. Indexing follows the format's default; choose Index for it to apply.", { path: plan.sourcePath }));
      }
    }
  }

  /** Documents that will actually carry each topic/tag, once actions are final. */
  private countUsage(): void {
    const writes = (p: DocumentPlan, field: UpdateField) => p.action === "create" || p.action === "copy" || (p.action === "update" && p.updateFields.includes(field));
    for (const plan of this.plans.values()) {
      if (writes(plan, "topics")) for (const key of plan.topicKeys) this.topicPlans.get(key)!.documentCount += 1;
      if (writes(plan, "tags")) for (const key of plan.tagKeys) this.tagPlans.get(key)!.documentCount += 1;
    }
  }

  private finishDecisions(): void {
    // A document blocked or excluded needs no further decision.
    const inactive = new Set([...this.plans.values()].filter((p) => p.action === "blocked" || p.action === "excluded").map((p) => p.key));
    for (let i = this.decisionsRequired.length - 1; i >= 0; i--) {
      if (inactive.has(this.decisionsRequired[i]!.key)) this.decisionsRequired.splice(i, 1);
    }
  }
}

function describeTarget(target: DocTarget): string {
  switch (target.kind) {
    case "path":
      return `"${target.path}"`;
    case "wiki":
      return `[[${target.name}]]`;
    case "pid":
      return `document ${target.pid}`;
    case "site":
      return target.path;
    case "slug":
      return `"${target.slug}"`;
  }
}

function hashCode(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return h;
}

/** True when the plan can be approved: no outstanding decisions and something to do. */
export function planIsApprovable(plan: ImportPlan): { ok: boolean; reason: string | null } {
  if (plan.decisionsRequired.length) return { ok: false, reason: `${plan.decisionsRequired.length} decision${plan.decisionsRequired.length === 1 ? " is" : "s are"} still needed.` };
  const work = plan.summary.create + plan.summary.update + plan.summary.copy;
  if (!work && !plan.collections.some((c) => c.action === "merge" && c.items.length)) return { ok: false, reason: "Nothing would be imported." };
  return { ok: true, reason: null };
}

