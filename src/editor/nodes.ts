"use client";

import { Extension, mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import {
  BookmarkView,
  ButtonView,
  CalloutView,
  EmbedView,
  FileView,
  GalleryView,
  ImageView,
  RelatedContentView,
  ToolView,
  YouTubeView,
} from "./node-views";

/**
 * Custom block nodes. Names and attributes mirror the server allowlist in
 * src/lib/content/blocks.ts exactly; anything else would be stripped on save.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    studioBlocks: {
      insertBlock: (type: string, attrs?: Record<string, unknown>) => ReturnType;
      setCallout: (variant?: string) => ReturnType;
      insertColumns: (count: 2 | 3) => ReturnType;
    };
  }
}

const atomBlock = (name: string, attrs: Record<string, unknown>, view: Parameters<typeof ReactNodeViewRenderer>[0]) =>
  Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, { default: value }]));
    },
    parseHTML() {
      return [{ tag: `div[data-block="${name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-block": name })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(view);
    },
  });

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: "note",
        parseHTML: (el) => el.getAttribute("data-callout") || "note",
        renderHTML: (attrs) => ({ "data-callout": attrs.variant }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "aside[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["aside", mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
  addCommands() {
    return {
      setCallout:
        (variant = "note") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { variant }),
    };
  },
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "column", class: "editor-column" }), 0];
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  isolating: true,
  defining: true,
  addAttributes() {
    return {
      layout: {
        default: "equal",
        parseHTML: (el) => el.getAttribute("data-layout") || "equal",
        renderHTML: (attrs) => ({ "data-layout": attrs.layout }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "columns", "data-cols": node.childCount, class: "editor-columns" }), 0];
  },
  addCommands() {
    return {
      insertColumns:
        (count) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: Array.from({ length: count }, () => ({ type: "column", content: [{ type: "paragraph" }] })),
          }),
    };
  },
});

// `uploading`/`uploadId` are client-only (placeholder while a pasted image uploads); the server strips them.
export const ImageBlock = atomBlock("image", { src: "", mediaId: null, alt: "", caption: "", width: null, height: null, size: "content", uploading: false, uploadId: null }, ImageView).extend({
  parseHTML() {
    return [
      { tag: 'div[data-block="image"]' },
      {
        tag: "img[src]",
        getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute("src"), alt: (el as HTMLElement).getAttribute("alt") ?? "" }),
      },
    ];
  },
});
export const Gallery = atomBlock("gallery", { images: [], columns: 3, caption: "" }, GalleryView);
export const YouTube = atomBlock("youtube", { videoId: "", start: 0, title: "", caption: "" }, YouTubeView);
export const Embed = atomBlock("embed", { provider: "", embedId: "", title: "", caption: "" }, EmbedView);
export const Audio = atomBlock("audio", { src: "", mediaId: null, title: "", caption: "" }, FileView);
export const FileBlock = atomBlock("file", { src: "", mediaId: null, name: "", size: null, mimeType: "" }, FileView);
export const BookmarkBlock = atomBlock("bookmark", { url: "", title: "", description: "", siteName: "" }, BookmarkView);
export const ButtonBlock = atomBlock("button", { label: "Learn more", href: "", variant: "primary" }, ButtonView);
export const RelatedContent = atomBlock("relatedContent", { documentIds: [], title: "Related", labels: {} }, RelatedContentView);
export const Tool = atomBlock("tool", { kind: "fire-number" }, ToolView);

/** Inline reference to another document, created with "@". */
export const DocRef = Node.create({
  name: "docRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      documentId: { default: null, parseHTML: (el) => el.getAttribute("data-document-id") },
      label: { default: "", parseHTML: (el) => el.textContent ?? "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-doc-ref]" }];
  },
  renderHTML({ node }) {
    return ["span", { "data-doc-ref": "", "data-document-id": node.attrs.documentId, class: "doc-ref-chip" }, `↗ ${node.attrs.label}`];
  },
  renderText({ node }) {
    return String(node.attrs.label ?? "");
  },
});

/** Generic insert + a helper used by the slash menu. */
export const BlockCommands = Extension.create({
  name: "studioBlockCommands",
  addCommands() {
    return {
      insertBlock:
        (type, attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type, attrs }),
    };
  },
});

export const CUSTOM_NODES = [Callout, Columns, Column, ImageBlock, Gallery, YouTube, Embed, Audio, FileBlock, BookmarkBlock, ButtonBlock, RelatedContent, Tool, DocRef, BlockCommands];
