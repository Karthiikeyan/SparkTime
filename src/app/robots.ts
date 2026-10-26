import type { MetadataRoute } from "next";
import { siteUrl } from "@/server/env";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  // Pre-launch safety: a non-https (local/preview) origin is never indexed.
  if (!base.startsWith("https://")) return { rules: [{ userAgent: "*", disallow: "/" }] };
  // Rules are prefix matches: "/search" alone would also block a topic or page
  // such as /search-engines, so the bare paths end in "$" (Google and Bing honour it).
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin$", "/admin/", "/api/", "/preview/", "/search$", "/search?"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
