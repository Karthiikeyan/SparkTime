// Read-only crawl of the public site: status codes, redirects, broken internal links,
// sitemap coverage, canonicals, robots, titles, descriptions, headings and JSON-LD.
//
//   npm run audit:site                                  # production (NEXT_PUBLIC_SITE_URL or the live site)
//   npm run audit:site -- http://localhost:3100         # a local production build
//   npm run audit:site -- https://example.com 500       # cap the number of pages
//
// It only sends GET requests (6 at a time) and never signs in. Output: a short report,
// plus the full per-URL data in .data/site-audit.json (git-ignored).
import fs from "node:fs";

const origin = (process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://iamkarthikeyan.vercel.app").replace(/\/+$/, "");
const MAX = Number(process.argv[3] ?? 3000);
const CONCURRENCY = 6;

const pages = new Map(); // path -> record (null while queued)
const queue = [];
const inlinks = new Map(); // path -> Set(from)

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const attr = (tag, name) => decode(tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "");

function internalPath(href, base) {
  try {
    const u = new URL(href, base);
    if (u.origin !== origin || /^\/(_next|media|og|api|admin|preview)\b/.test(u.pathname)) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

function enqueue(path, from) {
  if (!path) return;
  if (from) (inlinks.get(path) ?? inlinks.set(path, new Set()).get(path)).add(from);
  if (pages.has(path) || pages.size >= MAX) return;
  pages.set(path, null);
  queue.push(path);
}

async function fetchPage(path) {
  const chain = [];
  let url = origin + path;
  for (let hop = 0; hop < 6; hop++) {
    const started = Date.now();
    const res = await fetch(url, { redirect: "manual", headers: { "user-agent": "site-audit/1.0 (owner self-check)" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      chain.push(`${res.status} → ${res.headers.get("location")}`);
      url = new URL(res.headers.get("location"), url).toString();
      continue;
    }
    const html = (res.headers.get("content-type") ?? "").includes("html") ? await res.text() : "";
    return { status: res.status, chain, ms: Date.now() - started, html };
  }
  return { status: "redirect loop", chain, ms: 0, html: "" };
}

function analyse(path, { status, chain, ms, html }) {
  const rec = { path, status, chain, ms };
  if (!html) return rec;
  const head = html.slice(0, html.indexOf("</head>") + 1 || 60_000);
  const metas = [...head.matchAll(/<meta [^>]*>/g)].map((m) => m[0]);
  const meta = (k) => attr(metas.find((m) => m.includes(`name="${k}"`) || m.includes(`property="${k}"`)) ?? "", "content") || null;
  rec.title = decode(head.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
  rec.description = meta("description");
  rec.robots = meta("robots");
  rec.canonical = head.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null;
  rec.ogImage = meta("og:image");
  const body = html.slice(html.indexOf("<body"));
  const headings = [...body.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => Number(m[1]));
  rec.h1 = headings.filter((l) => l === 1).length;
  rec.headingSkips = headings.filter((l, i) => i > 0 && l > headings[i - 1] + 1).length;
  rec.jsonLdTypes = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]);
      for (const node of data["@graph"] ?? [data]) rec.jsonLdTypes.push([].concat(node["@type"]).join("/"));
    } catch {
      rec.jsonLdError = true;
    }
  }
  const text = body.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
  // "Lorem ipsum dolor", not "lorem ipsum": an article may well advise against lorem ipsum.
  rec.placeholder = /\[TODO\]|lorem ipsum dolor/i.test(text);
  for (const m of body.matchAll(/<a [^>]*href="([^"]*)"/g)) enqueue(internalPath(decode(m[1]), origin + path)?.split("#")[0], path);
  return rec;
}

async function worker() {
  while (queue.length) {
    const path = queue.shift();
    try {
      pages.set(path, analyse(path, await fetchPage(path)));
    } catch (error) {
      pages.set(path, { path, status: "error", error: String(error) });
    }
  }
}

const sitemapXml = await (await fetch(`${origin}/sitemap.xml`)).text();
const sitemap = [...sitemapXml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
for (const path of ["/", ...sitemap]) enqueue(path);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const recs = [...pages.values()].filter(Boolean);
for (const r of recs) r.inlinks = inlinks.get(r.path)?.size ?? 0;
const ok = recs.filter((r) => r.status === 200 && r.title !== undefined);
const inSitemap = new Set(sitemap);
const self = (r) => origin + (r.path === "/" ? "" : r.path);
const list = (label, items) => {
  console.log(`\n${label}: ${items.length}`);
  for (const line of items.slice(0, 25)) console.log(`  ${line}`);
  if (items.length > 25) console.log(`  … and ${items.length - 25} more (see .data/site-audit.json)`);
};
const linkedFrom = (path) => recs.filter((r) => inlinks.get(path)?.has(r.path)).map((r) => r.path).slice(0, 3).join(", ");

console.log(`Site audit of ${origin} — ${recs.length} pages crawled, ${sitemap.length} in the sitemap`);
list("Broken internal links (4xx/5xx reached by a link)", recs.filter((r) => r.status !== 200 && !r.chain?.length && r.inlinks > 0).map((r) => `${r.status} ${r.path}  ← ${linkedFrom(r.path)}`));
list("Internal links that go through a redirect", recs.filter((r) => r.chain?.length && r.inlinks > 0).map((r) => `${r.path} ${r.chain.join(" ")}  (${r.inlinks} pages link here)`));
list("Sitemap URLs that don't answer 200", sitemap.filter((p) => pages.get(p)?.status !== 200).map((p) => `${pages.get(p)?.status} ${p}`));
list("Sitemap URLs marked noindex", ok.filter((r) => inSitemap.has(r.path) && /noindex/.test(r.robots ?? "")).map((r) => r.path));
list("Canonical points elsewhere", ok.filter((r) => !r.chain?.length && r.canonical && r.canonical !== self(r) && !r.path.includes("?")).map((r) => `${r.path} → ${r.canonical}`));
list("Pages without exactly one h1", ok.filter((r) => r.h1 !== 1).map((r) => `${r.h1}× ${r.path}`));
list("Pages that skip a heading level", ok.filter((r) => r.headingSkips).map((r) => r.path));
list("Visible placeholders ([TODO], lorem ipsum dolor)", ok.filter((r) => r.placeholder).map((r) => r.path));
list("Unparseable JSON-LD", ok.filter((r) => r.jsonLdError).map((r) => r.path));
const dupes = (key) => Object.entries(Object.groupBy(ok.filter((r) => !r.chain?.length && !/\/page\/\d+$/.test(r.path) && !r.path.includes("?")), (r) => r[key] ?? "")).filter(([, v]) => v.length > 1);
list("Duplicate titles (first pages only)", dupes("title").map(([t, v]) => `"${t}": ${v.map((r) => r.path).join(", ")}`));
list("Duplicate descriptions (first pages only)", dupes("description").map(([t, v]) => `"${t.slice(0, 70)}…": ${v.map((r) => r.path).join(", ")}`));
const times = ok.map((r) => r.ms).sort((a, b) => a - b);
console.log(`\nResponse time (time to full HTML): median ${times[times.length >> 1]} ms, 90th percentile ${times[Math.floor(times.length * 0.9)]} ms`);

fs.mkdirSync(".data", { recursive: true });
fs.writeFileSync(".data/site-audit.json", JSON.stringify({ origin, crawledAt: new Date().toISOString(), sitemap, pages: recs }, null, 1));
