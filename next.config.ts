import type { NextConfig } from "next";
import { GA_CSP, gaMeasurementId } from "./src/lib/analytics";
import { EMBED_FRAME_ORIGINS } from "./src/lib/embeds";
import { RETIRED_PAGED_PATHS, RETIRED_PATHS } from "./src/lib/legacy-paths";

const isDev = process.env.NODE_ENV === "development";
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const isHttps = siteUrl.startsWith("https://");

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const mediaOrigin = originOf(process.env.R2_PUBLIC_URL);
// GA4's origins are allowed only when a measurement id is configured (docs/ANALYTICS.md).
const ga = gaMeasurementId(process.env.NEXT_PUBLIC_GA_ID) ? GA_CSP : { script: [], connect: [], img: [] };
const extra = (origins: string[]) => origins.map((o) => ` ${o}`).join("");

/**
 * Public-site CSP. Public pages are statically generated (ISR), so a
 * per-request nonce is impossible; inline scripts from Next's RSC payload
 * require 'unsafe-inline'. XSS defence therefore rests on: no raw HTML
 * rendering anywhere, sanitised block JSON, validated URLs. Everything
 * else is locked down. The admin gets a strict nonce-based policy in proxy.ts.
 */
const publicCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${extra(ga.script)}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://i.ytimg.com${mediaOrigin ? ` ${mediaOrigin}` : ""}${extra(ga.img)}`,
  `media-src 'self'${mediaOrigin ? ` ${mediaOrigin}` : ""}`,
  "font-src 'self'",
  `connect-src 'self'${extra(ga.connect)}${isDev ? " ws: wss:" : ""}`,
  `frame-src ${EMBED_FRAME_ORIGINS.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  ...(isHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const commonHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  ...(isHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: { position: "bottom-right" },
  // Images are resized once at upload (Sharp → R2); no runtime optimisation bill.
  images: { unoptimized: true },
  serverExternalPackages: ["sharp"],
  // Cap build parallelism so multiple workers don't exhaust the Supabase
  // Transaction Pooler connection limit. Local builds set BUILD_WORKERS=1
  // (PGlite accepts one connection). Production defaults to 1 as well;
  // raise it only if you're on a paid Supabase plan with a higher pool limit.
  // Vercel renders pages in Washington while the database is in Singapore (~220 ms per query, ~20 queries a
  // page). Next's defaults (8 pages at once, 60 s each) make pages queue behind each other's queries and time
  // out, so render fewer at a time and allow each longer. Nothing here affects what visitors receive.
  staticPageGenerationTimeout: 240,
  ...(Number(process.env.BUILD_WORKERS) > 0
    ? { experimental: { cpus: Number(process.env.BUILD_WORKERS), staticGenerationMaxConcurrency: 2 } }
    : { experimental: { cpus: 1, staticGenerationMaxConcurrency: 2 } }),
  async redirects() {
    return [
      ...RETIRED_PATHS.map((r) => ({ source: r.from, destination: r.to, permanent: true })),
      // Page n of the old Writing stream and article index is page n of the Library.
      ...RETIRED_PAGED_PATHS.map((r) => ({ source: `${r.from}/page/:n(\\d+)`, destination: `${r.to}/page/:n`, permanent: true })),
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: commonHeaders },
      // The studio gets its own nonce policy from proxy.ts. Exclude only /admin and /api/admin themselves:
      // a bare prefix like (?!admin) would also skip public paths such as /administration.
      { source: "/((?!admin(?:/|$)|api/admin(?:/|$)).*)", headers: [{ key: "Content-Security-Policy", value: publicCsp }] },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/preview/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "private, no-store" }] },
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
