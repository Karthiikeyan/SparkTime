/**
 * References inside block documents, in both directions.
 *
 * Import: parsers store unresolved references as placeholders —
 *   link mark href      "ref:<i>" (document) | "asset-ref:<i>" (media URL)
 *   docRef.documentId   "ref:<i>"
 *   relatedContent ids  ["ref:<i>", …]
 *   image/audio/file    src "asset-ref:<i>"; gallery images[].src likewise
 * and resolvePlaceholders() swaps them for real ids/paths/URLs once the
 * plan knows them. Unresolved images become an "[ADD IMAGE: …]" paragraph,
 * which the publish check (hasPlaceholderContent) refuses to publish.
 *
 * Export: toPortableDoc() rewrites database ids and site URLs into portable
 * references ("pid:<id>", "asset:<id>"), and portableToPlaceholders() turns
 * them back into placeholders on the way in.
 */
import type { BlockNode, Doc, Mark } from "../content/blocks";
import { MEDIA_PREFIX, REF_PREFIX, type DocTarget, type MediaTarget } from "./model";

function mapDoc(doc: Doc, visit: (node: BlockNode) => BlockNode | BlockNode[] | null): Doc {
  const walk = (nodes: BlockNode[] | undefined): BlockNode[] | undefined => {
    if (!nodes) return nodes;
    const out: BlockNode[] = [];
    for (const node of nodes) {
      const mapped = visit({ ...node, content: walk(node.content) });
      if (mapped === null) continue;
      if (Array.isArray(mapped)) out.push(...mapped);
      else out.push(mapped);
    }
    return out;
  };
  return { type: "doc", content: walk(doc.content) ?? [] };
}

function mapLinks(node: BlockNode, fn: (href: string) => string | null): BlockNode {
  if (node.type !== "text" || !node.marks?.length) return node;
  const marks: Mark[] = [];
  for (const mark of node.marks) {
    if (mark.type !== "link" || !mark.attrs?.href) {
      marks.push(mark);
      continue;
    }
    const href = fn(mark.attrs.href);
    if (href) marks.push({ type: "link", attrs: { href } });
  }
  const next = { ...node };
  if (marks.length) next.marks = marks;
  else delete next.marks;
  return next;
}

const MEDIA_NODES = new Set(["image", "audio", "file"]);

