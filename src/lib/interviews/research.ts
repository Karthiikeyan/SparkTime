/**
 * Company research → import package. One company is ONE research job:
 *
 *   research/interviews/<company>/evidence.json   the candidate experiences (source of truth)
 *   research/interviews/<company>/import.json     derived: what Studio imports (the company page + one guide per role)
 *
 * The unit of research is the candidate-reported experience. `buildCompanyImport`
 * turns the experiences into one guide per role: how many independent accounts
 * reported each round and each sequence, and the questions of each round,
 * merged by key and counted by independent account. Rounds are sections of a
 * role's page, so a round with few questions is no longer a thin page of its
 * own; a role with too little evidence gets no page at all.
 *
 * Pure and isomorphic: no IO here. Scripts read and write the files.
 */
import { z } from "zod";
import { slugify } from "../slug";
import { cleanText, DIFFICULTIES, QUESTION_ID_PATTERN, roundId, type InterviewGuide } from "./guide";
import { ADVICE, IMPORT_FORMAT, IMPORT_VERSION, MIN_ROLE_ACCOUNTS, MIN_ROLE_QUESTIONS, SOURCE_KINDS, SOURCE_TIERS, type Advice, type ImportPackage, type PackagePage } from "./import-package";

export { MIN_ROLE_ACCOUNTS, MIN_ROLE_QUESTIONS };
export const COMPANY_EVIDENCE_FORMAT = "interview-company-evidence";
/** Role bucket for sources that say "software engineer" without a level. Never guessed into SDE 1. */
export const UNSPECIFIED_ROLE = "Software Engineer (Level Unspecified)";
/** A round with no explicit question is still shown when this many accounts reported it (its format is useful on its own). */
export const MIN_ROUND_ACCOUNTS = 2;
/** Shown for a round the source does not identify, inside a reported sequence. */
export const UNIDENTIFIED_ROUND = "Unidentified round";
/** Key of the company page in `overrides`. */
export const COMPANY_KEY = "_company";

const id = z.string().regex(QUESTION_ID_PATTERN, "Ids are 1–40 lowercase letters, numbers, - or _.");
const text = (max: number) => z.string().trim().min(1).max(max);

const sourceSchema = z.strictObject({
  id,
  url: z.string().min(1).max(2048),
  title: z.string().max(300).optional(),
  kind: z.enum(SOURCE_KINDS),
  tier: z.enum(SOURCE_TIERS),
  author: z.string().nullable().optional(),
  /** As the source states it ("2025-08", "Aug 2025"); null when it doesn't. Never inferred. */
  reportedDate: z.string().nullable().optional(),
  accessed: z.string().min(1),
  /** Copies and re-posts of one account share a group: one group = one independent report. */
  independenceGroup: text(60),
  notes: z.string().max(1000).optional(),
});

const mentionSchema = z.strictObject({
  /** Stable slug identifying the question across experiences ("lru-cache"). Same key in the same role + round = same question. */
  key: id,
  text: text(500),
  category: text(80),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  /** Only when the candidate linked it or named the problem unambiguously; never searched for. */
  practiceUrl: z.string().max(2048).nullable().optional(),
  /** Verbatim words from the source naming the question. */
  quote: text(1000),
  /** Verbatim words from the source placing it in this round. */
  roundContext: text(1000),
  review: z.boolean().optional(),
  reviewNote: z.string().max(500).optional(),
});

const roundSchema = z.strictObject({
  /** Normalised round name ("Technical Round 1"). */
  name: text(80),
  /** Position in this candidate's own sequence (1 = first, counting the OA when they had one). */
  order: z.number().int().min(0).max(99),
  /**
   * explicit: the source names the round. inferred: placed by what the source describes
   * ("first technical interview after the OA"). uncertain: the source doesn't say what the
   * round was; its questions are kept in the evidence but never imported.
   */
  attribution: z.enum(["explicit", "inferred", "uncertain"]),
  /** What the candidate says about this round (format, duration, interviewer). */
  description: z.string().max(1000).optional(),
  questions: z.array(mentionSchema).default([]),
  /** Reported, but too vague to be a question ("a medium graph problem"). Never imported. */
  vague: z.array(z.string().max(300)).default([]),
});

