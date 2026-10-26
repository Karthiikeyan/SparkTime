/**
 * The company import package (format "interview-import", version 2): ONE
 * file per company, research/interviews/<company>/import.json, generated from
 * evidence.json by `npm run interviews:build`. It holds every page the
 * research proposes — the company's page and one guide per role that has
 * enough evidence — and is what Studio → Import reads when given a company's import.json.
 *
 * The same checks run in the CLI validator and in the importer, so a package
 * that passes one passes the other. Quotes stay in evidence.json; a package
 * carries only what the importer can verify mechanically: which sources each
 * question rests on, each source's tier and independence group, and the
 * counts derived from them.
 */
import { z } from "zod";
import type { SelectOption } from "../content/model";
import { isValidSlug, slugify } from "../slug";
import { safeExternalUrl } from "../url";
import { cleanText, coerceGuide, DIFFICULTIES, emptyGuide, GUIDE_LIMITS, guideStats, practiceProblemUrl, QUESTION_ID_PATTERN, ROUND_ID_PATTERN, type InterviewGuide } from "./guide";

export const IMPORT_FORMAT = "interview-import";
export const IMPORT_VERSION = 2;
/** INDEX: publish and let search engines index it. HOLD: worth publishing for readers; keep it noindex until demand and quality are proven. */
export const ADVICE = ["INDEX", "HOLD"] as const;
export type Advice = (typeof ADVICE)[number];

/** A role gets a page only with at least this many independent accounts… */
export const MIN_ROLE_ACCOUNTS = 3;
/** …and at least this many explicit questions not waiting for review. */
export const MIN_ROLE_QUESTIONS = 10;

export const SOURCE_KINDS = ["reddit", "leetcode", "geeksforgeeks", "medium", "blog", "ambitionbox", "glassdoor", "github", "youtube", "forum", "prep-site", "other"] as const;
/** first-hand: a candidate's own account. compiled: a list or summary of others' accounts — never enough on its own. */
export const SOURCE_TIERS = ["first-hand", "compiled"] as const;

const id = z.string().regex(QUESTION_ID_PATTERN, "Ids are 1–40 lowercase letters, numbers, - or _.");
const name = z.string().trim().min(1).max(80);
const line = (max: number) => z.string().trim().min(1).max(max);

const sourceSchema = z.strictObject({
  id,
  url: z.string().max(2048).refine((v) => safeExternalUrl(v) !== null, "Must be an http(s) URL."),
  kind: z.enum(SOURCE_KINDS),
  tier: z.enum(SOURCE_TIERS),
  /** Copies and re-posts of one account share a group; one group = one independent report. */
  independenceGroup: z.string().trim().min(1).max(60),
});

const questionSchema = z.strictObject({
  id,
  text: line(GUIDE_LIMITS.text),
  category: z.string().max(80),
  difficulty: z.enum(DIFFICULTIES).nullable(),
  practiceUrl: z.string().max(2048).nullable(),
  reports: z.number().int().min(0).max(GUIDE_LIMITS.reports),
  review: z.boolean(),
  /** Why it needs review, for the human reviewer. Never stored in the CMS. */
  reviewNote: z.string().max(500).optional(),
  /** Ids of the sources whose quotes (in evidence.json) establish this question for this round. */
  sources: z.array(id).min(1).max(50),
});

const roundSchema = z.strictObject({
  id: z.string().regex(ROUND_ID_PATTERN).max(60),
  name,
  reports: z.number().int().min(0).max(GUIDE_LIMITS.reports),
  summary: z.string().max(GUIDE_LIMITS.summary),
  questions: z.array(questionSchema).max(GUIDE_LIMITS.questions),
});

const guideSchema = z.strictObject({
  accounts: z.number().int().min(0).max(GUIDE_LIMITS.reports),
  period: z.string().max(40),
  researched: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  highlights: z.array(line(GUIDE_LIMITS.note)).max(GUIDE_LIMITS.notes),
  preparation: z.array(line(GUIDE_LIMITS.note)).max(GUIDE_LIMITS.notes),
  official: z.array(z.strictObject({ title: line(200), url: z.string().max(2048), points: z.array(line(GUIDE_LIMITS.note)).max(GUIDE_LIMITS.points) })).max(GUIDE_LIMITS.official),
  sequences: z.array(z.strictObject({ steps: z.array(line(80)).min(1).max(GUIDE_LIMITS.steps), reports: z.number().int().min(0) })).max(GUIDE_LIMITS.sequences),
  rounds: z.array(roundSchema).max(GUIDE_LIMITS.rounds),
});

