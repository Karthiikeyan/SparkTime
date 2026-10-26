import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/server/seo/discovery";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return (await sitemapEntries()).map((e) => ({ url: e.url, lastModified: e.lastModified, changeFrequency: e.changeFrequency, priority: e.priority }));
}
