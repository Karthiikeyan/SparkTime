import "server-only";
import { isUuid } from "@/lib/content/blocks";
import { extractHeadings, type Heading } from "@/lib/content/derive";
import { isCourseType } from "@/lib/content/kind";
import { isTemplate, type Template } from "@/lib/content/model";
import { buildModules, courseLessons, type CourseLesson, type CourseModule } from "@/lib/courses";
import { absoluteUrl, categoryPath, typeIndexPath } from "@/lib/content/paths";
import { valueByRole } from "@/lib/content/properties";
import type { MediaAsset } from "@/lib/media";
import { breadcrumbSchema, documentSchema, graph, webPageSchema, type JsonLd } from "@/lib/seo/json-ld";
import { parseYouTubeId } from "@/lib/embeds";
import { siteUrl } from "../env";
import { listContentTypes } from "./content-types";
import {
  cardsByIds,
  getAdjacent,
  getCollectionEntries,
  getCollectionsContaining,
  getConnections,
  getRootPage,
  getSeriesPosition,
  listSeries,
  mediaForDoc,
  resolveReferences,
  type Card,
  type CollectionEntry,
  type Connection,
  type PublicDocument,
  type SeriesPosition,
  type SeriesSummary,
  visibleCategories,
} from "./public-content";
import { recommendFor, type Recommendation } from "./recommendations";
import { getSiteSections, type TypeSection } from "./sections";
import { getFeaturedTopics, loadAllSettings } from "./settings";
import type { HubKey } from "@/lib/content/sections";
import { shortTitle } from "@/lib/home";
import { isNotesTopic } from "@/lib/site-config";
import { safeHref } from "@/lib/url";
import { companyHref, interviewFacts, nameKey, type DirectoryCompany, type InterviewFacts } from "@/lib/interviews/directory";
import { getInterviewCompany, getInterviewSidebar, type InterviewSidebar } from "./interviews";

/** A lesson's course: its lessons by module, and where this lesson sits among them. */
export type CourseContext = {
  id: string;
  title: string;
  path: string;
  /** The courses index: where "Courses" in the breadcrumb leads. */
  typePath: string;
  typeName: string;
  topic: { name: string; slug: string } | null;
  modules: CourseModule[];
  total: number;
  /** This lesson's number (1-based) and the module it is in. */
  number: number;
  moduleIndex: number;
  previous: CourseLesson | null;
  next: CourseLesson | null;
};

/** A course's own page: its modules and what to read after it. */
export type CourseOverview = { modules: CourseModule[]; lessons: number; minutes: number; first: CourseLesson | null; more: SeriesSummary[] };

export type DocumentPageData = {
  doc: PublicDocument;
  template: Template;
  refs: Map<string, Card>;
  media: Map<string, MediaAsset>;
  headings: Heading[];
  outgoing: Connection[];
  incoming: Connection[];
  /** Other collections this is part of (the series below, if any, is not repeated here). */
  collections: Card[];
  /** Position in its most curated collection; replaces date-based previous/next when present. */
  series: SeriesPosition | null;
  recommendations: Recommendation[];
  previous: Card | null;
  next: Card | null;
  /** "2 of 5 in Journey" for narrative types when no curated series applies. */
  place: { position: number; total: number; title: string; href: string } | null;
  entries: CollectionEntry[];
  authorName: string;
  /** Studio → Settings → Site → Author summary: the line under the name on the author card. */
  authorSummary: string;
  /** Where the piece sits for a reader: Library › its topic, or Projects. Also the BreadcrumbList. */
  trail: Array<{ label: string; href: string }>;
  /** Where the piece lives in the public IA ("Writing / Articles"); null for standalone pages. */
  section: TypeSection | null;
  hub: HubKey | null;
  /** A closing note about SparkTribe on pieces in the topics chosen in Settings → Pages. */
  sparktribe: { title: string; excerpt: string; path: string; url: string | null } | null;
  /** A lesson of a course (a piece whose series is a course). */
  course: CourseContext | null;
  /** A course's own page. */
  courseOverview: CourseOverview | null;
  /** Interview pages: company, role and guide, and the company's published pages (its own and its roles'). */
  interview: (InterviewFacts & { directory: DirectoryCompany | null; typePath: string; sidebar: InterviewSidebar }) | null;
  jsonLd: JsonLd;
};

