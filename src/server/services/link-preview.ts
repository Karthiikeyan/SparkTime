import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { safeExternalUrl } from "@/lib/url";
import { assertAdmin, type Actor } from "../auth/actor";
import { invalid, ServiceError } from "../errors";

/**
 * Bookmark previews fetch third-party pages on the server — a classic SSRF
 * vector. Defences:
 *  - only http(s) on default ports;
 *  - the IP is validated *at connect time* via a custom DNS lookup, which
 *    defeats DNS-rebinding (the checked address is the connected address);
 *    IP-literal hosts skip DNS entirely, so they are checked before connecting;
 *  - private, loopback, link-local, CGNAT, multicast and reserved ranges
 *    (IPv4 and IPv6, including IPv4-mapped IPv6) are refused;
 *  - redirects are followed manually (max 3), each hop re-validated;
 *  - 5s timeout, 512 KB cap, HTML only. Results are stored in the block, so
 *    public pages never fetch anything.
 */

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inRange(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base!) & mask);
}

const BLOCKED_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) return BLOCKED_V4.some((cidr) => inRange(address, cidr));
  if (net.isIPv6(address)) {
    const a = address.toLowerCase();
    const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a) ?? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isBlockedAddress(mapped[1]!);
    const hextets = a.split(":");
    const first = parseInt(hextets[0] || "0", 16);
    const second = parseInt(hextets[1] || "0", 16);
    // An allowlist, not a blocklist: only global unicast (2000::/3) is public.
    // This one rule refuses ::, ::1, IPv4-compatible and hex-mapped forms,
    // NAT64, unique-local, link-local and multicast.
    if ((first & 0xe000) !== 0x2000) return true;
    if (first === 0x2002) return true; // 6to4: tunnels to an embedded IPv4 address
    if (first === 0x2001 && (second === 0 || second === 0x0db8)) return true; // Teredo, documentation
    return false;
  }
  return true;
}

function safeLookup(
  hostname: string,
  options: { family?: number; all?: boolean },
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
      const blocked = Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }) as NodeJS.ErrnoException;
      return callback(blocked, "", 4);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}

type RawResponse = { status: number; location: string | null; contentType: string; body: string };

function fetchOnce(url: URL): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        lookup: safeLookup as unknown as net.LookupFunction,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KarthikeyanAStudio/1.0; link preview)", Accept: "text/html,application/xhtml+xml" },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location, contentType, body: "" });
        }
        if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          res.resume();
          return resolve({ status, location: null, contentType, body: "" });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("close", () => resolve({ status, location: null, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z#0-9]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

// The page is untrusted. Each `<meta` start scans at most MAX_TAG_LENGTH characters, so a page of
// unterminated "<meta <meta …" cannot make this quadratic (the unbounded `[^>]+` form took seconds on 200 KB).
const MAX_TAG_LENGTH = 2000;
// Quoted values may contain ">" and "<" (legal HTML), so a quote opens a span that is skipped whole. The three
// alternatives start with disjoint characters, so there is nothing ambiguous to backtrack over.
const META_TAG = new RegExp(`<meta\\b(?:[^<>"']|"[^"]{0,${MAX_TAG_LENGTH}}"|'[^']{0,${MAX_TAG_LENGTH}}'){0,${MAX_TAG_LENGTH}}>`, "gi");
const TITLE_TAG = /<title(?:\s[^<>]{0,500})?>([^<]{0,5000})<\/title>/i;
// A name starts at a word boundary and is capped, so a tag made of one long word cannot rescan itself from every offset.
const ATTRIBUTE = /(?<![^\s"'<>/=])([^\s"'<>/=]{1,64})\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function metaTags(html: string): Array<Map<string, string>> {
  const tags: Array<Map<string, string>> = [];
  for (const [tag] of html.matchAll(META_TAG)) {
    const attributes = new Map<string, string>();
    for (const [, name, double, single] of tag.matchAll(ATTRIBUTE)) attributes.set(name!.toLowerCase(), double ?? single ?? "");
    tags.push(attributes);
  }
  return tags;
}

function metaContent(tags: Array<Map<string, string>>, key: string): string {
  for (const tag of tags) {
    const content = tag.get("content");
    if (content && (tag.get("property")?.toLowerCase() === key || tag.get("name")?.toLowerCase() === key)) return decodeEntities(content);
  }
  return "";
}

export type LinkPreview = { url: string; title: string; description: string; siteName: string };

export function parsePreview(html: string, url: string): LinkPreview {
  const head = html.slice(0, 200_000);
  const meta = metaTags(head);
  const title = metaContent(meta, "og:title") || metaContent(meta, "twitter:title") || decodeEntities(TITLE_TAG.exec(head)?.[1] ?? "");
  return {
    url,
    title: title.slice(0, 300),
    description: (metaContent(meta, "og:description") || metaContent(meta, "description")).slice(0, 600),
    siteName: (metaContent(meta, "og:site_name") || new URL(url).hostname.replace(/^www\./, "")).slice(0, 120),
  };
}

export async function fetchLinkPreview(actor: Actor, rawUrl: unknown): Promise<LinkPreview> {
  assertAdmin(actor);
  const safe = safeExternalUrl(rawUrl);
  if (!safe) throw invalid("Enter a full http(s) URL.");
  let url = new URL(safe);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.port && url.port !== "80" && url.port !== "443") throw invalid("Only standard web ports are allowed.");
    // Node connects to an IP-literal host without calling `lookup`, so safeLookup
    // never sees it ("http://127.0.0.1", "http://[::1]", "http://2130706433").
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal) && isBlockedAddress(literal)) throw invalid("That address is not allowed.");
    let res: RawResponse;
    try {
      res = await fetchOnce(url);
    } catch (error) {
      const blocked = (error as NodeJS.ErrnoException)?.code === "EBLOCKED";
      throw new ServiceError("invalid", blocked ? "That address is not allowed." : "Couldn't reach that page.");
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      const next = safeExternalUrl(new URL(res.location, url).toString());
      if (!next) throw invalid("The page redirected somewhere unsupported.");
      url = new URL(next);
      continue;
    }
    if (res.status >= 400) throw invalid(`The page responded with status ${res.status}.`);
    return res.body ? parsePreview(res.body, url.toString()) : { url: url.toString(), title: "", description: "", siteName: url.hostname.replace(/^www\./, "") };
  }
  throw invalid("Too many redirects.");
}