const pageSchema = z.strictObject({
  /** null: the company's own page. */
  role: name.nullable(),
  slug: z.string().refine(isValidSlug, "Must be a lowercase slug."),
  title: line(300),
  excerpt: line(600),
  seoTitle: line(120),
  seoDescription: line(320),
  advice: z.strictObject({ indexing: z.enum(ADVICE), reason: line(2000) }),
  guide: guideSchema,
});

export const importPackageSchema = z.strictObject({
  format: z.literal(IMPORT_FORMAT),
  version: z.literal(IMPORT_VERSION),
  researchRun: line(120),
  company: name,
  sources: z.array(sourceSchema).max(1000),
  pages: z.array(pageSchema).min(1).max(60),
  /** Roles the research found but did not turn into pages, and why. Shown in the preview; never imported. */
  notIncluded: z.array(z.strictObject({ role: name, accounts: z.number().int().min(0), questions: z.number().int().min(0), reason: line(500) })).max(100),
});

export type ImportPackage = z.infer<typeof importPackageSchema>;
export type PackagePage = ImportPackage["pages"][number];

/** A page ready to store: the guide as the CMS keeps it (sources and review notes stripped, rejected links removed). */
export type PlannedPage = {
  role: string | null;
  slug: string;
  title: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  advice: PackagePage["advice"];
  guide: InterviewGuide;
  stats: ReturnType<typeof guideStats>;
  /** Questions still to decide, with the research's reason, for the preview. */
  review: Array<{ round: string; text: string; note: string }>;
};

/**
 * Errors that stop the whole package (it can't be read or trusted as a whole)
 * vs. errors that stop one page (keyed by slug); the rest can still be imported.
 */
export type PackageAnalysis = { errors: string[]; pageErrors: Record<string, string[]>; warnings: string[]; pkg: ImportPackage | null; pages: PlannedPage[] };

/** Every error, package and page alike: what the CLI validator requires to be empty. */
export function analysisErrors(a: Pick<PackageAnalysis, "errors" | "pageErrors">): string[] {
  return [...a.errors, ...Object.values(a.pageErrors).flat()];
}

/**
 * Whether research advice INDEX may be applied automatically: the page must
 * clear the research build's own bar with what readers will actually see
 * (held questions don't count). A role page needs ${MIN_ROLE_ACCOUNTS}
 * accounts and ${MIN_ROLE_QUESTIONS} shown questions; the company page needs
 * the accounts and at least one official source. An explicit Index choice in
 * Studio still overrides this; a file alone never can.
 */
export function indexFloor(page: Pick<PlannedPage, "role" | "guide" | "stats">): { ok: true } | { ok: false; reason: string } {
  const shown = page.stats.questions - page.stats.review;
  if (page.guide.accounts < MIN_ROLE_ACCOUNTS) return { ok: false, reason: `only ${page.guide.accounts} candidate ${page.guide.accounts === 1 ? "account" : "accounts"} (the bar is ${MIN_ROLE_ACCOUNTS})` };
  if (page.role && shown < MIN_ROLE_QUESTIONS) return { ok: false, reason: `only ${shown} ${shown === 1 ? "question" : "questions"} shown publicly (the bar is ${MIN_ROLE_QUESTIONS})` };
  if (!page.role && !page.guide.official.length) return { ok: false, reason: "no official source" };
  return { ok: true };
}

const nameKey = (value: string) => slugify(value, "");

/**
 * Validates a package against the format and the research rules that can be
 * checked mechanically:
 *  - every question rests on at least one first-hand source;
 *  - `reports` equals the number of independent groups behind it, and no
 *    question or round claims more accounts than its page has;
 *  - categories are the field's categories;
 *  - practice links are LeetCode or GeeksforGeeks problem pages (anything
 *    else is dropped, with a warning);
 *  - one company page at most, one page per role.
 * Package errors block the import; a page's errors block that page only;
 * warnings are for the reviewer and never block.
 */
