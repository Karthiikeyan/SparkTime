import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isCourseType, isInterviewType, kindOf } from "@/lib/content/kind";
import { shortTitle } from "@/lib/home";
import { isNotesTopic, siteConfig } from "@/lib/site-config";
import { getFeaturedTopics } from "./settings";
import { getDb } from "../db/client";
import { collectionItems, documents } from "../db/schema";
import { listContentTypes } from "./content-types";
import { getInterviewDirectory } from "./interviews";
import { descendantIds, getCollectionEntries, listPublished, listSeries, publicTagCounts, publicTypeCounts, seriesTotals, visibleCategories, type Card } from "./public-content";
import { listTags } from "./taxonomy";

/** The library's filters: what kind of piece, which topic, and in what order. All of it lives in the URL. */
export const LIBRARY_KINDS = ["all", "guide", "course", "interview"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
export type LibrarySort = "newest" | "short";
export type LibraryFilter = { kind: LibraryKind; topic: string | null; sort: LibrarySort };

export const LIBRARY_PAGE_SIZE = 30;
/** The topic filter's value for every top-level topic outside the featured ones. */
export const NOTES_TOPIC = "notes";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Filters from a page's search params; anything unrecognised falls back to "everything". */
export function parseLibraryFilter(params: Record<string, string | string[] | undefined>): LibraryFilter {
  const kind = one(params.type);
  const topic = one(params.topic).slice(0, 80);
  return {
    kind: (LIBRARY_KINDS as readonly string[]).includes(kind) ? (kind as LibraryKind) : "all",
    topic: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic) ? topic : null,
    sort: one(params.sort) === "short" ? "short" : "newest",
  };
}

