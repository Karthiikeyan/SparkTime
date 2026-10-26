import "server-only";
import { companyAccounts, companyHref } from "@/lib/interviews/directory";
import { categoryPath, typeIndexPath } from "@/lib/content/paths";
import { firstSentence, roleLine, shortTitle } from "@/lib/home";
import type { HomeSettings } from "@/lib/settings";
import { listContentTypes, type ContentType } from "./content-types";
import { getInterviewDirectory } from "./interviews";
import { listPublished, listSeries, publicTypeCounts, visibleCategories, type Card } from "./public-content";
import { isLivePath } from "./sections";
import { getBrand, loadAllSettings, type Brand } from "./settings";

/**
 * Everything the home page shows: its wording from Studio → Settings → Home page,
 * and its content read from what is published. No number on the page is typed in
 * by hand: each is counted here, so the page stays true as content is added or retired.
 */

export type HomeCourse = { id: string; title: string; fullTitle: string; oneLiner: string; path: string; topic: { name: string; slug: string } | null; lessons: number; minutes: number };
export type HomeCompany = { name: string; href: string; roles: string[]; moreRoles: boolean; roleCount: number; accounts: number; questions: number };
export type HomeTopic = { name: string; path: string; count: number; description: string; subtopics: Array<{ name: string; path: string }> };
export type HomeData = {
  /** The wording, switches and counts chosen in Studio → Settings → Home page. */
  config: HomeSettings;
  brand: Brand;
  stats: { pieces: number; courses: number; lessons: number; accounts: number; questions: number };
  courses: HomeCourse[];
  coursesPath: string | null;
  companies: HomeCompany[];
  interviewsPath: string | null;
  topics: HomeTopic[];
  latest: Card[];
  popular: Array<{ label: string; href: string }>;
};

/** Courses are collection-template types whose schema is Course (the seeded "Course" type), recognised by role, not by name. */
const isCourseType = (t: ContentType) => t.template === "collection" && t.routing === "type" && !t.archivedAt && (t.schemaType === "Course" || t.slug === "course");
const isInterviewType = (t: ContentType) => t.template === "interview" && t.routing === "type" && !t.archivedAt;
/** "Latest guides" are written pieces: interview pages, courses and projects have their own bands. */
const isArticleType = (t: ContentType) => t.routing === "type" && !t.archivedAt && ["editorial", "minimal"].includes(t.template);

export async function getHomeData(): Promise<HomeData> {
  const [types, typeCounts, categories, settings, brand] = await Promise.all([listContentTypes(), publicTypeCounts(), visibleCategories(), loadAllSettings(), getBrand()]);
  const config = settings.home;
  const courseTypes = types.filter(isCourseType);
  const interviewType = types.find(isInterviewType) ?? null;
  const articleTypeIds = types.filter(isArticleType).map((t) => t.id);
  const pageTypeIds = new Set(types.filter((t) => t.routing === "root").map((t) => t.id));

  const [series, directory, latest, popular] = await Promise.all([
    courseTypes.length ? listSeries({ typeIds: courseTypes.map((t) => t.id), limit: 24 }) : [],
    interviewType ? getInterviewDirectory(interviewType) : [],
    articleTypeIds.length ? listPublished({ typeIds: articleTypeIds, limit: config.latest.count }).then((r) => r.items) : [],
    // A shortcut whose page isn't published becomes a search for it, never a 404.
    Promise.all(config.hero.popular.map(async (p) => ({ label: p.label, href: p.href && (/^https?:/i.test(p.href) || (await isLivePath(p.href))) ? p.href : `/search?q=${encodeURIComponent(p.query)}` }))),
  ]);

  const courses: HomeCourse[] = series.map((s) => ({
    id: s.id,
    title: shortTitle(s.title),
    fullTitle: s.title,
    oneLiner: firstSentence(s.excerpt),
    path: s.path,
    topic: s.primaryCategory ? { name: s.primaryCategory.name, slug: s.primaryCategory.slug } : null,
    lessons: s.parts,
    minutes: s.minutes,
  }));

  const interviewsPath = interviewType ? typeIndexPath(interviewType) : null;
  const companies: HomeCompany[] = directory
    .map((c) => {
      const { shown, more } = roleLine(c.roles.map((r) => r.role));
      return {
        name: c.name,
        href: companyHref(interviewsPath ?? "", c),
        roles: shown,
        moreRoles: more,
        roleCount: c.roles.length,
        accounts: companyAccounts(c),
        questions: c.roles.reduce((n, r) => n + r.questions, 0) || (c.page?.questions ?? 0),
      };
    })
    .sort((a, b) => b.accounts - a.accounts || a.name.localeCompare(b.name));

  const topics: HomeTopic[] = config.topics.slugs.flatMap((slug) => {
    const topic = categories.find((c) => c.slug === slug && !c.parentId && c.count > 0);
    if (!topic) return [];
    const subtopics = categories.filter((c) => c.parentId === topic.id && c.count > 0).map((c) => ({ name: c.name, path: categoryPath(c.slug) }));
    return [{ name: topic.name, path: categoryPath(topic.slug), count: topic.count, description: topic.description, subtopics }];
  });

  return {
    config,
    brand,
    stats: {
      // The same total the Library shows: every listed piece outside the standalone pages.
      pieces: [...typeCounts].filter(([id]) => !pageTypeIds.has(id)).reduce((n, [, c]) => n + c, 0),
      courses: courses.length,
      lessons: courses.reduce((n, c) => n + c.lessons, 0),
      accounts: companies.reduce((n, c) => n + c.accounts, 0),
      questions: companies.reduce((n, c) => n + c.questions, 0),
    },
    courses,
    coursesPath: courseTypes.length === 1 && courses.length ? typeIndexPath(courseTypes[0]!) : courses.length ? "/library" : null,
    companies: companies.slice(0, config.interviews.count),
    interviewsPath: companies.length ? interviewsPath : null,
    topics,
    latest,
    popular,
  };
}
