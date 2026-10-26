/**
 * File layout helpers for exports: deterministic, collision-free package
 * paths and Markdown bodies whose links and images point at files inside
 * the package (relative paths), so an extracted export works without this
 * site.
 */
import type { BlockNode, Doc, Mark } from "../content/blocks";
import { slugify } from "../slug";
import { dirname } from "./paths";

/** Relative path from one package file to another ("content/article/a.md" → "../guide/b.md"). */
export function relativePath(fromFile: string, toFile: string): string {
  const from = dirname(fromFile).split("/").filter(Boolean);
  const to = toFile.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.length - i;
  return [...Array(up).fill(".."), ...to.slice(i)].map(encodeURIComponent).join("/");
}

/** "Holiday photo.JPG" + id + stored key "media/…/id.webp" → "holiday-photo-1a2b3c4d.webp". */
export function assetFileName(originalName: string, id: string, storageKey: string): string {
  const ext = storageKey.slice(storageKey.lastIndexOf(".") + 1).toLowerCase() || "bin";
  const stemName = originalName.replace(/\.[^.]+$/, "");
  return `${slugify(stemName, "file").slice(0, 60)}-${id.slice(0, 8)}.${ext}`;
}

export type MarkdownRefs = {
  /** A site path (/type/slug) or document id → href to write (relative file path or absolute URL), or null to unlink. */
  docHref(target: { id?: string; path?: string }): string | null;
  /** A media id or URL → relative file path, or null to keep the original URL. */
  mediaHref(mediaId: string | null, src: string): string | null;
  /** A site path of a document that must not be linked (non-public, in a published-only export). */
  isHidden?(path: string): boolean;
};

function mapNodes(nodes: BlockNode[] | undefined, fn: (n: BlockNode) => BlockNode): BlockNode[] | undefined {
  return nodes?.map((n) => fn({ ...n, content: mapNodes(n.content, fn) }));
}

/** Rewrites links/images for a Markdown file in the package. The result is only ever serialised to Markdown. */
export function rewriteForMarkdown(doc: Doc, refs: MarkdownRefs, siteOrigin: string): Doc {
  const href = (value: string): string | null => {
    const path = value.startsWith("/") && !value.startsWith("//") ? value : value.startsWith(siteOrigin + "/") ? value.slice(siteOrigin.length) : null;
    if (path === null) return value;
    const clean = path.split(/[?#]/)[0]!;
    if (clean.startsWith("/media/")) return refs.mediaHref(null, clean) ?? value;
    if (refs.isHidden?.(clean)) return null;
    return refs.docHref({ path: clean }) ?? siteOrigin + path;
  };
  const content = mapNodes(doc.content, (node) => {
    if (node.type === "text" && node.marks?.length) {
      // A link to a hidden document is dropped (its text stays).
      const marks = node.marks.flatMap((m): Mark[] => {
        if (m.type !== "link" || !m.attrs?.href) return [m];
        const next = href(m.attrs.href);
        return next ? [{ type: "link", attrs: { href: next } }] : [];
      });
      const { marks: _old, ...rest } = node;
      void _old;
      return marks.length ? { ...rest, marks } : rest;
    }
    const attrs = node.attrs ?? {};
    if (node.type === "image" || node.type === "audio" || node.type === "file") {
      const local = refs.mediaHref((attrs.mediaId as string | null) ?? null, String(attrs.src ?? ""));
      return local ? { ...node, attrs: { ...attrs, src: local } } : node;
    }
    if (node.type === "gallery") {
      const images = ((attrs.images as Array<Record<string, unknown>>) ?? []).map((img) => {
        const local = refs.mediaHref((img.mediaId as string | null) ?? null, String(img.src ?? ""));
        return local ? { ...img, src: local } : img;
      });
      return { ...node, attrs: { ...attrs, images } };
    }
    return node;
  });
  return { type: "doc", content: content ?? [] };
}
