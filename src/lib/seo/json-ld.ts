/**
 * Structured data (schema.org JSON-LD). Builders are pure functions so they
 * are unit-testable; nothing here reads the database.
 *
 * Entity graph: one Person (#person) and one WebSite (#website) are
 * referenced by @id from every page, which is how search engines connect
 * "Karthikeyan A" across articles, videos, talks and profiles.
 */
import type { SchemaType } from "../content/model";

export type JsonLd = Record<string, unknown>;

export const personId = (siteUrl: string) => `${siteUrl}/#person`;
export const websiteId = (siteUrl: string) => `${siteUrl}/#website`;

export type PersonInput = {
  siteUrl: string;
  name: string;
  alternateNames: string[];
  description: string;
  jobTitle: string;
  worksFor: string;
  knowsAbout: string[];
  imageUrl: string | null;
  sameAs: string[];
  location?: string;
};

export function personSchema(p: PersonInput): JsonLd {
  return prune({
    "@type": "Person",
    "@id": personId(p.siteUrl),
    name: p.name,
    alternateName: p.alternateNames.length ? p.alternateNames : undefined,
    url: `${p.siteUrl}/about`,
    image: p.imageUrl ?? undefined,
    description: p.description || undefined,
    jobTitle: p.jobTitle || undefined,
    worksFor: p.worksFor ? { "@type": "Organization", name: p.worksFor } : undefined,
    knowsAbout: p.knowsAbout.length ? p.knowsAbout : undefined,
    homeLocation: p.location ? { "@type": "Place", name: p.location } : undefined,
    sameAs: p.sameAs.length ? p.sameAs : undefined,
  });
}

export function websiteSchema(siteUrl: string, name: string, description: string): JsonLd {
  return prune({
    "@type": "WebSite",
    "@id": websiteId(siteUrl),
    url: siteUrl,
    name,
    description: description || undefined,
    inLanguage: "en",
    publisher: { "@id": personId(siteUrl) },
    author: { "@id": personId(siteUrl) },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${siteUrl}/search?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  });
}

export function webPageSchema(input: { siteUrl: string; url: string; name: string; description?: string; type?: "WebPage" | "ProfilePage" | "CollectionPage" | "AboutPage" | "SearchResultsPage"; mainEntity?: JsonLd | { "@id": string } }): JsonLd {
  return prune({
    "@type": input.type ?? "WebPage",
    "@id": `${input.url}#webpage`,
    url: input.url,
    name: input.name,
    description: input.description || undefined,
    isPartOf: { "@id": websiteId(input.siteUrl) },
    about: input.type === "ProfilePage" ? { "@id": personId(input.siteUrl) } : undefined,
    mainEntity: input.mainEntity,
    inLanguage: "en",
  });
}

/**
 * An organisation the owner founded, e.g. SparkTribe on /sparktribe. Only facts
 * the owner has published are used: its name, its own site and the page's
 * description; the founder is the site's Person.
 */
export function founderOrganizationSchema(input: { siteUrl: string; pageUrl: string; name: string; url: string; description?: string; founderName: string }): JsonLd {
  return prune({
    "@type": "Organization",
    "@id": `${input.pageUrl}#organization`,
    name: input.name,
    url: input.url,
    description: input.description || undefined,
    founder: { "@type": "Person", "@id": personId(input.siteUrl), name: input.founderName, url: `${input.siteUrl}/about` },
    subjectOf: { "@id": `${input.pageUrl}#webpage` },
  });
}

export type Crumb = { name: string; url: string };

export function breadcrumbSchema(crumbs: Crumb[]): JsonLd | null {
  if (crumbs.length < 2) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
  };
}

export function itemListSchema(name: string, items: Array<{ name: string; url: string }>): JsonLd | null {
  if (!items.length) return null;
  return {
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.slice(0, 50).map((it, i) => ({ "@type": "ListItem", position: i + 1, url: it.url, name: it.name })),
  };
}

export type DocumentSchemaInput = {
  siteUrl: string;
  url: string;
  /** Settings → Identity name. */
  authorName: string;
  schemaType: SchemaType;
  title: string;
  description: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  imageUrl: string | null;
  section: string | null;
  keywords: string[];
  wordCount: number;
  /** Role-mapped facts from custom properties. */
  facts: {
    videoId?: string | null;
    duration?: string | null;
    transcript?: string | null;
    eventName?: string | null;
    eventDate?: string | null;
    location?: string | null;
    rating?: number | null;
    itemName?: string | null;
    itemAuthor?: string | null;
    isbn?: string | null;
    repositoryUrl?: string | null;
    difficulty?: string | null;
    courseItems?: Array<{ name: string; url: string }>;
  };
};