/** "?type=course&topic=technology": only what differs from the unfiltered library. */
export function libraryQuery(filter: LibraryFilter): string {
  const q = new URLSearchParams();
  if (filter.kind !== "all") q.set("type", filter.kind);
  if (filter.topic) q.set("topic", filter.topic);
  if (filter.sort !== "newest") q.set("sort", filter.sort);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export type LibraryRow = { card: Card; kind: ReturnType<typeof kindOf>; lessons: number | null; minutes: number | null };

export async function getLibraryListing(filter: LibraryFilter, page: number) {
  const [types, topics, typeCounts, featuredSlugs] = await Promise.all([listContentTypes(), visibleCategories(), publicTypeCounts(), getFeaturedTopics()]);
  const pageable = types.filter((t) => t.routing === "type" && !t.archivedAt);
  const idsOf = (kind: LibraryKind) => pageable.filter((t) => kind === "all" || kindOf(t) === kind).map((t) => t.id);
  const countOf = (kind: LibraryKind) => idsOf(kind).reduce((n, id) => n + (typeCounts.get(id) ?? 0), 0);
  const counts = Object.fromEntries(LIBRARY_KINDS.map((k) => [k, countOf(k)])) as Record<LibraryKind, number>;

  const roots = topics.filter((t) => !t.parentId && t.count > 0);
  const featured = featuredSlugs.flatMap((slug) => roots.filter((t) => t.slug === slug));
  const notes = topics.filter((t) => isNotesTopic(t, featuredSlugs));
  const topicPills = [...featured.map((t) => ({ slug: t.slug, name: t.name })), ...(notes.length ? [{ slug: NOTES_TOPIC, name: "Notes" }] : [])];

  let categoryIds: string[] | undefined;
  let topicName: string | null = null;
  if (filter.topic === NOTES_TOPIC) {
    categoryIds = notes.flatMap((t) => descendantIds(topics, t.id));
    topicName = "Notes";
  } else if (filter.topic) {
    const hit = topics.find((t) => t.slug === filter.topic);
    if (hit) {
      categoryIds = descendantIds(topics, hit.id);
      topicName = hit.name;
    }
  }

  const typeIds = idsOf(filter.kind);
  const empty = (filter.kind !== "all" && typeIds.length === 0) || (filter.topic !== null && categoryIds === undefined) || categoryIds?.length === 0;
  const result = empty
    ? { items: [] as Card[], total: 0 }
    : await listPublished({ typeIds: filter.kind === "all" ? undefined : typeIds, categoryIds, limit: LIBRARY_PAGE_SIZE, offset: (page - 1) * LIBRARY_PAGE_SIZE, order: filter.sort === "short" ? "shortest" : "recent" });

  const courseCardIds = result.items.filter((c) => kindOf(c.type) === "course").map((c) => c.id);
  const totals = await seriesTotals(courseCardIds);
  const rows: LibraryRow[] = result.items.map((card) => ({
    card,
    kind: kindOf(card.type),
    lessons: totals.get(card.id)?.parts ?? null,
    minutes: totals.get(card.id)?.minutes ?? null,
  }));
  return { rows, total: result.total, pages: Math.max(1, Math.ceil(result.total / LIBRARY_PAGE_SIZE)), counts, topicPills, topicName, topicKnown: filter.topic === null || categoryIds !== undefined };
}

/** What sits beside the library list: the courses, the companies with interview pages, and the tags used most. */
export async function getLibrarySidebar() {
  const types = await listContentTypes();
  const courseType = types.find(isCourseType);
  const interviewType = types.find(isInterviewType);
  const [courses, directory, tagCounts, allTags] = await Promise.all([
    courseType ? listSeries({ typeIds: [courseType.id], limit: 8 }) : Promise.resolve([]),
    interviewType ? getInterviewDirectory(interviewType) : Promise.resolve([]),
    publicTagCounts(),
    listTags(),
  ]);
  const tags = allTags
    .map((t) => ({ ...t, count: tagCounts.get(t.id) ?? 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8);
  return { courses, directory, tags, interviewPath: interviewType ? `/${interviewType.slug}` : null, coursePath: courseType ? `/${courseType.slug}` : null };
}

/**
 * "Lesson 12 of Java From Zero to Job-Ready" for each given piece that is a lesson of a published
 * course. The number is the lesson's place among the course's readable lessons, as its own page shows it.
 */
export async function lessonPlacements(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const courseTypeIds = (await listContentTypes()).filter(isCourseType).map((t) => t.id);
  if (!courseTypeIds.length) return out;
  const collection = alias(documents, "collection");
  const rows = await getDb()
    .select({ documentId: collectionItems.documentId, collectionId: collectionItems.collectionId, title: collection.title })
    .from(collectionItems)
    .innerJoin(collection, eq(collection.id, collectionItems.collectionId))
    .where(and(inArray(collectionItems.documentId, ids), inArray(collection.typeId, courseTypeIds), eq(collection.status, "published"), eq(collection.visibility, "public")));
  const entries = new Map<string, string[]>();
  for (const collectionId of new Set(rows.map((r) => r.collectionId))) entries.set(collectionId, (await getCollectionEntries(collectionId)).map((e) => e.card.id));
  for (const row of rows) {
    const n = (entries.get(row.collectionId) ?? []).indexOf(row.documentId) + 1;
    if (n > 0 && !out.has(row.documentId)) out.set(row.documentId, `Lesson ${n} of ${shortTitle(row.title)}`);
  }
  return out;
}

export type StartGoal = { n: string; goal: string; desc: string; path: string; href: string };

/**
 * /start-here: one goal per published course that answers it, then the interview pages. A goal whose
 * course isn't published is left out, and every count is the course's own.
 */
export async function getStartGoals(): Promise<StartGoal[]> {
  const types = await listContentTypes();
  const courseType = types.find(isCourseType);
  const interviewType = types.find(isInterviewType);
  const [courses, directory] = await Promise.all([courseType ? listSeries({ typeIds: [courseType.id], limit: 20 }) : Promise.resolve([]), interviewType ? getInterviewDirectory(interviewType) : Promise.resolve([])]);
  const goals: Array<Omit<StartGoal, "n">> = [];
  for (const g of siteConfig.startGoals) {
    const course = courses.find((c) => c.path.split("/").pop()!.startsWith(g.course));
    if (course) goals.push({ goal: g.goal, desc: g.desc, path: `${shortTitle(course.title)} · ${course.parts} ${course.parts === 1 ? "lesson" : "lessons"}`, href: course.path });
  }
  const accounts = directory.reduce((n, c) => n + c.roles.reduce((m, r) => m + r.accounts, 0), 0);
  const questions = directory.reduce((n, c) => n + c.roles.reduce((m, r) => m + r.questions, 0), 0);
  if (interviewType && directory.length) {
    goals.push({ ...siteConfig.startInterviewGoal, path: `${accounts} accounts · ${questions} questions`, href: `/${interviewType.slug}` });
  }
  return goals.map((g, i) => ({ ...g, n: String(i + 1).padStart(2, "0") }));
}