const experienceSchema = z.strictObject({
  id,
  /** The account's source. Its independenceGroup is the report's identity. */
  source: id,
  /** Other places the same account appears (syndicated copies). Not independent reports. */
  alsoOn: z.array(id).default([]),
  /** As the source states it, normalised only where safe ("SDE I" → "SDE 1"). null = no level stated. */
  role: z.string().trim().max(80).nullable(),
  roleBasis: z.string().max(300).optional(),
  level: z.string().max(80).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  /** On-campus, off-campus, referral, internal transfer… only if stated. */
  interviewType: z.string().max(400).nullable().optional(),
  /** Rounds as the candidate lists them, in order (including the OA). */
  structure: z.array(z.string().max(120)).default([]),
  rounds: z.array(roundSchema).default([]),
  hiringManager: z.string().max(500).optional(),
  barRaiser: z.string().max(500).optional(),
  preparation: z.array(z.string().max(300)).default([]),
});

const officialSchema = z.strictObject({
  title: text(200),
  url: z.string().max(2048).regex(/^https:\/\/\S+$/, "Must be an https URL."),
  /** When it was read (YYYY-MM-DD). */
  accessed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** What the page says, paraphrased closely; nothing a candidate said. */
  points: z.array(text(400)).max(12),
  /** Role slugs the page is about; empty = the whole company. A role page shows its own; the company page shows all. */
  roles: z.array(z.string()).default([]),
});

const roleNoteSchema = z.strictObject({
  /** The role page's lead (its excerpt). Written from the evidence. */
  summary: z.string().max(600).optional(),
  /** Patterns across the accounts, shown on the page. Candidate-reported; never a claim about the company. */
  highlights: z.array(z.string().max(400)).default([]),
  /** Preparation candidates name, shown on the page. */
  preparation: z.array(z.string().max(400)).default([]),
  /** Research caveats: in the role README only. */
  caveats: z.array(z.string()).default([]),
  /** Decisions for the human reviewer: in the role README only. */
  review: z.array(z.string()).default([]),
  /** What candidates describe about each round, keyed by round id ("technical-round-1"). Shown at the top of the round. */
  rounds: z.record(z.string(), z.string().max(1500)).default({}),
});

export const companyEvidenceSchema = z.strictObject({
  format: z.literal(COMPANY_EVIDENCE_FORMAT),
  version: z.literal(1),
  company: text(80),
  researchRun: text(120),
  /** When the research was done (YYYY-MM-DD); shown as "researched" on the pages. */
  researched: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sources: z.array(sourceSchema).max(1000),
  experiences: z.array(experienceSchema).max(1000),
  excluded: z.array(z.strictObject({ text: z.string(), source: z.string().optional(), reason: z.string().min(1) })).default([]),
  /** Manual advice that replaces the computed one, keyed by role slug ("sde-1") or "_company" (e.g. after an OpenSEO check). */
  overrides: z.record(z.string(), z.strictObject({ indexing: z.enum(ADVICE), reason: text(2000) })).default({}),
  /** The company page: its lead, patterns across roles, and what the company publishes officially. */
  companyNotes: z
    .strictObject({ summary: z.string().max(600).optional(), highlights: z.array(z.string().max(400)).default([]), official: z.array(officialSchema).max(10).default([]) })
    .default({ highlights: [], official: [] }),
  /** Hand-written notes per role slug. */
  roleNotes: z.record(z.string(), roleNoteSchema).default({}),
});
export type CompanyEvidence = z.infer<typeof companyEvidenceSchema>;
type Experience = CompanyEvidence["experiences"][number];

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export type BuiltQuestion = PackagePage["guide"]["rounds"][number]["questions"][number] & { mentions: number };
export type BuiltRound = { id: string; name: string; reports: number; order: number; summary: string; questions: BuiltQuestion[]; vague: number };
export type SkippedRound = { role: string; round: string; accounts: number; reason: string };

export type BuiltRole = {
  role: string;
  slug: string;
  notes: z.infer<typeof roleNoteSchema>;
  experiences: Experience[];
  accounts: number;
  period: string;
  rounds: BuiltRound[];
  skipped: SkippedRound[];
  sequences: Array<{ steps: string[]; reports: number }>;
  questions: number;
  confident: number;
  review: number;
  mentions: number;
  /** Null when the role has no page; then `reason` says why. */
  page: PackagePage | null;
  reason: string;
};