export function analyzeImportPackage(input: unknown, categories: SelectOption[]): PackageAnalysis {
  const parsed = importPackageSchema.safeParse(input);
  if (!parsed.success) {
    const hint = input && typeof input === "object" && (input as { format?: unknown }).format === "interview-research-package" ? ["This is a one-round package from the earlier format. Rebuild the company folder (npm run interviews:build) and import its import.json."] : [];
    return { errors: [...hint, ...parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "package"}: ${i.message}`)], pageErrors: {}, warnings: [], pkg: null, pages: [] };
  }
  const pkg = parsed.data;
  const errors: string[] = [];
  const pageErrors: Record<string, string[]> = {};
  const warnings: string[] = [];
  const sources = new Map<string, ImportPackage["sources"][number]>();
  for (const s of pkg.sources) {
    if (sources.has(s.id)) errors.push(`Source id "${s.id}" is used twice.`);
    sources.set(s.id, s);
  }
  const categoryLabels = new Map(categories.map((c) => [c.value, c.label]));
  const roleKeys = new Map<string, string>();
  const slugs = new Set<string>();
  let companyPages = 0;
  const pages: PlannedPage[] = [];

  for (const page of pkg.pages) {
    const label = page.role ? `${pkg.company} ${page.role}` : `${pkg.company} (company page)`;
    // Two pages with one slug can't be told apart in the preview: the package is ambiguous as a whole.
    if (slugs.has(page.slug)) errors.push(`${label}: the slug "${page.slug}" is used by another page in this package.`);
    slugs.add(page.slug);
    const pe: string[] = [];
    if (page.role === null) {
      companyPages++;
      if (page.guide.rounds.length) pe.push(`${label}: the company page has no rounds; rounds belong to a role.`);
    } else {
      const key = nameKey(page.role);
      if (!key) pe.push(`${label}: the role needs letters or numbers.`);
      else if (roleKeys.has(key)) pe.push(`${label}: "${roleKeys.get(key)}" and "${page.role}" are the same role. Keep one page per role.`);
      else roleKeys.set(key, page.role);
      if (!page.guide.rounds.length) pe.push(`${label}: a role page needs at least one round.`);
    }

    const review: PlannedPage["review"] = [];
    const rounds = page.guide.rounds.map((round) => {
      const at = `${label} · ${round.name}`;
      if (round.reports > page.guide.accounts) pe.push(`${at}: ${round.reports} accounts reported this round, more than the page's ${page.guide.accounts}.`);
      const questions = round.questions.map((q) => {
        const qat = `${at} · ${q.id}`;
        const groups = new Set<string>();
        for (const sid of q.sources) {
          const s = sources.get(sid);
          if (!s) pe.push(`${qat}: unknown source "${sid}".`);
          else if (s.tier !== "first-hand") pe.push(`${qat}: source ${sid} is "${s.tier}"; a question needs a candidate's own account.`);
          else groups.add(s.independenceGroup);
        }
        if (q.reports !== groups.size) pe.push(`${qat}: reports is ${q.reports} but its sources are ${groups.size} independent ${groups.size === 1 ? "account" : "accounts"}.`);
        if (q.reports > round.reports) pe.push(`${qat}: reported by ${q.reports} accounts, more than the ${round.reports} that reported the round.`);
        if (!categoryLabels.has(q.category)) pe.push(`${qat}: category "${q.category}" isn't one of this site's categories (Formats & fields → Interview Experiences).`);
        let practiceUrl: string | null = null;
        if (q.practiceUrl) {
          practiceUrl = practiceProblemUrl(q.practiceUrl);
          if (!practiceUrl) warnings.push(`${qat}: practice link ${q.practiceUrl} is not a LeetCode or GeeksforGeeks problem page, so it is left out.`);
        }
        if (q.review) review.push({ round: round.name, text: q.text, note: q.reviewNote ?? "" });
        return { id: q.id, text: cleanText(q.text), category: q.category, difficulty: q.difficulty, practiceUrl, reports: q.reports, review: q.review };
      });
      if (!round.summary.trim() && page.role) warnings.push(`${at}: no summary of what candidates describe in this round.`);
      return { id: round.id, name: round.name, reports: round.reports, summary: round.summary, questions };
    });
    const official = page.guide.official.map((o) => {
      const url = safeExternalUrl(o.url);
      if (!url || !url.startsWith("https://")) pe.push(`${label}: official source "${o.title}" needs an https link.`);
      return { ...o, url: url ?? o.url };
    });
    const coerced = coerceGuide({ ...page.guide, official, rounds }, categories, "draft");
    if ("error" in coerced) pe.push(`${label}: ${coerced.error}`);
    const guide = "value" in coerced ? coerced.value : emptyGuide();
    const stats = guideStats(guide, categories);
    if (page.role && stats.questions > 0 && stats.questions === stats.review) warnings.push(`${label}: every question is marked for review, so until you review them the page shows its rounds without questions.`);
    if (pe.length) pageErrors[page.slug] = pe;
    pages.push({ role: page.role, slug: page.slug, title: page.title, excerpt: page.excerpt, seoTitle: page.seoTitle, seoDescription: page.seoDescription, advice: page.advice, guide, stats, review });
  }
  if (companyPages > 1) errors.push("The package has more than one company page.");
  return { errors, pageErrors, warnings, pkg, pages };
}
