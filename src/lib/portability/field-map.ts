/**
 * The single place where source metadata keys are recognised. Front matter,
 * Notion property lines and README metadata all pass through
 * mapSourceMetadata(); nothing else knows aliases such as `summary` or
 * `redirect_from`.
 *
 * Output is still destination-agnostic: keys this table doesn't recognise
 * become property *candidates*, which the planner matches against the
 * destination type's real fields. Anything left after that is preserved as
 * unmapped metadata — never silently dropped.
 */
import { issue, type Issue } from "./model";

type Canonical =
  | "pid" | "title" | "slug" | "type" | "excerpt" | "description" | "seoTitle" | "seoDescription" | "canonicalUrl" | "robots"
  | "status" | "draft" | "published" | "visibility" | "publishedAt" | "updatedAt" | "createdAt" | "tags" | "topics" | "author"
  | "cover" | "order" | "aliases" | "legacyUrls" | "related" | "collection" | "featured" | "priority" | "notes" | "import";

const ALIASES: Record<Canonical, string[]> = {
  pid: ["pid", "portableid", "uid", "uuid", "id"],
  title: ["title", "name"],
  slug: ["slug"],
  type: ["type", "contenttype", "kind"],
  excerpt: ["excerpt", "summary", "abstract", "subtitle", "lede", "dek"],
  description: ["description"],
  seoTitle: ["seotitle", "metatitle"],
  seoDescription: ["seodescription", "metadescription"],
  canonicalUrl: ["canonical", "canonicalurl"],
  robots: ["robots", "robotsindex"],
  status: ["status"],
  draft: ["draft"],
  published: ["published"],
  visibility: ["visibility"],
  publishedAt: ["date", "publishedat", "pubdate", "publishdate", "datepublished", "publishedon"],
  updatedAt: ["updated", "updatedat", "lastmod", "lastmodified", "modified", "datemodified", "lastedited", "lastupdated"],
  createdAt: ["created", "createdat", "datecreated", "createdtime"],
  tags: ["tags", "tag", "keywords"],
  topics: ["categories", "category", "topics", "topic"],
  author: ["author", "authors", "by", "createdby"],
  cover: ["cover", "coverimage", "image", "featuredimage", "thumbnail", "banner", "hero", "ogimage"],
  order: ["order", "position", "weight", "sequence", "navorder", "sortorder", "sort"],
  aliases: ["aliases", "alias"],
  legacyUrls: ["redirectfrom", "legacyurl", "legacyurls", "oldurl", "oldurls", "permalink"],
  related: ["related", "relatedposts", "seealso"],
  collection: ["collection", "series"],
  featured: ["featured"],
  priority: ["priority"],
  notes: ["notes", "editornotes"],
  import: ["import"],
};

const KEY_TO_CANONICAL = new Map<string, Canonical>();
for (const [canonical, keys] of Object.entries(ALIASES) as Array<[Canonical, string[]]>) {
  for (const key of keys) KEY_TO_CANONICAL.set(key, canonical);
}

/** "SEO Title", "seo_title", "seo-title", "seoTitle" → "seotitle". */
export function normalizeKey(key: string): string {
  return key.normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, "");
}

export function canonicalKey(key: string): Canonical | null {
  return KEY_TO_CANONICAL.get(normalizeKey(key)) ?? null;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function str(value: unknown, max = 2000): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Lists from YAML arrays, comma-separated strings or single values. */
export function list(value: unknown, max = 50): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\n]/) : value === null || value === undefined ? [] : [value];
  const out: string[] = [];
  for (const item of raw) {
    const s = str(item, 200);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "1", "on"].includes(v)) return true;
    if (["false", "no", "0", "off"].includes(v)) return false;
  }
  return null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Accepts ISO dates/datetimes and Notion's "January 5, 2024 3:04 PM".
 * Returns an ISO string, or null when the value is not a real date.
 */