export type CompanyBuild = {
  company: string;
  researchRun: string;
  evidence: CompanyEvidence;
  roles: BuiltRole[];
  pkg: ImportPackage | null;
  /** Questions kept in the evidence but not placed: the round couldn't be determined. */
  unresolved: Array<{ experience: string; role: string; round: string; text: string; note: string }>;
  /** Things the reviewer should know (merged wordings, missing summaries). */
  issues: string[];
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Years the sources state, e.g. "2021–2026"; "" when none say. */
function yearRange(dates: Array<string | null | undefined>): string {
  const years = dates.flatMap((d) => (d ?? "").match(/20\d\d/g) ?? []).map(Number);
  if (!years.length) return "";
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

function fit(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

export function buildCompanyImport(input: unknown): { build: CompanyBuild | null; errors: string[] } {
  const parsed = companyEvidenceSchema.safeParse(input);
  if (!parsed.success) return { build: null, errors: parsed.error.issues.slice(0, 25).map((i) => `evidence.${i.path.join(".") || "root"}: ${i.message}`) };
  const ev = parsed.data;
  const errors: string[] = [];
  const sources = new Map<string, CompanyEvidence["sources"][number]>();
  for (const s of ev.sources) {
    if (sources.has(s.id)) errors.push(`Source id "${s.id}" is used twice.`);
    sources.set(s.id, s);
  }
  const experienceIds = new Set<string>();
  const sourceOwner = new Map<string, string>();
  for (const e of ev.experiences) {
    if (experienceIds.has(e.id)) errors.push(`Experience id "${e.id}" is used twice.`);
    experienceIds.add(e.id);
    for (const sid of [e.source, ...e.alsoOn]) {
      if (!sources.has(sid)) errors.push(`Experience ${e.id}: unknown source "${sid}".`);
      else if (sourceOwner.has(sid) && sourceOwner.get(sid) !== e.id) errors.push(`Source ${sid} is used by experiences ${sourceOwner.get(sid)} and ${e.id}: one source is one account.`);
      sourceOwner.set(sid, e.id);
    }
    const primary = sources.get(e.source);
    if (primary && primary.tier !== "first-hand") errors.push(`Experience ${e.id}: its source ${e.source} is "${primary.tier}", not first-hand. Only a candidate's own account is an experience.`);
    // A copy must share the account's independence group, or it would be counted as a second report.
    for (const sid of e.alsoOn) {
      const copy = sources.get(sid);
      if (copy && primary && copy.independenceGroup !== primary.independenceGroup) errors.push(`Experience ${e.id}: copy ${sid} must share ${e.source}'s independenceGroup, or it counts as a second report.`);
    }
  }
  const roleSlugs = new Set(ev.experiences.map((e) => slugify(e.role?.trim() || UNSPECIFIED_ROLE)));
  for (const key of Object.keys(ev.overrides)) {
    if (key.includes("/")) errors.push(`overrides.${key}: advice is per page now: use a role slug (e.g. "sde-1") or "${COMPANY_KEY}".`);
    else if (key !== COMPANY_KEY && !roleSlugs.has(key)) errors.push(`overrides.${key}: no role has that slug.`);
  }
  for (const key of Object.keys(ev.roleNotes)) if (!roleSlugs.has(key)) errors.push(`roleNotes.${key}: no role has that slug.`);
  for (const o of ev.companyNotes.official) for (const r of o.roles) if (!roleSlugs.has(r)) errors.push(`companyNotes.official "${o.title}": no role has the slug "${r}".`);
  if (errors.length) return { build: null, errors };

  const group = (e: Experience) => sources.get(e.source)!.independenceGroup;
  const unresolved: CompanyBuild["unresolved"] = [];
  const issues: string[] = [];
  const byRole = new Map<string, Experience[]>();
  for (const e of ev.experiences) {
    const key = slugify(e.role?.trim() || UNSPECIFIED_ROLE);
    byRole.set(key, [...(byRole.get(key) ?? []), e]);
  }

  const roles: BuiltRole[] = [];
  for (const [slug, exps] of byRole) {
    const role = exps[0]!.role?.trim() || UNSPECIFIED_ROLE;
    const notes = ev.roleNotes[slug] ?? roleNoteSchema.parse({});
    type Mention = { exp: Experience; q: Experience["rounds"][number]["questions"][number] };
    const buckets = new Map<string, { name: string; groups: Set<string>; orders: number[]; mentions: Mention[]; vague: number }>();
    const sequences = new Map<string, { steps: string[]; groups: Set<string> }>();
    for (const exp of exps) {
      const ordered = [...exp.rounds].sort((a, b) => a.order - b.order);
      const steps = ordered.map((r) => (r.attribution === "uncertain" ? UNIDENTIFIED_ROUND : r.name));
      if (steps.length) {
        const k = steps.join(" → ");
        const entry = sequences.get(k) ?? { steps, groups: new Set<string>() };
        entry.groups.add(group(exp));
        sequences.set(k, entry);
      }
      for (const round of ordered) {
        if (round.attribution === "uncertain") {
          for (const q of round.questions) unresolved.push({ experience: exp.id, role, round: round.name, text: q.text, note: round.description ?? "The source does not say what this round was." });
          continue;
        }
        const rid = roundId(round.name);
        const bucket = buckets.get(rid) ?? { name: round.name, groups: new Set<string>(), orders: [], mentions: [], vague: 0 };
        bucket.groups.add(group(exp));
        bucket.orders.push(round.order);
        bucket.vague += round.vague.length;
        for (const q of round.questions) bucket.mentions.push({ exp, q });
        buckets.set(rid, bucket);
      }
    }

    const rounds: BuiltRound[] = [];
    const skipped: SkippedRound[] = [];
    for (const [rid, bucket] of buckets) {
      const byKey = new Map<string, Mention[]>();
      for (const m of bucket.mentions) byKey.set(m.q.key, [...(byKey.get(m.q.key) ?? []), m]);
      if (byKey.size === 0 && bucket.groups.size < MIN_ROUND_ACCOUNTS) {
        skipped.push({ role, round: bucket.name, accounts: bucket.groups.size, reason: `Reported by ${plural(bucket.groups.size, "account")} with no explicit question. Kept in evidence.json.` });
        continue;
      }
      const questions = [...byKey.values()].map((mentions, appearance) => {
        const first = mentions[0]!;
        const groups = new Set(mentions.map((m) => group(m.exp)));
        const sourceIds = [...new Set(mentions.map((m) => m.exp.source))];
        const texts = new Set(mentions.map((m) => cleanText(m.q.text).toLowerCase()));
        if (texts.size > 1) issues.push(`${slug}/${rid}: "${first.q.key}" is worded ${texts.size} ways across ${mentions.length} accounts; the first wording is used. Check the merge.`);
        const review = mentions.every((m) => m.q.review === true);
        const note = mentions.find((m) => m.q.reviewNote)?.q.reviewNote;
        // A practice link survives only when every account that names one agrees.
        const links = new Set(mentions.map((m) => m.q.practiceUrl ?? null).filter((u): u is string => Boolean(u)));
        const difficulty = mentions.find((m) => m.q.difficulty)?.q.difficulty ?? null;
        const q: BuiltQuestion = {
          id: first.q.key,
          text: cleanText(first.q.text),
          category: first.q.category,
          difficulty,
          practiceUrl: links.size === 1 ? [...links][0]! : null,
          reports: groups.size,
          review,
          ...(review && note ? { reviewNote: note } : {}),
          sources: sourceIds,
          mentions: mentions.length,
        };
        return { q, appearance };
      });
      questions.sort((a, b) => b.q.reports - a.q.reports || a.appearance - b.appearance);
      rounds.push({ id: rid, name: bucket.name, reports: bucket.groups.size, order: median(bucket.orders), summary: notes.rounds[rid]?.trim() ?? "", questions: questions.map((x) => x.q), vague: bucket.vague });
    }
    // The order candidates usually meet the rounds; ties: the more reported first.
    rounds.sort((a, b) => a.order - b.order || b.reports - a.reports || a.name.localeCompare(b.name, "en", { numeric: true }));
    for (const rid of Object.keys(notes.rounds)) if (!rounds.some((r) => r.id === rid)) issues.push(`roleNotes.${slug}.rounds.${rid}: no such round on this role's page.`);

    const all = rounds.flatMap((r) => r.questions);
    const review = all.filter((q) => q.review).length;
    const accounts = new Set(exps.map(group)).size;
    const period = yearRange(exps.map((e) => sources.get(e.source)!.reportedDate));
    const confident = all.length - review;
    const built: BuiltRole = {
      role,
      slug,
      notes,
      experiences: exps,
      accounts,
      period,
      rounds,
      skipped,
      sequences: [...sequences.values()].map((s) => ({ steps: s.steps, reports: s.groups.size })).sort((a, b) => b.reports - a.reports || a.steps.length - b.steps.length),
      questions: all.length,
      confident,
      review,
      mentions: all.reduce((n, q) => n + q.mentions, 0),
      page: null,
      reason: "",
    };
    if (accounts < MIN_ROLE_ACCOUNTS || confident < MIN_ROLE_QUESTIONS) {
      built.reason = `${plural(accounts, "independent account")} and ${plural(confident, "confident question")}; a page needs at least ${MIN_ROLE_ACCOUNTS} accounts and ${MIN_ROLE_QUESTIONS} questions. Kept in the research until more accounts are found.`;
    } else {
      for (const r of rounds) if (!r.summary) issues.push(`${slug}/${r.id}: no round summary (roleNotes.${slug}.rounds.${r.id}).`);
      const override = ev.overrides[slug];
      const name = `${ev.company} ${role}`;
      const advice: PackagePage["advice"] = override ?? {
        indexing: "HOLD",
        reason: `${plural(accounts, "independent candidate account")}, ${plural(rounds.length, "round")}, ${plural(confident, "confident question")}. Publish for readers; check search demand (OpenSEO) before opting it into the index.`,
      };
      const guide: InterviewGuide & { rounds: PackagePage["guide"]["rounds"] } = {
        accounts,
        period,
        researched: ev.researched ?? "",
        highlights: notes.highlights.map(cleanText).filter(Boolean),
        preparation: notes.preparation.map(cleanText).filter(Boolean),
        official: ev.companyNotes.official.filter((o) => o.roles.includes(slug)).map((o) => ({ title: o.title, url: o.url, points: o.points })),
        sequences: built.sequences.slice(0, 40),
        rounds: rounds.map((r) => ({ id: r.id, name: r.name, reports: r.reports, summary: r.summary, questions: r.questions.map(({ mentions: _mentions, ...q }) => q) })),
      };
      built.page = {
        role,
        slug: slugify(`${ev.company} ${role}`),
        title: `${name} Interview Experiences`,
        excerpt: fit(notes.summary?.trim() || `Interview rounds and questions reported by ${plural(accounts, "candidate")} in their own ${name} interviews${period ? ` (${period})` : ""}.`, 600),
        seoTitle: fit(`${name} Interview Questions & Experiences`, 70),
        seoDescription: fit(`Rounds and questions ${plural(accounts, "candidate")} reported from ${name} interviews${period ? ` (${period})` : ""}: ${rounds.slice(0, 4).map((r) => r.name).join(", ")} and more. Candidate-reported, not official.`, 160),
        advice,
        guide,
      };
    }
    roles.push(built);
  }
  roles.sort((a, b) => (a.role === UNSPECIFIED_ROLE ? 1 : b.role === UNSPECIFIED_ROLE ? -1 : a.role.localeCompare(b.role, "en", { numeric: true })));

  const included = roles.filter((r) => r.page);
  let pkg: ImportPackage | null = null;
  if (included.length) {
    const exps = included.flatMap((r) => r.experiences);
    const accounts = new Set(exps.map(group)).size;
    const period = yearRange(exps.map((e) => sources.get(e.source)!.reportedDate));
    const companyAdvice: Advice = ev.overrides[COMPANY_KEY]?.indexing ?? "HOLD";
    const companyPage: PackagePage = {
      role: null,
      slug: slugify(ev.company),
      title: `${ev.company} Interview Experiences`,
      excerpt: fit(ev.companyNotes.summary?.trim() || `What candidates report about ${ev.company} interviews, role by role: the rounds they had and the questions they were asked.`, 600),
      seoTitle: fit(`${ev.company} Interview Experiences by Role`, 70),
      seoDescription: fit(`${ev.company} interview rounds and questions reported by ${plural(accounts, "candidate")}, for ${included.map((r) => r.role).join(", ")}. Candidate-reported, with what ${ev.company} publishes officially.`, 160),
      advice: { indexing: companyAdvice, reason: ev.overrides[COMPANY_KEY]?.reason ?? "A hub for the role pages. Keep it out of the index until the role pages show search impressions." },
      guide: {
        accounts,
        period,
        researched: ev.researched ?? "",
        highlights: ev.companyNotes.highlights.map(cleanText).filter(Boolean),
        preparation: [],
        official: ev.companyNotes.official.map((o) => ({ title: o.title, url: o.url, points: o.points })),
        sequences: [],
        rounds: [],
      },
    };
    const used = new Set(included.flatMap((r) => r.page!.guide.rounds.flatMap((round) => round.questions.flatMap((q) => q.sources))));
    pkg = {
      format: IMPORT_FORMAT,
      version: IMPORT_VERSION,
      researchRun: ev.researchRun,
      company: ev.company,
      sources: ev.sources.filter((s) => used.has(s.id)).map((s) => ({ id: s.id, url: s.url, kind: s.kind, tier: s.tier, independenceGroup: s.independenceGroup })),
      pages: [companyPage, ...included.map((r) => r.page!)],
      notIncluded: roles.filter((r) => !r.page).map((r) => ({ role: r.role, accounts: r.accounts, questions: r.questions, reason: r.reason })),
    };
  }
  return { build: { company: ev.company, researchRun: ev.researchRun, evidence: ev, roles, pkg, unresolved, issues }, errors: [] };
}
