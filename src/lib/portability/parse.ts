/**
 * Source detection and parsing: staged files → ParsedPackage.
 *
 * Pure and deterministic (same files → same output, regardless of the order
 * they arrived in). No database, no network: references to other documents
 * and media are recorded as targets for the planner to resolve.
 */
import { EMPTY_DOC, isUuid, sanitizeDoc, ContentTooLargeError, type BlockNode, type Doc } from "../content/blocks";
import { newStats, type BodyContext } from "./body-context";
import { portableToPlaceholders } from "./doc-refs";
import { list, mapSourceMetadata, emptyMetadata, normalizeKey, type MappedMetadata } from "./field-map";
import { splitFrontmatter } from "./frontmatter";
import { findElement, htmlToBlocks, parseHtml, removeElement, textContent, type HtmlElement } from "./html-to-doc";
import { IMPORT_LIMITS } from "./limits";
import { parseManifest, type PortableManifest } from "./manifest";
import { markdownToBlocks, preprocessMdx } from "./markdown-to-doc";
import {
  issue,
  MEDIA_PREFIX,
  REF_PREFIX,
  type DocTarget,
  type FolderMetadata,
  type Issue,
  type MediaFile,
  type MediaTarget,
  type NormalizedDocument,
  type ParsedPackage,
  type SourceSystem,
  type ValueFrom,
} from "./model";
import { stripNumericPrefix } from "./order";
import {
  basename,
  collisionKey,
  commonRoot,
  dirname,
  extension,
  fileKind,
  isJunkPath,
  normalizePackagePath,
  resolveRelative,
  safeDecodeUri,
  stem,
  stripRoot,
  type FileKind,
} from "./paths";
import { decodeEntities } from "./text";

export type StagedFile = {
  path: string;
  size: number;
  /** UTF-8 text for text kinds; null for media. */
  text: string | null;
  sha256: string | null;
  /** Leading bytes (base64) of media files. */
  head: string | null;
};

export type ParseOptions = {
  /** This site's public origin, to recognise absolute links to itself. */
  siteOrigin: string;
  /** Public origin of stored media (R2), to recognise existing media URLs. */
  mediaOrigin: string | null;
  /** The browser saw a `.obsidian/` folder before junk was filtered out. */
  obsidianVault?: boolean;
  /** Import README files as documents too. */
  importReadmes?: boolean;
  /** Keep a single wrapper folder as a real folder (by default it is treated as the package root). */
  keepRootFolder?: boolean;
};