export function placeholderIndex(value: unknown, prefix: string): number | null {
  if (typeof value !== "string" || !value.startsWith(prefix)) return null;
  const n = Number(value.slice(prefix.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Import: placeholders → destination values
// ---------------------------------------------------------------------------

export type ResolvedDoc = { id: string; path: string } | null;
export type ResolvedMedia = { src: string; mediaId: string | null } | null;

export type PlaceholderResolver = {
  doc(index: number): ResolvedDoc;
  media(index: number): ResolvedMedia;
  /** Human description of an unresolved media reference ("assets/a.png"). */
  describeMedia(index: number): string;
};

export function resolvePlaceholders(doc: Doc, resolver: PlaceholderResolver): Doc {
  return mapDoc(doc, (node) => {
    if (node.type === "text") {
      return mapLinks(node, (href) => {
        const di = placeholderIndex(href, REF_PREFIX);
        if (di !== null) return resolver.doc(di)?.path ?? null;
        const mi = placeholderIndex(href, MEDIA_PREFIX);
        if (mi !== null) return resolver.media(mi)?.src ?? null;
        return href;
      });
    }
    if (node.type === "docRef") {
      const di = placeholderIndex(node.attrs?.documentId, REF_PREFIX);
      if (di === null) return node;
      const target = resolver.doc(di);
      const label = String(node.attrs?.label ?? "");
      if (target) return { ...node, attrs: { ...node.attrs, documentId: target.id } };
      return label ? { type: "text", text: label } : null;
    }
    if (node.type === "relatedContent") {
      const ids = ((node.attrs?.documentIds as unknown[]) ?? []).map((id) => {
        const di = placeholderIndex(id, REF_PREFIX);
        return di === null ? id : (resolver.doc(di)?.id ?? null);
      });
      return { ...node, attrs: { ...node.attrs, documentIds: ids.filter((id): id is string => typeof id === "string") } };
    }
    if (MEDIA_NODES.has(node.type)) {
      const mi = placeholderIndex(node.attrs?.src, MEDIA_PREFIX);
      if (mi === null) return node;
      const media = resolver.media(mi);
      if (media) return { ...node, attrs: { ...node.attrs, src: media.src, mediaId: media.mediaId } };
      return missingMediaParagraph(resolver.describeMedia(mi), String(node.attrs?.alt ?? node.attrs?.name ?? node.attrs?.title ?? ""), node.type === "image" ? "image" : "file");
    }
    if (node.type === "gallery") {
      const images = ((node.attrs?.images as Array<Record<string, unknown>>) ?? []).flatMap((img) => {
        const mi = placeholderIndex(img.src, MEDIA_PREFIX);
        if (mi === null) return [img];
        const media = resolver.media(mi);
        return media ? [{ ...img, src: media.src, mediaId: media.mediaId }] : [];
      });
      return images.length ? { ...node, attrs: { ...node.attrs, images } } : null;
    }
    return node;
  });
}

/**
 * Visible stand-in for media that could not be imported. The bracketed
 * prefix is one the publish check refuses (lib/content/derive.ts), so a
 * document can't go live with a hole in it.
 */
export function missingMediaParagraph(description: string, alt: string, kind: "image" | "file" = "image"): BlockNode {
  const label = alt ? ` "${alt}"` : "";
  const prefix = kind === "image" ? "ADD IMAGE" : "TODO";
  return { type: "paragraph", content: [{ type: "text", text: `[${prefix}: missing from import${label} — ${description}]` }] };
}

/** Every placeholder index used in a document (for planning and verification). */
export function collectPlaceholders(doc: Doc): { refs: Set<number>; media: Set<number> } {
  const refs = new Set<number>();
  const media = new Set<number>();
  const visit = (node: BlockNode) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== "link") continue;
      const di = placeholderIndex(mark.attrs?.href, REF_PREFIX);
      if (di !== null) refs.add(di);
      const mi = placeholderIndex(mark.attrs?.href, MEDIA_PREFIX);
      if (mi !== null) media.add(mi);
    }
    const di = placeholderIndex(node.attrs?.documentId, REF_PREFIX);
    if (di !== null) refs.add(di);
    for (const id of (node.attrs?.documentIds as unknown[]) ?? []) {
      const i = placeholderIndex(id, REF_PREFIX);
      if (i !== null) refs.add(i);
    }
    const mi = placeholderIndex(node.attrs?.src, MEDIA_PREFIX);
    if (mi !== null) media.add(mi);
    for (const img of (node.attrs?.images as Array<{ src?: unknown }>) ?? []) {
      const i = placeholderIndex(img.src, MEDIA_PREFIX);
      if (i !== null) media.add(i);
    }
    node.content?.forEach(visit);
  };
  doc.content.forEach(visit);
  return { refs, media };
}

// ---------------------------------------------------------------------------
// Portable references ("pid:", "asset:") ⇄ placeholders
// ---------------------------------------------------------------------------

export const PID_SCHEME = "pid:";
export const ASSET_SCHEME = "asset:";

/** Parses a portable `.doc.json` body into a placeholder document plus its reference tables. */
export function portableToPlaceholders(doc: Doc): { doc: Doc; refs: DocTarget[]; mediaRefs: MediaTarget[] } {
  const refs: DocTarget[] = [];
  const mediaRefs: MediaTarget[] = [];
  const refFor = (pid: string) => {
    const existing = refs.findIndex((r) => r.kind === "pid" && r.pid === pid);
    if (existing !== -1) return `${REF_PREFIX}${existing}`;
    refs.push({ kind: "pid", pid });
    return `${REF_PREFIX}${refs.length - 1}`;
  };
  const mediaFor = (pid: string) => {
    const existing = mediaRefs.findIndex((r) => r.kind === "asset" && r.pid === pid);
    if (existing !== -1) return `${MEDIA_PREFIX}${existing}`;
    mediaRefs.push({ kind: "asset", pid });
    return `${MEDIA_PREFIX}${mediaRefs.length - 1}`;
  };
  const convertHref = (href: string): string | null => {
    if (href.startsWith(PID_SCHEME)) return refFor(href.slice(PID_SCHEME.length));
    if (href.startsWith(ASSET_SCHEME)) return mediaFor(href.slice(ASSET_SCHEME.length));
    return href;
  };
  const out = mapDoc(doc, (node) => {
    if (node.type === "text") return mapLinks(node, convertHref);
    const attrs = node.attrs ?? {};
    if (node.type === "docRef" && typeof attrs.documentId === "string" && attrs.documentId.startsWith(PID_SCHEME)) {
      return { ...node, attrs: { ...attrs, documentId: refFor(attrs.documentId.slice(PID_SCHEME.length)) } };
    }
    if (node.type === "relatedContent") {
      const ids = ((attrs.documentIds as unknown[]) ?? []).map((id) => (typeof id === "string" && id.startsWith(PID_SCHEME) ? refFor(id.slice(PID_SCHEME.length)) : id));
      return { ...node, attrs: { ...attrs, documentIds: ids } };
    }
    if (MEDIA_NODES.has(node.type) && typeof attrs.src === "string" && attrs.src.startsWith(ASSET_SCHEME)) {
      return { ...node, attrs: { ...attrs, src: mediaFor(attrs.src.slice(ASSET_SCHEME.length)), mediaId: null } };
    }
    if (node.type === "gallery") {
      const images = ((attrs.images as Array<Record<string, unknown>>) ?? []).map((img) =>
        typeof img.src === "string" && img.src.startsWith(ASSET_SCHEME) ? { ...img, src: mediaFor(img.src.slice(ASSET_SCHEME.length)), mediaId: null } : img,
      );
      return { ...node, attrs: { ...attrs, images } };
    }
    return node;
  });
  return { doc: out, refs, mediaRefs };
}

