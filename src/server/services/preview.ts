import "server-only";
import { eq } from "drizzle-orm";
import { autoExcerpt, deriveContent } from "@/lib/content/derive";
import { sanitizeDoc } from "@/lib/content/blocks";
import type { Properties } from "@/lib/content/properties";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb } from "../db/client";
import { documents } from "../db/schema";
import { getMediaAssets } from "./media";
import { loadDocumentUnfilteredForPreview, type PublicDocument } from "./public-content";

/** The document as it WILL look: staged edits (working copy) applied. Admin only. */
export async function buildPreviewDocument(actor: Actor, id: string): Promise<PublicDocument | null> {
  assertAdmin(actor);
  const base = await loadDocumentUnfilteredForPreview(id);
  if (!base) return null;
  const [row] = await getDb().select({ workingCopy: documents.workingCopy }).from(documents).where(eq(documents.id, id)).limit(1);
  const copy = row?.workingCopy as { title?: string; excerpt?: string; content?: unknown; properties?: Properties; featuredMediaId?: string | null } | null;
  if (!copy) return base;
  const content = sanitizeDoc(copy.content);
  const derived = deriveContent(content);
  const image = copy.featuredMediaId ? (await getMediaAssets([copy.featuredMediaId])).get(copy.featuredMediaId) ?? null : base.image;
  return {
    ...base,
    title: copy.title ?? base.title,
    excerpt: copy.excerpt || autoExcerpt(derived.plainText),
    content,
    properties: copy.properties ?? base.properties,
    image,
    readingMinutes: derived.readingMinutes,
    wordCount: derived.wordCount,
  };
}