const NOTION_ID = / ([0-9a-f]{32})$/;
const NOTION_URL_ID = /notion\.so\/(?:[^/?#]+\/)?(?:[^/?#]*-)?([0-9a-f]{32})(?:[?#]|$)/;
const README = /^(readme|_index)\.(md|markdown|mdx|txt|html?)$/i;
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif"]);
const MEDIA_EXT = new Set([...IMAGE_EXT, "pdf", "mp3", "m4a"]);
const DOC_KINDS = new Set<FileKind>(["markdown", "mdx", "html", "text"]);

export async function sha256Hex(text: string | Uint8Array): Promise<string> {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function parsePackage(input: StagedFile[], options: ParseOptions): Promise<ParsedPackage> {
  const issues: Issue[] = [];
  const files: StagedFile[] = [];
  const seen = new Map<string, string>();
  for (const file of [...input].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const normalized = normalizePackagePath(file.path);
    if (!normalized.ok) {
      issues.push(issue("error", "file.path_invalid", `Skipped "${file.path}": ${normalized.reason}`, { detail: file.path }));
      continue;
    }
    if (isJunkPath(normalized.path)) continue;
    const key = collisionKey(normalized.path);
    const previous = seen.get(key);
    if (previous) {
      issues.push(issue("error", "file.path_collision", `"${normalized.path}" collides with "${previous}" (names differ only by case or Unicode form). Only the first was used.`, { path: normalized.path }));
      continue;
    }
    seen.set(key, normalized.path);
    files.push({ ...file, path: normalized.path });
  }

  const manifestFile = findManifest(files);
  if (manifestFile) return parsePortable(manifestFile, files, issues);

  const bundle = findLegacyBundle(files);
  if (bundle) return parseLegacyBundle(bundle.file, bundle.data, issues);

  return parseLooseFiles(files, options, issues);
}

function findManifest(files: StagedFile[]): StagedFile | null {
  const candidates = files.filter((f) => basename(f.path) === "manifest.json" && f.text && f.text.includes('"studio-portable"'));
  candidates.sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  return candidates[0] ?? null;
}

function findLegacyBundle(files: StagedFile[]): { file: StagedFile; data: Record<string, unknown> } | null {
  for (const file of files) {
    if (extension(file.path) !== "json" || !file.text || !file.text.includes('"karthikeyan-a-studio-export"')) continue;
    try {
      const data = JSON.parse(file.text) as Record<string, unknown>;
      if (data.format === "karthikeyan-a-studio-export") return { file, data };
    } catch {
      // Reported as an unsupported JSON file below.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Markdown / HTML / text folders (plain, Notion, Obsidian)
// ---------------------------------------------------------------------------

function detectSystem(files: StagedFile[], options: ParseOptions): { system: SourceSystem; assumptions: string[] } {
  const docs = files.filter((f) => DOC_KINDS.has(fileKind(f.path)));
  const notion = docs.filter((f) => NOTION_ID.test(stem(f.path))).length;
  if (notion > 0 && notion * 2 >= docs.length) {
    return { system: "notion", assumptions: [`Detected a Notion export (${notion} page${notion === 1 ? "" : "s"} with Notion ids in their file names). Ids become portable identifiers; page folders hold sub-pages and attachments.`] };
  }
  const wiki = docs.filter((f) => f.text && /!?\[\[[^\]\n]+\]\]/.test(f.text)).length;
  if (options.obsidianVault || wiki > 0) {
    return {
      system: "obsidian",
      assumptions: [
        options.obsidianVault ? "Detected an Obsidian vault (.obsidian folder)." : `Detected Obsidian-style [[wikilinks]] in ${wiki} file${wiki === 1 ? "" : "s"}.`,
        "Wikilinks resolve by note name, then by alias; attachments resolve by file name anywhere in the vault.",
      ],
    };
  }
  return { system: "folder", assumptions: ["Plain files: top-level folders suggest topics, numbered files suggest ordered collections."] };
}

async function parseLooseFiles(all: StagedFile[], options: ParseOptions, issues: Issue[]): Promise<ParsedPackage> {
  const root = options.keepRootFolder ? "" : commonRoot(all.map((f) => f.path));
  const files = all.map((f) => ({ ...f, path: stripRoot(f.path, root) }));
  const { system, assumptions } = detectSystem(files, options);
  if (root) assumptions.push(`Everything is inside "${root}/", so that folder was treated as the package root, not as a topic. Choose "Keep the top folder" if it should be one.`);

  const docFiles: StagedFile[] = [];
  const media: MediaFile[] = [];
  let totalText = 0;
  for (const file of files) {
    const kind = fileKind(file.path);
    if (DOC_KINDS.has(kind)) {
      if (file.text === null) {
        issues.push(issue("error", "file.encoding", `"${file.path}" is not valid UTF-8 text.`, { path: file.path }));
        continue;
      }
      totalText += file.text.length;
      docFiles.push(file);
    } else if (kind === "media") {
      media.push({ path: file.path, size: file.size, sha256: file.sha256 ?? "", head: file.head ?? "" });
    } else if (kind === "csv") {
      issues.push(issue("warning", "file.unsupported", `"${file.path}" looks like a database/table export (CSV). Databases are not imported; their pages are.`, { path: file.path }));
    } else if (kind === "json") {
      issues.push(issue("warning", "file.unsupported", `"${file.path}" is JSON but not a studio package manifest or export bundle, so it was skipped.`, { path: file.path }));
    } else if (kind === "archive") {
      issues.push(issue("warning", "file.unsupported", `"${file.path}" is an archive nested too deeply to expand.`, { path: file.path }));
    } else {
      issues.push(issue("info", "file.unsupported", `"${file.path}" has an unsupported file type and was skipped.`, { path: file.path }));
    }
  }
  if (docFiles.length > IMPORT_LIMITS.maxDocuments) {
    issues.push(issue("error", "file.too_large", `This import has ${docFiles.length} documents; the limit is ${IMPORT_LIMITS.maxDocuments}. Split it into smaller imports.`));
  }
  if (totalText > IMPORT_LIMITS.maxTotalTextBytes) issues.push(issue("error", "file.too_large", "This import contains more text than one import may hold. Split it into smaller imports."));

  const fileSet = new Set(files.map((f) => f.path));
  const env: ParseEnv = { system, options, fileSet };

  const documents: NormalizedDocument[] = [];
  const readmes = new Map<string, NormalizedDocument>();
  for (const file of docFiles.slice(0, IMPORT_LIMITS.maxDocuments)) {
    const doc = await parseDocumentFile(file, env);
    if (doc.isReadme) {
      readmes.set(dirname(file.path), doc);
      if (options.importReadmes || doc.unmapped["import"] === true) documents.push(doc);
    } else documents.push(doc);
  }

  if (system === "notion") linkNotionHierarchy(documents);

  const folderPaths = new Set<string>();
  for (const doc of documents) {
    let dir = dirname(doc.sourcePath);
    while (dir) {
      folderPaths.add(dir);
      dir = dirname(dir);
    }
  }
  for (const dir of readmes.keys()) folderPaths.add(dir);
  const folders = [...folderPaths].sort().map((path) => folderMetadata(path, readmes.get(path) ?? null, env));
  if (readmes.has("") && !folders.some((f) => f.path === "")) folders.unshift(folderMetadata("", readmes.get("")!, env));

  return {
    sourceSystem: system,
    assumptions,
    rootFolder: root,
    documents,
    readmes: [...readmes.values()].sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : 1)),
    folders,
    media,
    manifestCollections: [],
    manifestTopics: [],
    manifestTags: [],
    manifestAssets: [],
    schemaVersion: null,
    issues,
  };
}

type ParseEnv = { system: SourceSystem; options: ParseOptions; fileSet: Set<string> };

function titleFromFilename(path: string): string {
  let name = stem(path).replace(NOTION_ID, "");
  name = safeDecodeUri(name);
  const stripped = stripNumericPrefix(name);
  const words = stripped.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || name;
  return words === words.toLowerCase() ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

/** Collects references for one document, deduplicated, as placeholder strings. */
class RefTable {
  readonly refs: DocTarget[] = [];
  readonly media: MediaTarget[] = [];
  doc(target: DocTarget): string {
    const key = JSON.stringify(target);
    let i = this.refs.findIndex((r) => JSON.stringify(r) === key);
    if (i === -1) i = this.refs.push(target) - 1;
    return `${REF_PREFIX}${i}`;
  }
  asset(target: MediaTarget): string {
    const key = JSON.stringify(target);
    let i = this.media.findIndex((r) => JSON.stringify(r) === key);
    if (i === -1) i = this.media.push(target) - 1;
    return `${MEDIA_PREFIX}${i}`;
  }
}

function isMediaPath(path: string): boolean {
  return MEDIA_EXT.has(extension(path)) || ["svg", "mp4", "mov", "webm", "heic", "tif", "tiff", "bmp", "ico", "wav", "ogg", "docx", "xlsx", "pptx"].includes(extension(path));
}

function mediaTargetFor(src: string, fromFile: string, env: ParseEnv, issues: Issue[]): MediaTarget | null {
  const value = decodeEntities(src.trim());
  if (!value) return null;
  if (/^data:/i.test(value)) {
    issues.push(issue("warning", "media.unsupported", "An inline data: image was not imported. Save it as a file in the package instead.", { path: fromFile }));
    return null;
  }
  if (value.startsWith("/media/")) return { kind: "site", src: value.split(/[?#]/)[0]!, mediaId: null };
  if (/^https?:\/\//i.test(value)) {
    if (env.options.mediaOrigin && value.startsWith(env.options.mediaOrigin + "/")) return { kind: "site", src: value, mediaId: null };
    return { kind: "external", url: value };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return null;
  const resolved = resolveRelative(fromFile, value);
  return resolved ? { kind: "path", path: resolved.path } : null;
}

function bodyContext(file: StagedFile, env: ParseEnv, refs: RefTable, issues: Issue[]): BodyContext {
  const ctx: BodyContext = {
    path: file.path,
    stats: newStats(),
    issue: (i) => issues.push(i),
    link(href) {
      const value = decodeEntities(href.trim());
      if (!value) return null;
      if (value.startsWith("#")) return /^#[\w\-:.]*$/.test(value) ? value : null;
      if (/^mailto:/i.test(value)) return value;
      if (/^https?:\/\//i.test(value)) {
        const notion = NOTION_URL_ID.exec(value);
        if (notion && env.system === "notion") return refs.doc({ kind: "pid", pid: `notion:${notion[1]}` });
        if (value.startsWith(env.options.siteOrigin + "/")) return refs.doc({ kind: "site", path: value.slice(env.options.siteOrigin.length).split(/[?#]/)[0]! });
        return value;
      }
      if (value.startsWith("/") && !value.startsWith("//")) {
        if (value.startsWith("/media/")) return refs.asset({ kind: "site", src: value, mediaId: null });
        return refs.doc({ kind: "site", path: value.split(/[?#]/)[0]! });
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
      const resolved = resolveRelative(file.path, value);
      if (!resolved) return null;
      if (isMediaPath(resolved.path)) return refs.asset({ kind: "path", path: resolved.path });
      return refs.doc({ kind: "path", path: resolved.path, fragment: resolved.fragment });
    },
    media(src) {
      const target = mediaTargetFor(src, file.path, env, issues);
      return target ? refs.asset(target) : null;
    },
    wikiLink(target) {
      const [name, fragment] = splitWikiTarget(target);
      if (!name) return fragment ? `#${fragment}` : null;
      if (isMediaPath(name)) return refs.asset({ kind: "wiki", name });
      return refs.doc({ kind: "wiki", name, fragment });
    },
    wikiEmbed(target) {
      const [name] = splitWikiTarget(target);
      if (IMAGE_EXT.has(extension(name)) || extension(name) === "svg") return { kind: "image", src: refs.asset({ kind: "wiki", name }) };
      if (isMediaPath(name)) return { kind: "link", href: refs.asset({ kind: "wiki", name }) };
      issues.push(issue("info", "body.transformed", `Embedded note "![[${name}]]" was converted to a link (transclusion isn't supported).`, { path: file.path, detail: name }));
      return { kind: "link", href: name ? refs.doc({ kind: "wiki", name, fragment: null }) : null };
    },
  };
  return ctx;
}

function splitWikiTarget(target: string): [string, string | null] {
  const hash = target.indexOf("#");
  const name = (hash === -1 ? target : target.slice(0, hash)).trim();
  const fragment = hash === -1 ? null : target.slice(hash + 1).replace(/^\^/, "").trim() || null;
  return [name, fragment];
}

function firstHeading(blocks: BlockNode[]): { text: string; level: number } | null {
  const first = blocks[0];
  if (first?.type !== "heading") return null;
  const text = (first.content ?? []).map((n) => n.text ?? "").join("").trim();
  return text ? { text, level: Number(first.attrs?.level ?? 2) } : null;
}

function reportStats(ctx: BodyContext, issues: Issue[]): void {
  const { stats, path } = ctx;
  if (stats.headingsLowered) issues.push(issue("info", "body.transformed", `${stats.headingsLowered} heading${stats.headingsLowered === 1 ? "" : "s"} below level 3 became level 3 (the editor has three heading levels).`, { path }));
  if (stats.imagesLifted) issues.push(issue("info", "body.transformed", `${stats.imagesLifted} inline image${stats.imagesLifted === 1 ? " was" : "s were"} moved below ${stats.imagesLifted === 1 ? "its" : "their"} paragraph (images are blocks).`, { path }));
  if (stats.strippedTags.size) issues.push(issue("info", "html.stripped", `HTML without a block equivalent was removed, text kept: ${[...stats.strippedTags].sort().slice(0, 8).join(", ")}.`, { path }));
  for (const what of [...stats.unsupported].sort()) issues.push(issue("warning", "body.unsupported", `Unsupported content: ${what}.`, { path }));
}

/** Notion's Markdown export lists page properties as "Key: Value" lines under the title. */
function extractNotionProperties(markdown: string): { body: string; properties: Record<string, string> } {
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  if (!/^#\s+/.test(lines[i] ?? "")) return { body: markdown, properties: {} };
  let j = i + 1;
  while (j < lines.length && !lines[j]!.trim()) j++;
  const properties: Record<string, string> = {};
  let k = j;
  while (k < lines.length && /^([A-Z][\w &/()'.-]{0,40}):\s+(.+)$/.test(lines[k]!)) {
    const m = /^([A-Z][\w &/()'.-]{0,40}):\s+(.+)$/.exec(lines[k]!)!;
    properties[m[1]!.trim()] = m[2]!.trim();
    k++;
  }
  if (!Object.keys(properties).length || (lines[k] ?? "").trim()) return { body: markdown, properties: {} };
  return { body: [...lines.slice(0, j), ...lines.slice(k)].join("\n"), properties };
}

function obsidianInlineTags(markdown: string): string[] {
  const tags = new Set<string>();
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence || /^#{1,6}\s/.test(line)) continue;
    const withoutCode = line.replace(/`[^`]*`/g, "");
    for (const m of withoutCode.matchAll(/(?:^|[\s(])#([\p{L}_][\p{L}\p{N}_/-]*)/gu)) tags.add(m[1]!);
  }
  return [...tags].slice(0, 30);
}

async function parseDocumentFile(file: StagedFile, env: ParseEnv): Promise<NormalizedDocument> {
  const issues: Issue[] = [];
  const refs = new RefTable();
  const kind = fileKind(file.path);
  const ctx = bodyContext(file, env, refs, issues);
  const isReadme = README.test(basename(file.path));
  let meta: MappedMetadata = emptyMetadata();
  let metaFrom: ValueFrom = "frontmatter";
  let blocks: BlockNode[] = [];
  let text = file.text ?? "";
  const unmapped: Record<string, unknown> = {};
  let blocked = false;

  if (kind === "markdown" || kind === "mdx" || kind === "text") {
    const fm = kind === "text" ? ({ kind: "none", body: text } as const) : splitFrontmatter(text);
    if (fm.kind === "error") {
      issues.push(issue("error", "frontmatter.malformed", `${fm.message} Fix the front matter and import again — the file was not imported, so its metadata isn't misread as text.`, { path: file.path }));
      blocked = true;
    } else if (fm.kind === "ok") {
      meta = mapSourceMetadata(fm.data, file.path);
    }
    text = fm.body;
    if (env.system === "notion" && kind !== "text") {
      const props = extractNotionProperties(text);
      if (Object.keys(props.properties).length) {
        const notionMeta = mapSourceMetadata(props.properties, file.path);
        meta = mergeMetadata(meta, notionMeta);
        metaFrom = Object.keys(meta.candidates).length || meta.tags.length ? "metadata" : metaFrom;
        text = props.body;
      }
    }
    if (kind === "mdx") {
      const mdx = preprocessMdx(text);
      text = mdx.source;
      if (mdx.esm.length) {
        unmapped["mdx.esm"] = mdx.esm;
        issues.push(issue("warning", "mdx.unsupported", `${mdx.esm.length} MDX import/export statement${mdx.esm.length === 1 ? " was" : "s were"} removed (MDX code is never run). They are kept in the import record.`, { path: file.path }));
      }
      if (mdx.components.length) {
        issues.push(issue("warning", "mdx.unsupported", `MDX components kept as source code blocks: ${mdx.components.slice(0, 8).join(", ")}.`, { path: file.path }));
      }
    }
    if (kind === "text") {
      blocks = text
        .replace(/\r\n?/g, "\n")
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => ({ type: "paragraph", content: p.split("\n").flatMap((line, i) => (i ? [{ type: "hardBreak" }, { type: "text", text: line }] : [{ type: "text", text: line }])) }));
    } else if (!blocked) {
      blocks = markdownToBlocks(text, ctx);
    }
    if (env.system === "obsidian" && kind !== "text") {
      for (const tag of obsidianInlineTags(text)) if (!meta.tags.includes(tag)) meta.tags.push(tag);
      if (/==[^=\n]+==/.test(text)) issues.push(issue("info", "body.transformed", "Obsidian highlights (==text==) were kept as plain text.", { path: file.path }));
    }
  } else if (kind === "html") {
    const root = parseHtml(text);
    const notionMeta = env.system === "notion" ? extractNotionHtmlProperties(root) : {};
    const converted = htmlToBlocks(root, ctx);
    blocks = converted.blocks;
    meta = mapSourceMetadata({ ...(converted.title ? { title: converted.title } : {}), ...(converted.description ? { description: converted.description } : {}), ...notionMeta }, file.path);
    metaFrom = "metadata";
  }

  reportStats(ctx, issues);

  // Title: explicit metadata, else a leading H1, else the file name. A leading H1 that repeats the title is removed.
  let title: { value: string; from: ValueFrom };
  const heading = firstHeading(blocks);
  if (meta.title) {
    title = { value: meta.title, from: metaFrom };
    if (heading && heading.level === 1 && heading.text.toLowerCase() === meta.title.toLowerCase()) blocks = blocks.slice(1);
  } else if (heading && heading.level === 1) {
    title = { value: heading.text, from: "heading" };
    blocks = blocks.slice(1);
  } else {
    title = { value: titleFromFilename(file.path), from: "filename" };
  }

  const body = boundedDoc(blocks, file.path, issues);
  const notionId = NOTION_ID.exec(stem(file.path))?.[1] ?? null;
  const pid = meta.pid ?? (notionId ? `notion:${notionId}` : null);

  const cover = meta.cover ? mediaTargetFor(meta.cover, file.path, env, issues) : null;
  const relations = meta.related.map((value) => ({ target: relationTarget(value, file.path), kind: "related", note: "", from: "frontmatter" as ValueFrom }));
  if (meta.author) unmapped.author = meta.author;
  Object.assign(unmapped, meta.rejected);
  if (meta.collection) unmapped.collection = meta.collection;
  if (isReadme && meta.importAsDocument !== null) unmapped["import"] = meta.importAsDocument;

  return {
    key: file.path,
    sourcePath: file.path,
    sourceFormat: kind === "mdx" ? "mdx" : kind === "html" ? "html" : kind === "text" ? "text" : "markdown",
    sourceSystem: env.system,
    pid,
    originalId: notionId,
    title,
    slug: meta.slug ? { value: meta.slug, from: metaFrom } : null,
    type: meta.type ? { value: meta.type, from: metaFrom } : null,
    excerpt: meta.excerpt,
    seoTitle: meta.seoTitle,
    seoDescription: meta.seoDescription,
    canonicalUrl: meta.canonicalUrl,
    robotsIndex: meta.robotsIndex,
    sourceStatus: meta.sourceStatus,
    sourceVisibility: meta.sourceVisibility,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    publishedAt: meta.publishedAt,
    topics: meta.topics.map((value, i) => ({ value, primary: i === 0, from: metaFrom })),
    tags: meta.tags.map((value) => ({ value, from: metaFrom })),
    order: meta.order,
    cover,
    properties: meta.candidates,
    relations,
    legacyUrls: meta.legacyUrls,
    aliases: meta.aliases,
    author: meta.author,
    notes: meta.notes,
    featured: meta.featured,
    priority: meta.priority,
    body: blocked ? EMPTY_DOC : body,
    refs: refs.refs,
    mediaRefs: refs.media,
    unmapped,
    issues: [...meta.issues, ...issues],
    isReadme,
  };
}

function mergeMetadata(a: MappedMetadata, b: MappedMetadata): MappedMetadata {
  const out = { ...a, candidates: { ...b.candidates, ...a.candidates }, rejected: { ...b.rejected, ...a.rejected }, issues: [...a.issues, ...b.issues] };
  for (const key of Object.keys(b) as Array<keyof MappedMetadata>) {
    const av = a[key];
    const bv = b[key];
    if ((av === null || (Array.isArray(av) && !av.length)) && bv !== null && !(Array.isArray(bv) && !bv.length)) (out as Record<string, unknown>)[key] = bv;
  }
  return out;
}

function extractNotionHtmlProperties(root: HtmlElement): Record<string, string> {
  const props: Record<string, string> = {};
  const table = findElement(root, (el) => el.tag === "table" && /\bproperties\b/.test(el.attrs.class ?? ""));
  if (table) {
    const rows: HtmlElement[] = [];
    const collect = (el: HtmlElement) => el.children.forEach((c) => typeof c !== "string" && (c.tag === "tr" ? rows.push(c) : collect(c)));
    collect(table);
    for (const row of rows) {
      const cells = row.children.filter((c): c is HtmlElement => typeof c !== "string" && (c.tag === "th" || c.tag === "td"));
      if (cells.length >= 2) props[textContent(cells[0]!).trim()] = textContent(cells[1]!).replace(/\s+/g, " ").trim();
    }
    removeElement(root, table);
  }
  const title = findElement(root, (el) => /\bpage-title\b/.test(el.attrs.class ?? ""));
  if (title) {
    props.title = textContent(title).trim();
    removeElement(root, title);
  }
  return props;
}

function relationTarget(value: string, fromFile: string): DocTarget {
  const v = value.trim();
  if (/^\[\[.+\]\]$/.test(v)) {
    const [name, fragment] = splitWikiTarget(v.slice(2, -2).split("|")[0]!);
    return { kind: "wiki", name, fragment };
  }
  if (v.startsWith("/")) return { kind: "site", path: v };
  if (/\.(md|mdx|markdown|html?)$/i.test(v) || v.includes("/")) {
    const resolved = resolveRelative(fromFile, v);
    if (resolved) return { kind: "path", path: resolved.path, fragment: resolved.fragment };
  }
  return { kind: "slug", slug: v };
}

function boundedDoc(blocks: BlockNode[], path: string, issues: Issue[]): Doc {
  const doc: Doc = { type: "doc", content: blocks };
  try {
    sanitizeDoc(doc); // size check only; the real sanitising happens after references resolve
  } catch (error) {
    if (error instanceof ContentTooLargeError) {
      issues.push(issue("error", "body.too_large", `${error.message} Split this document before importing it.`, { path }));
      return EMPTY_DOC;
    }
    throw error;
  }
  return doc;
}

/** Notion keeps sub-pages in a folder named after their parent page: record that as "part of". */
function linkNotionHierarchy(documents: NormalizedDocument[]): void {
  const byStemPath = new Map<string, NormalizedDocument>();
  for (const doc of documents) byStemPath.set(`${dirname(doc.sourcePath)}/${stem(doc.sourcePath)}`.replace(/^\//, ""), doc);
  for (const doc of documents) {
    const parent = byStemPath.get(dirname(doc.sourcePath));
    if (parent && parent !== doc) doc.relations.push({ target: { kind: "path", path: parent.sourcePath, fragment: null }, kind: "part_of", note: "", from: "folder" });
  }
}

function folderMetadata(path: string, readme: NormalizedDocument | null, env: ParseEnv): FolderMetadata {
  const meta: FolderMetadata = {
    path,
    readmePath: readme?.sourcePath ?? null,
    title: null,
    description: null,
    type: null,
    collection: null,
    topics: [],
    tags: [],
    order: [],
    cover: null,
    importReadme: Boolean(env.options.importReadmes),
    slug: null,
    seoTitle: null,
    seoDescription: null,
  };
  if (!readme) return meta;
  meta.title = readme.title.from === "filename" ? null : readme.title.value;
  meta.description = readme.excerpt ?? firstParagraphText(readme.body);
  meta.type = readme.type?.value ?? null;
  meta.slug = readme.slug?.value ?? null;
  meta.seoTitle = readme.seoTitle;
  meta.seoDescription = readme.seoDescription;
  meta.topics = readme.topics.map((t) => t.value);
  meta.tags = readme.tags.map((t) => t.value);
  meta.cover = readme.cover;
  meta.importReadme = meta.importReadme || readme.unmapped["import"] === true;
  const collectionFlag = Object.entries(readme.properties).find(([k]) => normalizeKey(k) === "collection" || normalizeKey(k) === "course");
  const raw = collectionFlag?.[1] ?? readme.unmapped.collection;
  if (typeof raw === "boolean") meta.collection = raw;
  else if (typeof raw === "string" && /^(true|yes)$/i.test(raw)) meta.collection = true;
  const order = Object.entries(readme.properties).find(([k]) => normalizeKey(k) === "order" || normalizeKey(k) === "lessons" || normalizeKey(k) === "items");
  meta.order = order ? list(order[1], 500).map((n) => basename(n).normalize("NFC")) : orderedLinkTargets(readme);
  return meta;
}

function firstParagraphText(doc: Doc): string | null {
  const p = doc.content.find((n) => n.type === "paragraph");
  const text = (p?.content ?? []).map((n) => n.text ?? "").join("").trim();
  return text ? text.slice(0, 600) : null;
}

/** A README whose ordered list links to sibling files declares their order. */
function orderedLinkTargets(readme: NormalizedDocument): string[] {
  const list = readme.body.content.find((n) => n.type === "orderedList");
  if (!list) return [];
  const names: string[] = [];
  const visit = (node: BlockNode) => {
    for (const mark of node.marks ?? []) {
      const href = mark.type === "link" ? mark.attrs?.href : undefined;
      const index = href?.startsWith(REF_PREFIX) ? Number(href.slice(REF_PREFIX.length)) : Number.NaN;
      const target = Number.isInteger(index) ? readme.refs[index] : undefined;
      if (target?.kind === "path") names.push(basename(target.path));
      else if (target?.kind === "wiki") names.push(target.name);
    }
    node.content?.forEach(visit);
  };
  list.content?.forEach(visit);
  return [...new Set(names)];
}

// ---------------------------------------------------------------------------
// Native portable packages
// ---------------------------------------------------------------------------

async function parsePortable(manifestFile: StagedFile, all: StagedFile[], issues: Issue[]): Promise<ParsedPackage> {
  const root = dirname(manifestFile.path);
  const files = new Map(all.filter((f) => !root || f.path.startsWith(root + "/")).map((f) => [stripRoot(f.path, root), f]));
  let raw: unknown;
  try {
    raw = JSON.parse(manifestFile.text ?? "");
  } catch {
    issues.push(issue("error", "manifest.invalid", "manifest.json is not valid JSON.", { path: manifestFile.path }));
    return emptyPackage("studio-portable", root, issues);
  }
  const parsed = parseManifest(raw);
  if (!parsed.ok) {
    issues.push(issue("error", parsed.version && parsed.version > 1 ? "manifest.version" : "manifest.invalid", parsed.error, { path: manifestFile.path }));
    return emptyPackage("studio-portable", root, issues);
  }
  const manifest = parsed.manifest;
  const assumptions = [
    `Native studio package (format version ${manifest.schemaVersion}) exported ${manifest.exportedAt.slice(0, 10)} by ${manifest.generator.app}.`,
    "Identity, topics, tags, relations and collections come from the manifest; folders are not interpreted.",
  ];
  if (!manifest.contents.bodies) assumptions.push("This is a manifest-only package: documents have no bodies.");

  const documents: NormalizedDocument[] = [];
  for (const record of manifest.documents) {
    documents.push(await portableDocument(record, manifest, files));
  }
  const media: MediaFile[] = manifest.assets.flatMap((asset) => {
    const file = files.get(asset.path);
    if (!file) return [];
    return [{ path: asset.path, size: file.size, sha256: file.sha256 ?? asset.sha256 ?? "", head: file.head ?? "" }];
  });
  for (const asset of manifest.assets) {
    const file = files.get(asset.path);
    if (file && asset.sha256 && file.sha256 && file.sha256 !== asset.sha256) {
      issues.push(issue("error", "manifest.invalid", `"${asset.path}" doesn't match the checksum in manifest.json; the package may be corrupt.`, { path: asset.path }));
    }
  }

  return {
    sourceSystem: "studio-portable",
    assumptions,
    rootFolder: root,
    documents,
    readmes: [],
    folders: [],
    media,
    manifestCollections: manifest.collections.map((c) => ({
      collectionKey: `pid:${c.collection}`,
      items: c.items.map((item) => ({ documentKey: `pid:${item.document}`, position: item.position, groupLabel: item.groupLabel, note: item.note })),
    })),
    manifestTopics: manifest.topics.map((t) => ({ pid: t.pid, name: t.name, slug: t.slug, description: t.description, parentPid: t.parent })),
    manifestTags: manifest.tags.map((t) => ({ pid: t.pid, name: t.name, slug: t.slug, description: t.description })),
    manifestAssets: manifest.assets.map((a) => ({ pid: a.pid, path: a.path, alt: a.alt, caption: a.caption, sha256: a.sha256 })),
    schemaVersion: manifest.schemaVersion,
    issues,
  };
}

function emptyPackage(system: SourceSystem, root: string, issues: Issue[]): ParsedPackage {
  return { sourceSystem: system, assumptions: [], rootFolder: root, documents: [], readmes: [], folders: [], media: [], manifestCollections: [], manifestTopics: [], manifestTags: [], manifestAssets: [], schemaVersion: null, issues };
}

async function portableDocument(record: PortableManifest["documents"][number], manifest: PortableManifest, files: Map<string, StagedFile>): Promise<NormalizedDocument> {
  const issues: Issue[] = [];
  const path = record.body?.markdown ?? record.body?.doc ?? `manifest:${record.pid}`;
  let body: Doc = EMPTY_DOC;
  let refs: DocTarget[] = [];
  let mediaRefs: MediaTarget[] = [];

  const mdFile = record.body?.markdown ? files.get(record.body.markdown) : undefined;
  const docFile = record.body?.doc ? files.get(record.body.doc) : undefined;
  const mdEdited = Boolean(mdFile?.text && record.body?.markdownSha256 && (await sha256Hex(mdFile.text)) !== record.body.markdownSha256);
  if (docFile?.text && !mdEdited) {
    try {
      const converted = portableToPlaceholders(JSON.parse(docFile.text) as Doc);
      body = boundedDoc(converted.doc.content ?? [], path, issues);
      refs = converted.refs;
      mediaRefs = converted.mediaRefs;
    } catch {
      issues.push(issue("error", "manifest.invalid", `"${record.body!.doc}" is not a valid document file.`, { path }));
    }
  } else if (mdFile?.text) {
    if (mdEdited) issues.push(issue("info", "manifest.body_edited", "The Markdown file was edited after export, so it was used instead of the exact editor document.", { path }));
    const fm = splitFrontmatter(mdFile.text);
    const table = new RefTable();
    const env: ParseEnv = { system: "studio-portable", options: { siteOrigin: "", mediaOrigin: null }, fileSet: new Set(files.keys()) };
    const ctx = bodyContext({ ...mdFile, path: record.body!.markdown! }, env, table, issues);
    let blocks = markdownToBlocks(fm.body, ctx);
    reportStats(ctx, issues);
    const heading = firstHeading(blocks);
    if (heading && heading.level === 1 && heading.text.toLowerCase() === record.title.toLowerCase()) blocks = blocks.slice(1);
    body = boundedDoc(blocks, path, issues);
    refs = table.refs;
    // Media paths in the Markdown resolve to the package's asset paths.
    mediaRefs = table.media.map((m) => (m.kind === "path" ? (assetForPath(manifest, m.path) ?? m) : m));
  } else if (record.body && manifest.contents.bodies) {
    issues.push(issue("warning", "manifest.invalid", "The document's body file is missing from the package; it was imported without a body.", { path }));
  }

  const relations = manifest.relations
    .filter((r) => r.source === record.pid)
    .sort((a, b) => a.position - b.position)
    .map((r) => ({ target: { kind: "pid" as const, pid: r.target }, kind: r.kind, note: r.note, from: "manifest" as ValueFrom }));
  const unmapped: Record<string, unknown> = { ...record.unmapped };
  if (Object.keys(record.provenance).length) unmapped.provenance = record.provenance;
  if (record.hasStagedChanges) issues.push(issue("info", "manifest.invalid", "This document had unpublished staged edits on the source site; only its live version was exported.", { path }));

  return {
    key: `pid:${record.pid}`,
    sourcePath: path,
    sourceFormat: "portable",
    sourceSystem: "studio-portable",
    pid: record.pid,
    originalId: record.originalId,
    title: { value: record.title, from: "manifest" },
    slug: record.slug ? { value: record.slug, from: "manifest" } : null,
    type: { value: record.type, from: "manifest" },
    excerpt: record.excerpt || null,
    seoTitle: record.seo.title,
    seoDescription: record.seo.description,
    canonicalUrl: record.seo.canonicalUrl,
    robotsIndex: record.seo.robotsIndex === "default" ? null : record.seo.robotsIndex,
    sourceStatus: record.status,
    sourceVisibility: record.visibility,
    createdAt: record.dates.createdAt,
    updatedAt: record.dates.updatedAt,
    publishedAt: record.dates.publishedAt,
    topics: record.topics.map((t) => ({ value: `pid:${t.pid}`, primary: t.primary, from: "manifest" as ValueFrom })),
    tags: record.tags.map((t) => ({ value: `pid:${t}`, from: "manifest" as ValueFrom })),
    order: null,
    cover: record.featuredAsset ? { kind: "asset", pid: record.featuredAsset } : null,
    properties: record.properties,
    relations,
    legacyUrls: record.legacyUrls,
    aliases: [],
    author: record.author,
    notes: record.notes || null,
    featured: record.featured,
    priority: record.priority,
    body,
    refs,
    mediaRefs,
    unmapped,
    issues,
    isReadme: false,
  };
}

function assetForPath(manifest: PortableManifest, path: string): MediaTarget | null {
  const asset = manifest.assets.find((a) => a.path === path);
  return asset ? { kind: "asset", pid: asset.pid } : null;
}

// ---------------------------------------------------------------------------
// Legacy JSON bundle (format karthikeyan-a-studio-export) — existing backups
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

async function parseLegacyBundle(file: StagedFile, data: Row, issues: Issue[]): Promise<ParsedPackage> {
  const rows = (key: string) => (Array.isArray(data[key]) ? (data[key] as Row[]) : []);
  const types = new Map(rows("contentTypes").map((t) => [String(t.id), t]));
  const pidOf = (entity: string, id: unknown) => `studio:${entity}:${String(id)}`;
  const documents: NormalizedDocument[] = [];
  const docCats = rows("documentCategories");
  const docTags = rows("documentTags");
  const relations = rows("documentRelations").filter((r) => r.origin === "manual");

  for (const doc of rows("documents")) {
    const docIssues: Issue[] = [];
    const id = String(doc.id);
    const type = types.get(String(doc.typeId));
    const refs = new RefTable();
    const content = sanitizeDoc(doc.content);
    // Mentions and related blocks point at database ids: turn them into portable references.
    const withRefs = mapIds(content, refs);
    documents.push({
      key: `pid:${pidOf("document", id)}`,
      sourcePath: `${file.path}#${id}`,
      sourceFormat: "bundle",
      sourceSystem: "studio-bundle",
      pid: pidOf("document", id),
      originalId: id,
      title: { value: String(doc.title ?? "") || "Untitled", from: "manifest" },
      slug: typeof doc.slug === "string" ? { value: doc.slug, from: "manifest" } : null,
      type: type ? { value: String(type.slug), from: "manifest" } : null,
      excerpt: (doc.excerpt as string) || null,
      seoTitle: (doc.seoTitle as string) ?? null,
      seoDescription: (doc.seoDescription as string) ?? null,
      canonicalUrl: (doc.canonicalUrl as string) ?? null,
      robotsIndex: doc.robotsIndex && doc.robotsIndex !== "default" ? String(doc.robotsIndex) : null,
      sourceStatus: String(doc.status ?? "draft"),
      sourceVisibility: String(doc.visibility ?? "private"),
      createdAt: (doc.createdAt as string) ?? null,
      updatedAt: (doc.updatedAt as string) ?? null,
      publishedAt: (doc.publishedAt as string) ?? null,
      topics: docCats.filter((dc) => dc.documentId === id).map((dc) => ({ value: `pid:${pidOf("topic", dc.categoryId)}`, primary: dc.isPrimary === true, from: "manifest" as ValueFrom })),
      tags: docTags.filter((dt) => dt.documentId === id).map((dt) => ({ value: `pid:${pidOf("tag", dt.tagId)}`, from: "manifest" as ValueFrom })),
      order: null,
      cover: isUuid(doc.featuredMediaId) ? { kind: "site", src: "", mediaId: doc.featuredMediaId } : null,
      properties: (doc.properties as Record<string, unknown>) ?? {},
      relations: relations
        .filter((r) => r.sourceId === id)
        .map((r) => ({ target: { kind: "pid" as const, pid: pidOf("document", r.targetId) }, kind: String(r.kind), note: String(r.note ?? ""), from: "manifest" as ValueFrom })),
      legacyUrls: [],
      aliases: [],
      author: null,
      notes: (doc.notes as string) || null,
      featured: doc.featured === true,
      priority: typeof doc.priority === "number" ? doc.priority : null,
      body: withRefs,
      refs: refs.refs,
      mediaRefs: refs.media,
      unmapped: {},
      issues: docIssues,
      isReadme: false,
    });
  }
  const items = rows("collectionItems");
  const collections = [...new Set(items.map((i) => String(i.collectionId)))].map((cid) => ({
    collectionKey: `pid:${pidOf("document", cid)}`,
    items: items
      .filter((i) => String(i.collectionId) === cid)
      .map((i) => ({ documentKey: `pid:${pidOf("document", i.documentId)}`, position: Number(i.position ?? 0), groupLabel: String(i.groupLabel ?? ""), note: String(i.note ?? "") })),
  }));
  issues.push(issue("info", "manifest.invalid", "This is a database export bundle: media binaries are not included, so images resolve only if this site already has the same media."));
  return {
    sourceSystem: "studio-bundle",
    assumptions: ["Studio JSON export bundle: identity, topics, tags, relations and collections come from the bundle."],
    rootFolder: "",
    documents,
    readmes: [],
    folders: [],
    media: [],
    manifestCollections: collections,
    manifestTopics: rows("categories").map((c) => ({ pid: pidOf("topic", c.id), name: String(c.name), slug: String(c.slug), description: String(c.description ?? ""), parentPid: c.parentId ? pidOf("topic", c.parentId) : null })),
    manifestTags: rows("tags").map((t) => ({ pid: pidOf("tag", t.id), name: String(t.name), slug: String(t.slug), description: String(t.description ?? "") })),
    manifestAssets: [],
    schemaVersion: null,
    issues,
  };
}

function mapIds(doc: Doc, refs: RefTable): Doc {
  const visit = (node: BlockNode): BlockNode => {
    const next: BlockNode = { ...node, content: node.content?.map(visit) };
    if (node.type === "docRef" && isUuid(node.attrs?.documentId)) next.attrs = { ...node.attrs, documentId: refs.doc({ kind: "pid", pid: `studio:document:${node.attrs.documentId}` }) };
    if (node.type === "relatedContent") {
      next.attrs = { ...node.attrs, documentIds: ((node.attrs?.documentIds as string[]) ?? []).map((id) => refs.doc({ kind: "pid", pid: `studio:document:${id}` })) };
    }
    if ((node.type === "image" || node.type === "audio" || node.type === "file") && typeof node.attrs?.src === "string") {
      next.attrs = { ...node.attrs, src: refs.asset({ kind: "site", src: node.attrs.src, mediaId: isUuid(node.attrs.mediaId) ? node.attrs.mediaId : null }) };
    }
    if (node.type === "gallery") {
      next.attrs = {
        ...node.attrs,
        images: ((node.attrs?.images as Array<Record<string, unknown>>) ?? []).map((img) => ({ ...img, src: refs.asset({ kind: "site", src: String(img.src), mediaId: isUuid(img.mediaId) ? (img.mediaId as string) : null }) })),
      };
    }
    if (node.type === "text" && node.marks?.some((m) => m.type === "link" && m.attrs?.href?.startsWith("/") && !m.attrs.href.startsWith("/media/"))) {
      next.marks = node.marks.map((m) => (m.type === "link" && m.attrs?.href?.startsWith("/") && !m.attrs.href.startsWith("/media/") ? { type: "link", attrs: { href: refs.doc({ kind: "site", path: m.attrs.href.split(/[?#]/)[0]! }) } } : m));
    }
    return next;
  };
  return { type: "doc", content: doc.content.map(visit) };
}

