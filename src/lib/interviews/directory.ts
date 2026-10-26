/**
 * Company → roles, derived from published interview pages. No company or
 * role records exist: a page's own company and role values are the hierarchy,
 * compared by slug so "Amazon" and "amazon" group together while
 * "Amazon India" stays separate. A page with no role is the company's own page.
 */
import type { FieldDefinition } from "../content/model";
import { valueByRole, type Properties } from "../content/properties";
import { slugify } from "../slug";
import { countCategories, publicGuide, readGuide, type CategoryCount, type InterviewGuide } from "./guide";

export type InterviewFacts = {
  company: string;
  /** "" on the company's own page. */
  role: string;
  guide: InterviewGuide;
  /** The type's interview_guide field (its choices are the question categories). */
  guideField: FieldDefinition | null;
};

/**
 * A page's company, role and guide. The guide is what readers get (questions
 * held for review removed) unless `includeHeld` asks for the Studio's full
 * view; every public read uses the default.
 */
export function interviewFacts(fields: FieldDefinition[], properties: Properties, options: { includeHeld?: boolean } = {}): InterviewFacts {
  const text = (role: string) => {
    const v = valueByRole(fields, properties, role);
    return typeof v === "string" ? v.trim() : "";
  };
  const guideField = fields.find((f) => f.type === "interview_guide") ?? null;
  const guide = readGuide(guideField ? properties[guideField.key] : null);
  return { company: text("interviewCompany"), role: text("interviewRole"), guide: options.includeHeld ? guide : publicGuide(guide), guideField };
}

/** Identity of a company or role name: its slug. Empty when nothing slug-worthy remains. */
export function nameKey(name: string): string {
  return slugify(name, "");
}

export type GuidePageLink = {
  id: string;
  title: string;
  path: string;
  excerpt: string;
  company: string;
  /** "" for the company's own page. */
  role: string;
  accounts: number;
  period: string;
  rounds: Array<{ id: string; name: string; reports: number; questions: number }>;
  questions: number;
  byCategory: CategoryCount[];
};

export type DirectoryCompany = {
  name: string;
  slug: string;
  /** The company's own published page, when there is one. */
  page: GuidePageLink | null;
  /** Its published role pages, by name ("SDE 1" before "SDE 2"). */
  roles: GuidePageLink[];
};

export function guidePageLink(base: { id: string; title: string; path: string; excerpt: string }, facts: InterviewFacts): GuidePageLink {
  const questions = facts.guide.rounds.flatMap((r) => r.questions);
  return {
    ...base,
    company: facts.company,
    role: facts.role,
    accounts: facts.guide.accounts,
    period: facts.guide.period,
    rounds: facts.guide.rounds.map((r) => ({ id: r.id, name: r.name, reports: r.reports, questions: r.questions.length })),
    questions: questions.length,
    byCategory: countCategories(questions, facts.guideField?.options.choices),
  };
}

const byName = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

/** Groups pages under their company. Pages without a company can't be placed and are left out. */
export function buildDirectory(pages: GuidePageLink[]): DirectoryCompany[] {
  const companies = new Map<string, DirectoryCompany>();
  for (const page of pages) {
    const key = nameKey(page.company);
    if (!key) continue;
    let company = companies.get(key);
    if (!company) companies.set(key, (company = { name: page.company, slug: key, page: null, roles: [] }));
    if (!page.role) company.page ??= page;
    else if (!company.roles.some((r) => nameKey(r.role) === nameKey(page.role))) company.roles.push(page);
  }
  const out = [...companies.values()].sort((a, b) => byName(a.name, b.name));
  for (const company of out) company.roles.sort((a, b) => byName(a.role, b.role));
  return out;
}

/** The company's page: its own document when published, otherwise the page built from its roles at /{type}/{company}. */
export function companyHref(typePath: string, company: Pick<DirectoryCompany, "slug" | "page">): string {
  return company.page?.path ?? `${typePath}/${company.slug}`;
}

export function findCompany(directory: DirectoryCompany[], slug: string): DirectoryCompany | null {
  return directory.find((c) => c.slug === slug) ?? null;
}

/** Candidate accounts across a company's role pages (each role's accounts are independent of the others'). */
export function companyAccounts(company: DirectoryCompany): number {
  return company.page?.accounts || company.roles.reduce((n, r) => n + r.accounts, 0);
}
