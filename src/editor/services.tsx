"use client";

import { createContext, useContext } from "react";
import type { MediaAsset } from "@/lib/media";

/**
 * Capabilities the editor's node views need (upload, document lookup, link
 * previews). Provided by the document editor page; node views read them via
 * React context (Tiptap renders node views inside the EditorContent tree).
 */
export type LookupItem = { id: string; title: string; typeName: string; path: string; status: string; isPublic: boolean };

export type EditorServices = {
  documentId: string;
  upload: (file: File, alt?: string) => Promise<MediaAsset>;
  lookup: (q: string) => Promise<LookupItem[]>;
  linkPreview: (url: string) => Promise<{ url: string; title: string; description: string; siteName: string }>;
  pickMedia: (kind: "image" | "file" | "audio") => Promise<MediaAsset | null>;
  /** Known titles for referenced documents (id → title). */
  titles: Record<string, string>;
};

export const EditorServicesContext = createContext<EditorServices | null>(null);

export function useEditorServices(): EditorServices {
  const ctx = useContext(EditorServicesContext);
  if (!ctx) throw new Error("Editor services missing");
  return ctx;
}
