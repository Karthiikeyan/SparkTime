import { isValidSlug } from "@/lib/slug";
import { renderOgImage } from "@/server/seo/og";
import { getDocumentByTypeAndSlug, getRootPage } from "@/server/services/public-content";
import { getBrand } from "@/server/services/settings";

/**
 * Social card for a document: /og/{type}/{slug} or /og/{page}.
 * Only ACCESSIBLE documents get a card — private or draft documents 404,
 * so the image route leaks nothing (not even a title).
 */
export const revalidate = 86400;

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!path.length || path.length > 2 || !path.every(isValidSlug)) return new Response("Not found", { status: 404 });
  const brand = await getBrand();
  const doc = path.length === 2 ? await getDocumentByTypeAndSlug(path[0]!, path[1]!) : await getRootPage(path[0]!);
  if (!doc) return new Response("Not found", { status: 404 });
  return renderOgImage({
    title: doc.title,
    eyebrow: [doc.type.name, doc.primaryCategory?.name].filter(Boolean).join("  ·  "),
    brand: brand.name,
    byline: brand.byline,
    footer: doc.readingMinutes > 1 && doc.type.template === "editorial" ? `${doc.readingMinutes} min read` : undefined,
  });
}
