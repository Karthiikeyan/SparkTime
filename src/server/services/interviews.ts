import "server-only";
import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { isCourseType } from "@/lib/content/kind";
import { documentPath } from "@/lib/content/paths";
import type { Properties } from "@/lib/content/properties";
import { buildDirectory, findCompany, guidePageLink, interviewFacts, nameKey, type DirectoryCompany, type GuidePageLink } from "@/lib/interviews/directory";
import { getDb } from "../db/client";
import { documents } from "../db/schema";
import { listContentTypes, type ContentType } from "./content-types";
import { listSeries, type Card } from "./public-content";
import { listedSql } from "./visibility";

/**
 * Public reads for interview pages: the /interviews directory, a company's
 * page and its roles. Only listed pages (published + public) appear, through
 * the same visibility rule as every other listing.
 */
export const listInterviewPages = cache(async (type: ContentType): Promise<GuidePageLink[]> => {
  const rows = await getDb()
    .select({ id: documents.id, title: documents.title, slug: documents.slug, excerpt: documents.excerpt, properties: documents.properties })
    .from(documents)
    .where(and(eq(documents.typeId, type.id), listedSql()))
    .orderBy(asc(documents.title));
  return rows.map((row) => guidePageLink({ id: row.id, title: row.title || "Untitled", path: documentPath(type, row.slug), excerpt: row.excerpt ?? "" }, interviewFacts(type.fields, (row.properties ?? {}) as Properties)));
});

export async function getInterviewDirectory(type: ContentType): Promise<DirectoryCompany[]> {
  return buildDirectory(await listInterviewPages(type));
}

/** A company with at least one published page, by the slug of its name. */
export async function getInterviewCompany(type: ContentType, companySlug: string): Promise<DirectoryCompany | null> {
  return findCompany(await getInterviewDirectory(type), companySlug);
}

export type InterviewSidebar = {
  /** Other companies with published pages. */
  others: DirectoryCompany[];
  /** What to read or study alongside: the published courses, then the pages this one links to. */
  prepare: Card[];
};

/** The beside-the-page lists of an interview page, all from published content. */
export async function getInterviewSidebar(type: ContentType, companySlug: string, linked: Card[] = []): Promise<InterviewSidebar> {
  const [directory, types] = await Promise.all([getInterviewDirectory(type), listContentTypes()]);
  const courseTypeIds = types.filter(isCourseType).map((t) => t.id);
  const courses = courseTypeIds.length ? await listSeries({ typeIds: courseTypeIds, limit: 2 }) : [];
  const seen = new Set<string>();
  const prepare = [...courses, ...linked].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).slice(0, 4);
  return { others: directory.filter((c) => c.slug !== companySlug), prepare };
}

/** The published page of one role (for /interviews/{company}/{role}, the earlier URL of a role). */
export async function findRolePage(type: ContentType, companySlug: string, roleSlug: string): Promise<GuidePageLink | null> {
  const company = await getInterviewCompany(type, companySlug);
  return company?.roles.find((r) => nameKey(r.role) === roleSlug) ?? null;
}
