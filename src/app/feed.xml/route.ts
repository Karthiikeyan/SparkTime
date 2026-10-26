import { siteUrl } from "@/server/env";
import { feedItems, renderRss } from "@/server/seo/discovery";
import { getBrand, loadAllSettings } from "@/server/services/settings";

export const revalidate = 3600;

export async function GET() {
  const [settings, brand] = await Promise.all([loadAllSettings(), getBrand()]);
  if (!settings.features.rss) return new Response("Not found", { status: 404 });
  const xml = renderRss({
    title: brand.name,
    description: brand.description,
    siteUrl: siteUrl(),
    items: await feedItems(),
  });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600" } });
}