export function parseDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Unix seconds or milliseconds.
    const ms = value > 1e11 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value !== "string") return null;
  const v = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (dateOnly) {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? d.toISOString() : null;
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v)) {
    const d = new Date(v.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const notion = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?(?:\s+\(?[A-Z]{2,5}\)?)?$/i.exec(v);
  if (notion) {
    const month = MONTHS.indexOf(notion[1]!.toLowerCase());
    if (month === -1) return null;
    let hours = notion[4] ? Number(notion[4]) % 12 : 0;
    if (notion[6]?.toUpperCase() === "PM") hours += 12;
    const d = new Date(Date.UTC(Number(notion[3]), month, Number(notion[2]), hours, notion[5] ? Number(notion[5]) : 0));
    return d.getUTCDate() === Number(notion[2]) ? d.toISOString() : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export type MappedMetadata = {
  pid: string | null;
  title: string | null;
  slug: string | null;
  type: string | null;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  robotsIndex: string | null;
  sourceStatus: string | null;
  sourceVisibility: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  tags: string[];
  topics: string[];
  author: string | null;
  cover: string | null;
  order: number | null;
  aliases: string[];
  legacyUrls: string[];
  related: string[];
  collection: string | null;
  featured: boolean | null;
  priority: number | null;
  notes: string | null;
  /** README only: import this README as a document too. */
  importAsDocument: boolean | null;
  /** Keys this table did not recognise, for matching against destination fields. */
  candidates: Record<string, unknown>;
  /** Recognised keys whose values could not be used, preserved verbatim. */
  rejected: Record<string, unknown>;
  issues: Issue[];
};

export function emptyMetadata(): MappedMetadata {
  return {
    pid: null, title: null, slug: null, type: null, excerpt: null, seoTitle: null, seoDescription: null, canonicalUrl: null, robotsIndex: null,
    sourceStatus: null, sourceVisibility: null, publishedAt: null, updatedAt: null, createdAt: null, tags: [], topics: [], author: null,
    cover: null, order: null, aliases: [], legacyUrls: [], related: [], collection: null, featured: null, priority: null, notes: null,
    importAsDocument: null, candidates: {}, rejected: {}, issues: [],
  };
}

/**
 * Maps a flat metadata object. Nested `seo: {title, description}` and
 * `og: {image}` maps are understood; other nested maps become candidates.
 */
export function mapSourceMetadata(data: Record<string, unknown>, path?: string): MappedMetadata {
  const out = emptyMetadata();
  let description: string | null = null;

  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(data)) {
    const nk = normalizeKey(key);
    if ((nk === "seo" || nk === "meta" || nk === "og" || nk === "opengraph") && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        const ik = normalizeKey(inner);
        if (ik === "title") entries.push(["seoTitle", innerValue]);
        else if (ik === "description") entries.push(["seoDescription", innerValue]);
        else if (ik === "image") entries.push(["cover", innerValue]);
        else if (ik === "canonical" || ik === "canonicalurl") entries.push(["canonicalUrl", innerValue]);
        else out.candidates[`${key}.${inner}`] = innerValue;
      }
      continue;
    }
    entries.push([key, value]);
  }

  const reject = (key: string, value: unknown, message: string) => {
    out.rejected[key] = value;
    out.issues.push(issue("warning", "frontmatter.invalid_value", message, { path, detail: key }));
  };

  for (const [key, value] of entries) {
    const canonical = canonicalKey(key);
    if (!canonical) {
      out.candidates[key] = value;
      continue;
    }
    switch (canonical) {
      case "pid":
        out.pid = str(value, 200);
        break;
      case "title":
        out.title = str(value, 300);
        break;
      case "slug":
        out.slug = str(value, 200);
        break;
      case "type":
        out.type = str(value, 80);
        break;
      case "excerpt":
        out.excerpt = str(value, 2000);
        break;
      case "description":
        description = str(value, 2000);
        break;
      case "seoTitle":
        out.seoTitle = str(value, 300);
        break;
      case "seoDescription":
        out.seoDescription = str(value, 1000);
        break;
      case "canonicalUrl":
        out.canonicalUrl = str(value, 2048);
        break;
      case "robots": {
        const v = str(value, 40)?.toLowerCase() ?? "";
        out.robotsIndex = v.includes("noindex") ? "noindex" : v === "index" ? "index" : null;
        break;
      }
      case "status":
        out.sourceStatus = str(value, 40)?.toLowerCase() ?? null;
        break;
      case "draft": {
        const b = bool(value);
        if (b !== null) out.sourceStatus = out.sourceStatus ?? (b ? "draft" : "published");
        break;
      }
      case "published": {
        const b = bool(value);
        if (b !== null) out.sourceStatus = out.sourceStatus ?? (b ? "published" : "draft");
        else {
          // "published: 2024-01-01" is a date, not a flag.
          const d = parseDate(value);
          if (d) out.publishedAt = out.publishedAt ?? d;
        }
        break;
      }
      case "visibility":
        out.sourceVisibility = str(value, 40)?.toLowerCase() ?? null;
        break;
      case "publishedAt":
      case "updatedAt":
      case "createdAt": {
        const d = parseDate(value);
        if (d) out[canonical] = d;
        else if (value !== null && value !== "") reject(key, value, `"${key}" is not a date this importer understands (use YYYY-MM-DD).`);
        break;
      }
      case "tags":
        out.tags.push(...list(value).map((t) => t.replace(/^#/, "")).filter((t) => !out.tags.includes(t)));
        break;
      case "topics":
        out.topics.push(...list(value, 20).filter((t) => !out.topics.includes(t)));
        break;
      case "author": {
        const authors = list(value, 10);
        out.author = authors.length ? authors.join(", ") : null;
        break;
      }
      case "cover":
        out.cover = str(value, 2048);
        break;
      case "order": {
        const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
        if (Number.isFinite(n)) out.order = n;
        else reject(key, value, `"${key}" should be a number.`);
        break;
      }
      case "aliases":
        out.aliases.push(...list(value, 20));
        break;
      case "legacyUrls":
        out.legacyUrls.push(...list(value, 20));
        break;
      case "related":
        out.related.push(...list(value, 30));
        break;
      case "collection":
        out.collection = str(value, 200);
        break;
      case "featured":
        out.featured = bool(value);
        break;
      case "priority": {
        const n = Number(value);
        if (Number.isFinite(n)) out.priority = Math.max(-100, Math.min(100, Math.round(n)));
        break;
      }
      case "notes":
        out.notes = str(value, 20000);
        break;
      case "import":
        out.importAsDocument = bool(value);
        break;
    }
  }

  // `description` is the excerpt unless an explicit excerpt exists; then it is the SEO description.
  if (description) {
    if (!out.excerpt) out.excerpt = description;
    else if (!out.seoDescription) out.seoDescription = description;
  }
  return out;
}
