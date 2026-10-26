import { renderOgImage, OG_SIZE } from "@/server/seo/og";
import { getDocumentByTypeAndSlug } from "@/server/services/public-content";
import { getBrand } from "@/server/services/settings";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Social card";
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

/** Only accessible documents get a card — private/draft ids yield a 404, leaking nothing. */
export default async function Image({ params }: { params: Promise<{ segment: string; slug: string }> }) {
  const { segment, slug } = await params;
  const [doc, brand] = await Promise.all([getDocumentByTypeAndSlug(segment, slug), getBrand()]);
  if (!doc) return new Response("Not found", { status: 404 });
  return renderOgImage({
    title: doc.title,
    eyebrow: [doc.type.name, doc.primaryCategory?.name].filter(Boolean).join("  ·  "),
    brand: brand.name,
    byline: brand.byline,
    footer: doc.readingMinutes > 1 && doc.type.template === "editorial" ? `${doc.readingMinutes} min read` : undefined,
  });
}