export async function loadDocumentPage(doc: PublicDocument, options: { preview?: boolean } = {}): Promise<DocumentPageData> {
  const template: Template = isTemplate(doc.templateOverride) ? doc.templateOverride : doc.type.template;
  const relationIds = doc.fullType.fields
    .filter((f) => f.type === "relation")
    .flatMap((f): unknown[] => {
      const v = doc.properties[f.key];
      return Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    })
    .filter(isUuid);
  const mediaPropIds = doc.fullType.fields.filter((f) => f.type === "image" || f.type === "file").map((f) => doc.properties[f.key] as string | undefined);

  const [contentRefs, relationCards, media, connections, { collections, series }, adjacent, entries, settings] = await Promise.all([
    resolveReferences(doc.content),
    cardsByIds(relationIds, "accessible"),
    mediaForDoc(doc.content, mediaPropIds),
    options.preview ? Promise.resolve({ outgoing: [], incoming: [] }) : getConnections(doc.id),
    options.preview
      ? Promise.resolve({ collections: [], series: null })
      : Promise.all([getCollectionsContaining(doc.id), loadAllSettings()]).then(async ([found, { pages }]) => {
          // Start here and the toolkit are samplers behind their own pages, not series:
          // any real series (a course, a project log) wins the "N of M" line.
          const samplers = new Set([pages.startHereCollectionId, pages.usesCollectionId]);
          // A course the piece belongs to is the series it is read in, ahead of any reading path that also includes it.
          const place = (c: Card) => (samplers.has(c.id) ? 2 : isCourseType(c.type) ? 0 : 1);
          const ranked = [...found].sort((a, b) => place(a) - place(b));
          const position = await getSeriesPosition(doc.id, ranked);
          return { collections: ranked.filter((c) => c.id !== position?.collection.id), series: position };
        }),
    options.preview ? Promise.resolve({ previous: null, next: null, place: null }) : getAdjacent(doc),
    template === "collection" ? getCollectionEntries(doc.id) : Promise.resolve([]),
    loadAllSettings(),
  ]);
  const course = series ? courseContext(series, doc.id) : null;
  const courseOverview = template === "collection" && isCourseType(doc.fullType) ? await loadCourseOverview(doc.id, entries) : null;
  const facts = template === "interview" ? interviewFacts(doc.fullType.fields, doc.properties) : null;
  const interview = facts
    ? {
        ...facts,
        typePath: typeIndexPath(doc.fullType),
        directory: nameKey(facts.company) ? await getInterviewCompany(doc.fullType, nameKey(facts.company)) : null,
        sidebar: await getInterviewSidebar(doc.fullType, nameKey(facts.company), connections.outgoing.map((c) => c.card)),
      }
    : null;
  const sections = await getSiteSections();
  const section = doc.fullType.routing === "type" ? sections.sectionOfType(doc.fullType.id) : null;
  const sparktribe = await sparktribeNote(doc, settings.pages.sparktribe);

  const refs = new Map(contentRefs);
  for (const card of relationCards) refs.set(card.id, card);

  // "Continue exploring" is for what the page doesn't already offer: not its
  // connections, its series (or the series itself), its previous/next, or a
  // collection's own items.
  const shown = new Set<string>([...connections.outgoing, ...connections.incoming].map((c) => c.card.id));
  if (series) for (const id of [series.collection.id, ...series.memberIds]) shown.add(id);
  for (const card of [adjacent.previous, adjacent.next]) if (card) shown.add(card.id);
  for (const entry of entries) shown.add(entry.card.id);
  const recs = options.preview || doc.status !== "published" ? [] : await recommendFor({ id: doc.id, typeId: doc.type.id }, 3, shown);

  const base = siteUrl();
  const url = absoluteUrl(base, doc.path);
  const name = settings.identity.name || "Karthikeyan A";
  const str = (role: string) => {
    const v = valueByRole(doc.fullType.fields, doc.properties, role);
    return typeof v === "string" && v ? v : null;
  };
  const num = (role: string) => {
    const v = valueByRole(doc.fullType.fields, doc.properties, role);
    return typeof v === "number" ? v : null;
  };
  const videoUrl = str("videoUrl");
  const primaryTopic = doc.categories[0];
  const workHub = sections.hub("work");
  const interviewsPath = typeIndexPath(doc.fullType);
  const trail =
    doc.fullType.routing !== "type"
      ? []
      : interview
        ? [
            { label: doc.fullType.pluralName, href: interviewsPath },
            // A role's page sits under its company: the company's own page, or the page built from its published roles.
            ...(interview.role && nameKey(interview.company) ? [{ label: interview.company, href: companyHref(interviewsPath, interview.directory ?? { slug: nameKey(interview.company), page: null }) }] : []),
          ]
      : template === "project" && workHub.live
        ? [{ label: "Projects", href: workHub.path }]
        : [{ label: "Library", href: "/library" }, ...(await topicCrumbs(primaryTopic))];
  // Structured breadcrumbs name real pages only, so in-page sections (#anchors) are left out.
  const crumbs = [{ name: "Home", url: base }, ...trail.filter((c) => !c.href.includes("#")).map((c) => ({ name: c.label, url: absoluteUrl(base, c.href) })), { name: doc.title, url }];
  const jsonLd = graph(
    webPageSchema({ siteUrl: base, url, name: doc.seoTitle || doc.title, description: doc.seoDescription || doc.excerpt, type: template === "collection" ? "CollectionPage" : "WebPage" }),
    documentSchema({
      siteUrl: base,
      url,
      authorName: name,
      schemaType: doc.fullType.schemaType,
      title: doc.title,
      description: doc.seoDescription || doc.excerpt,
      publishedAt: doc.publishedAt,
      modifiedAt: doc.modifiedAt,
      imageUrl: doc.image ? absoluteUrl(base, doc.image.url) : null,
      section: doc.categories[0]?.name ?? null,
      keywords: doc.tags.map((t) => t.name),
      wordCount: doc.wordCount,
      facts: {
        videoId: videoUrl ? parseYouTubeId(videoUrl) : null,
        duration: str("duration"),
        transcript: str("transcript"),
        eventName: str("eventName"),
        eventDate: str("eventDate"),
        location: str("location"),
        rating: num("rating"),
        itemName: str("itemName"),
        itemAuthor: str("itemAuthor"),
        isbn: str("isbn"),
        repositoryUrl: str("repositoryUrl"),
        difficulty: str("difficulty"),
        courseItems: entries.map((e) => ({ name: e.card.title, url: absoluteUrl(base, e.card.path) })),
      },
    }),
    breadcrumbSchema(crumbs),
  );

  return {
    doc,
    template,
    refs,
    media,
    headings: extractHeadings(doc.content),
    outgoing: connections.outgoing,
    incoming: connections.incoming,
    collections,
    series,
    recommendations: recs,
    previous: adjacent.previous,
    next: adjacent.next,
    // Only stories read as "chapter 2 of 5"; a talk's place among talks means nothing.
    place: template === "story" && !series && adjacent.place && adjacent.place.total > 1 ? { ...adjacent.place, title: doc.fullType.pluralName, href: typeIndexPath(doc.fullType) } : null,
    entries,
    authorName: name,
    authorSummary: settings.site.authorSummary,
    trail,
    section,
    hub: sections.hubOfType(doc.fullType.id)?.key ?? null,
    sparktribe,
    course,
    courseOverview,
    interview,
    jsonLd,
  };
}