/** Maps a document to the schema.org type its content type declares. */
export function documentSchema(d: DocumentSchemaInput): JsonLd {
  // Search engines don't follow an @id to another page (the full Person lives on
  // the home and About pages), so the author carries its name and profile URL here.
  const author = { "@type": "Person", "@id": personId(d.siteUrl), name: d.authorName, url: `${d.siteUrl}/about` };
  const base = {
    "@id": `${d.url}#main`,
    url: d.url,
    name: d.title,
    headline: d.title.slice(0, 110),
    description: d.description || undefined,
    image: d.imageUrl ?? undefined,
    datePublished: d.publishedAt ?? undefined,
    dateModified: d.modifiedAt ?? d.publishedAt ?? undefined,
    author,
    publisher: author,
    mainEntityOfPage: { "@id": `${d.url}#webpage` },
    isPartOf: { "@id": websiteId(d.siteUrl) },
    inLanguage: "en",
    keywords: d.keywords.length ? d.keywords.join(", ") : undefined,
  };

  switch (d.schemaType) {
    case "Article":
    case "BlogPosting":
    case "TechArticle":
      return prune({ "@type": d.schemaType, ...base, articleSection: d.section ?? undefined, wordCount: d.wordCount || undefined, proficiencyLevel: d.schemaType === "TechArticle" ? d.facts.difficulty ?? undefined : undefined });
    case "VideoObject": {
      if (!d.facts.videoId) return prune({ "@type": "CreativeWork", ...base });
      return prune({
        "@type": "VideoObject",
        ...base,
        headline: undefined,
        thumbnailUrl: d.imageUrl ?? `https://i.ytimg.com/vi/${d.facts.videoId}/hqdefault.jpg`,
        uploadDate: d.publishedAt ?? undefined,
        embedUrl: `https://www.youtube-nocookie.com/embed/${d.facts.videoId}`,
        contentUrl: `https://www.youtube.com/watch?v=${d.facts.videoId}`,
        duration: toIsoDuration(d.facts.duration),
        transcript: d.facts.transcript ? d.facts.transcript.slice(0, 5000) : undefined,
        creator: author,
      });
    }
    case "Event":
      if (!d.facts.eventDate) return prune({ "@type": "CreativeWork", ...base });
      return prune({
        "@type": "Event",
        "@id": base["@id"],
        url: d.url,
        name: d.facts.eventName ? `${d.title} — ${d.facts.eventName}` : d.title,
        description: base.description,
        image: base.image,
        startDate: d.facts.eventDate,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: d.facts.location && /online|virtual|remote/i.test(d.facts.location) ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
        location: d.facts.location ? { "@type": /online|virtual|remote/i.test(d.facts.location) ? "VirtualLocation" : "Place", name: d.facts.location } : undefined,
        performer: author,
        organizer: d.facts.eventName ? { "@type": "Organization", name: d.facts.eventName } : undefined,
      });
    case "Course":
      return prune({
        "@type": "Course",
        "@id": base["@id"],
        url: d.url,
        name: d.title,
        description: base.description || d.title,
        provider: author,
        educationalLevel: d.facts.difficulty ?? undefined,
        hasPart: d.facts.courseItems?.length ? d.facts.courseItems.slice(0, 50).map((i) => ({ "@type": "CreativeWork", name: i.name, url: i.url })) : undefined,
      });
    case "Review":
      if (!d.facts.itemName) return prune({ "@type": "Article", ...base });
      return prune({
        "@type": "Review",
        ...base,
        headline: undefined,
        itemReviewed: prune({
          "@type": d.facts.isbn || d.facts.itemAuthor ? "Book" : "CreativeWork",
          name: d.facts.itemName,
          author: d.facts.itemAuthor ? { "@type": "Person", name: d.facts.itemAuthor } : undefined,
          isbn: d.facts.isbn ?? undefined,
        }),
        reviewRating:
          typeof d.facts.rating === "number" ? { "@type": "Rating", ratingValue: d.facts.rating, bestRating: 5, worstRating: 0 } : undefined,
        reviewBody: undefined,
      });
    case "SoftwareSourceCode":
      return prune({ "@type": "SoftwareSourceCode", ...base, headline: undefined, codeRepository: d.facts.repositoryUrl ?? undefined });
    case "CollectionPage":
      return prune({ "@type": "CollectionPage", ...base, headline: undefined });
    case "WebPage":
      return prune({ "@type": "WebPage", ...base, headline: undefined });
    default:
      return prune({ "@type": "CreativeWork", ...base });
  }
}

/** "12:40" / "1:02:03" / "PT12M" → ISO-8601 duration. */
export function toIsoDuration(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^P(T?\d)/.test(value)) return value;
  const parts = value.split(":").map((n) => Number(n));
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  const [h, m, s] = parts.length === 3 ? parts : parts.length === 2 ? [0, parts[0], parts[1]] : [0, parts[0], 0];
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s ? `${s}S` : ""}` || undefined;
}

export function graph(...nodes: Array<JsonLd | null | undefined>): JsonLd {
  return { "@context": "https://schema.org", "@graph": nodes.filter(Boolean) };
}

function prune<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) if (obj[key] === undefined || obj[key] === null || obj[key] === "") delete obj[key];
  return obj;
}

const BACKSLASH = String.fromCharCode(92);
const JSON_LD_ESCAPES: Record<string, string> = {
  "<": `${BACKSLASH}u003c`,
  ">": `${BACKSLASH}u003e`,
  "&": `${BACKSLASH}u0026`,
  [String.fromCharCode(0x2028)]: `${BACKSLASH}u2028`,
  [String.fromCharCode(0x2029)]: `${BACKSLASH}u2029`,
};
const JSON_LD_UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");

/**
 * Serialise for a <script type="application/ld+json"> element. Escaping <, >
 * and & means a title like `</script><script>alert(1)</script>` stays inert
 * JSON text and can never close the script element.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(JSON_LD_UNSAFE, (c) => JSON_LD_ESCAPES[c] ?? c);
}