export type PortableRefMaps = {
  /** Destination document id → portable id, for documents included in the export. */
  docPid(id: string): string | null;
  /** Site path (/type/slug or /slug) → document id, for internal links. */
  docIdForPath(path: string): string | null;
  /** Media id (or object key found in a URL) → asset pid. */
  assetPid(mediaId: string | null, src: string): string | null;
  /** Records a reference to something outside the export. */
  excluded(kind: string, target: string): void;
  /** Documents that must not be linked from this export at all (non-public, in a published-only export). */
  hidden?(id: string): boolean;
};

/** Rewrites a stored document into portable form for `.doc.json`. */
export function toPortableDoc(doc: Doc, maps: PortableRefMaps, siteOrigin: string): Doc {
  const linkHref = (href: string): string | null => {
    const path = href.startsWith("/") && !href.startsWith("//") ? href : href.startsWith(siteOrigin + "/") ? href.slice(siteOrigin.length) : null;
    if (path === null) return href;
    const clean = path.split(/[?#]/)[0]!;
    if (clean.startsWith("/media/")) {
      const pid = maps.assetPid(null, clean);
      return pid ? `${ASSET_SCHEME}${pid}` : href;
    }
    const id = maps.docIdForPath(clean);
    if (id && maps.hidden?.(id)) {
      maps.excluded("link", id);
      return null;
    }
    const pid = id ? maps.docPid(id) : null;
    if (pid) return `${PID_SCHEME}${pid}`;
    if (id) maps.excluded("link", id);
    // Keep links to excluded or unknown pages working as absolute URLs.
    return href.startsWith("/") ? siteOrigin + href : href;
  };
  return mapDoc(doc, (node) => {
    if (node.type === "text") return mapLinks(node, linkHref);
    const attrs = node.attrs ?? {};
    if (node.type === "docRef") {
      const pid = maps.docPid(String(attrs.documentId));
      if (pid) return { ...node, attrs: { ...attrs, documentId: `${PID_SCHEME}${pid}` } };
      maps.excluded("mention", String(attrs.documentId));
      return attrs.label ? { type: "text", text: String(attrs.label) } : null;
    }
    if (node.type === "relatedContent") {
      const ids = ((attrs.documentIds as string[]) ?? []).flatMap((id) => {
        const pid = maps.docPid(id);
        if (pid) return [`${PID_SCHEME}${pid}`];
        maps.excluded("related-block", id);
        return [];
      });
      return { ...node, attrs: { ...attrs, documentIds: ids } };
    }
    if (MEDIA_NODES.has(node.type)) {
      const pid = maps.assetPid((attrs.mediaId as string | null) ?? null, String(attrs.src ?? ""));
      if (pid) return { ...node, attrs: { ...attrs, src: `${ASSET_SCHEME}${pid}`, mediaId: null } };
      maps.excluded("media", String(attrs.mediaId ?? attrs.src ?? ""));
      return node;
    }
    if (node.type === "gallery") {
      const images = ((attrs.images as Array<Record<string, unknown>>) ?? []).map((img) => {
        const pid = maps.assetPid((img.mediaId as string | null) ?? null, String(img.src ?? ""));
        if (pid) return { ...img, src: `${ASSET_SCHEME}${pid}`, mediaId: null };
        maps.excluded("media", String(img.mediaId ?? img.src ?? ""));
        return img;
      });
      return { ...node, attrs: { ...attrs, images } };
    }
    return node;
  });
}