/**
 * Where a topic sits for a reader: under its parent ("Technology / Software
 * Engineering"), or under Notes when it is one of the topics gathered there.
 */
async function topicCrumbs(primary: PublicDocument["categories"][number] | undefined): Promise<Array<{ label: string; href: string }>> {
  if (!primary) return [];
  const [all, featured] = await Promise.all([visibleCategories(), getFeaturedTopics()]);
  const self = { label: primary.name, href: categoryPath(primary.slug) };
  const parent = primary.parentId ? all.find((c) => c.id === primary.parentId) : undefined;
  if (parent) return [{ label: parent.name, href: categoryPath(parent.slug) }, self];
  const counted = all.find((c) => c.id === primary.id);
  return counted && isNotesTopic(counted, featured) ? [{ label: "Notes", href: "/notes" }, self] : [self];
}

function courseContext(series: SeriesPosition, documentId: string): CourseContext | null {
  if (!isCourseType(series.collection.type)) return null;
  const modules = buildModules(series.entries);
  const lessons = courseLessons(modules);
  const at = lessons.findIndex((l) => l.id === documentId);
  if (at < 0) return null;
  const { collection } = series;
  return {
    id: collection.id,
    title: shortTitle(collection.title),
    path: collection.path,
    typePath: typeIndexPath({ slug: collection.type.slug, routing: "type" }),
    typeName: collection.type.pluralName,
    topic: collection.primaryCategory ? { name: collection.primaryCategory.name, slug: collection.primaryCategory.slug } : null,
    modules,
    total: lessons.length,
    number: at + 1,
    moduleIndex: modules.findIndex((m) => m.lessons.some((l) => l.id === documentId)),
    previous: lessons[at - 1] ?? null,
    next: lessons[at + 1] ?? null,
  };
}

async function loadCourseOverview(documentId: string, entries: CollectionEntry[]): Promise<CourseOverview> {
  const modules = buildModules(entries);
  const lessons = courseLessons(modules);
  const courseTypeIds = (await listContentTypes()).filter(isCourseType).map((t) => t.id);
  const more = courseTypeIds.length ? await listSeries({ typeIds: courseTypeIds, excludeIds: [documentId], limit: 4 }) : [];
  return { modules, lessons: lessons.length, minutes: lessons.reduce((n, l) => n + l.minutes, 0), first: lessons[0] ?? null, more };
}

/**
 * "Read a career piece → discover SparkTribe": the natural next step for a
 * student, offered only on pieces filed under the topics the owner picked
 * (or SparkTribe's own tag/topic), and only while /sparktribe is published.
 */
async function sparktribeNote(doc: PublicDocument, config: { url: string; tagId: string | null; categoryId: string | null; promoteCategoryIds: string[] }): Promise<DocumentPageData["sparktribe"]> {
  if (doc.fullType.routing === "root") return null;
  const topics = new Set([...config.promoteCategoryIds, ...(config.categoryId ? [config.categoryId] : [])]);
  const relevant = doc.categories.some((c) => topics.has(c.id) || (c.parentId !== null && topics.has(c.parentId))) || (config.tagId !== null && doc.tags.some((t) => t.id === config.tagId));
  if (!relevant) return null;
  const page = await getRootPage("sparktribe");
  return page ? { title: page.title, excerpt: page.excerpt, path: page.path, url: safeHref(config.url) } : null;
}
