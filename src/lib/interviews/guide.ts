/**
 * Interview guides: the value of an `interview_guide` property.
 *
 * One document per company × role holds that role's guide: what candidates
 * reported about the process (how many accounts, which rounds, in which
 * sequences), each round with what candidates describe and the questions
 * they reported, plus anything the company publishes officially. A document
 * with no role is the company's page and uses only the company-level parts
 * (official information, counts).
 *
 * Pure and isomorphic: the server validates with it; the studio editor, the
 * importer and the public page share its shapes and helpers. Evidence (quotes,
 * source URLs) never lives here; it stays in research/interviews/…, and every
 * question keeps the research key it was built from.
 */
import type { SelectOption } from "../content/model";
import { safeExternalUrl } from "../url";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export type GuideQuestion = {
  /** Stable research key ("course-schedule-ii"); unique within its round. */
  id: string;
  text: string;
  /** One of the field's category choices. */
  category: string;
  /** Only when a source states it. */
  difficulty: Difficulty | null;
  /** Only when the candidate linked it or named the problem exactly. */
  practiceUrl: string | null;
  /** Independent candidate accounts that reported it in this round. */
  reports: number;
  /** Needs a human decision. Held back from the public page (publicGuide) until cleared. */
  review: boolean;
};

export type GuideRound = {
  /** Slug of the round name; the page's #round-{id} anchor. */
  id: string;
  name: string;
  /** Independent accounts that reported having this round (with or without questions). */
  reports: number;
  /** What candidates describe about the round: format, length, focus. Candidate-reported. */
  summary: string;
  questions: GuideQuestion[];
};

export type OfficialNote = { title: string; url: string; points: string[] };
export type ReportedSequence = { steps: string[]; reports: number };

export type InterviewGuide = {
  /** Independent candidate accounts behind the page. */
  accounts: number;
  /** Years the accounts cover, as the sources state them ("2021–2026"); "" when unknown. */
  period: string;
  /** When the research was done (YYYY-MM-DD); "" when unknown. */
  researched: string;
  /** Patterns across the accounts, written from the evidence. Candidate-reported. */
  highlights: string[];
  /** Preparation candidates say they used. Candidate-reported. */
  preparation: string[];
  /** What the company itself publishes, with the page it comes from. The only official information. */
  official: OfficialNote[];
  /** Round sequences candidates reported, most reported first. */
  sequences: ReportedSequence[];
  /** In the order candidates usually meet them. */
  rounds: GuideRound[];
};

export const GUIDE_LIMITS = { rounds: 30, questions: 400, text: 500, summary: 1500, note: 400, notes: 12, official: 10, points: 12, sequences: 40, steps: 12, reports: 9999 } as const;
export const QUESTION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const ROUND_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The starting taxonomy. Choices live on the field, so the list can change in Content types without code. */
export const DEFAULT_INTERVIEW_CATEGORIES: SelectOption[] = [
  { value: "dsa", label: "DSA / Coding" },
  { value: "system-design", label: "System Design" },
  { value: "behavioral", label: "Behavioral" },
  { value: "java", label: "Java" },
  { value: "spring-boot", label: "Spring Boot" },
  { value: "sql", label: "SQL" },
  { value: "react", label: "React" },
  { value: "javascript", label: "JavaScript" },
  { value: "backend", label: "Backend" },
  { value: "devops", label: "DevOps" },
  { value: "other", label: "Other" },
];

/** The fixed statement on every interview page: what it is, and what it isn't. */
export const CANDIDATE_REPORTED_NOTE =
  "Everything here except the section marked official comes from candidates' public accounts of their own interviews. Processes vary by team, location and year, so this is not the company's official process or a complete list.";

export const emptyGuide = (): InterviewGuide => ({ accounts: 0, period: "", researched: "", highlights: [], preparation: [], official: [], sequences: [], rounds: [] });

/** Trim, drop control characters and collapse runs of whitespace. */
export function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Like cleanText, but keeps line breaks (summaries). */
function cleanParagraphs(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && (DIFFICULTIES as readonly string[]).includes(value);
}

/** Lowercase slug for a round name ("Technical Round 1" → "technical-round-1"). */
export function roundId(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Conservative duplicate key: case, punctuation and spacing only. Different
 * wording stays different — merging meaningfully different questions is a
 * human decision, never automatic.
 */
export function questionKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A LeetCode problem page, normalised to https://leetcode.com/problems/{slug}/. */
export function leetCodeProblemUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^https:\/\/(?:www\.)?leetcode\.com\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?(?:description\/?)?$/.exec(value.trim());
  return match ? `https://leetcode.com/problems/${match[1]}/` : null;
}

/**
 * Practice links research may carry: a LeetCode problem page, or a
 * GeeksforGeeks problem page (/problems/…) or article (/dsa/…) when the
 * candidate linked one. Anything else is dropped with a warning.
 */
export function practiceProblemUrl(value: unknown): string | null {
  const leetCode = leetCodeProblemUrl(value);
  if (leetCode) return leetCode;
  if (typeof value !== "string") return null;
  const gfg = /^https:\/\/(?:www\.)?geeksforgeeks\.org\/(problems|dsa)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(?:0|1))?\/?$/.exec(value.trim());
  if (!gfg) return null;
  return gfg[1] === "problems" ? `https://www.geeksforgeeks.org/problems/${gfg[2]}/1` : `https://www.geeksforgeeks.org/dsa/${gfg[2]}/`;
}

type Result<T> = { value: T } | { error: string };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const count = (v: unknown): number | null => (v === undefined || v === null ? 0 : typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= GUIDE_LIMITS.reports ? v : null);

function lines(raw: unknown, at: string, max: number, maxLength: number): Result<string[]> {
  if (raw === undefined || raw === null) return { value: [] };
  if (!Array.isArray(raw)) return { error: `${at}: must be a list.` };
  const out = raw.map((v) => (typeof v === "string" ? cleanText(v) : "")).filter(Boolean);
  if (out.length > max) return { error: `${at}: at most ${max} items.` };
  if (out.some((v) => v.length > maxLength)) return { error: `${at}: each item at most ${maxLength} characters.` };
  return { value: out };
}

/**
 * Validates a guide. Rows still being typed (an empty question, an empty
 * official entry) are dropped so autosave never fails on them. Drafts and
 * publishing validate alike: a question still marked for review never blocks
 * publishing; it is held back from the public page instead (publicGuide).
 */
export function coerceGuide(raw: unknown, choices: SelectOption[] | undefined, _mode: "draft" | "publish"): Result<InterviewGuide> {
  const g = obj(raw);
  if (!g) return { error: "Must be an interview guide." };
  const accounts = count(g.accounts);
  if (accounts === null) return { error: "Candidate accounts must be a whole number." };
  const period = typeof g.period === "string" ? cleanText(g.period).slice(0, 40) : "";
  const researched = typeof g.researched === "string" ? cleanText(g.researched) : "";
  if (researched && !/^\d{4}-\d{2}-\d{2}$/.test(researched)) return { error: "Researched must be a date (YYYY-MM-DD)." };

  const highlights = lines(g.highlights, "Highlights", GUIDE_LIMITS.notes, GUIDE_LIMITS.note);
  if ("error" in highlights) return highlights;
  const preparation = lines(g.preparation, "Preparation", GUIDE_LIMITS.notes, GUIDE_LIMITS.note);
  if ("error" in preparation) return preparation;

  const official: OfficialNote[] = [];
  if (g.official !== undefined && g.official !== null) {
    if (!Array.isArray(g.official)) return { error: "Official information must be a list." };
    for (const [i, item] of g.official.entries()) {
      const o = obj(item);
      const at = `Official source ${i + 1}`;
      if (!o) return { error: `${at}: must be an object.` };
      const title = typeof o.title === "string" ? cleanText(o.title) : "";
      const rawUrl = typeof o.url === "string" ? o.url.trim() : "";
      const points = lines(o.points, `${at} points`, GUIDE_LIMITS.points, GUIDE_LIMITS.note);
      if ("error" in points) return points;
      if (!title && !rawUrl && !points.value.length) continue;
      if (!title || title.length > 200) return { error: `${at}: give it a title (at most 200 characters).` };
      const url = safeExternalUrl(rawUrl);
      if (!url || !url.startsWith("https://")) return { error: `${at}: the link must be an https URL.` };
      official.push({ title, url, points: points.value });
    }
    if (official.length > GUIDE_LIMITS.official) return { error: `At most ${GUIDE_LIMITS.official} official sources.` };
  }

  const sequences: ReportedSequence[] = [];
  if (g.sequences !== undefined && g.sequences !== null) {
    if (!Array.isArray(g.sequences)) return { error: "Reported sequences must be a list." };
    for (const item of g.sequences) {
      const s = obj(item);
      const steps = s ? lines(s.steps, "A reported sequence", GUIDE_LIMITS.steps, 80) : { error: "A reported sequence must be an object." };
      if ("error" in steps) return steps;
      const reports = count(s?.reports);
      if (reports === null) return { error: "A reported sequence's count must be a whole number." };
      if (steps.value.length) sequences.push({ steps: steps.value, reports });
    }
    if (sequences.length > GUIDE_LIMITS.sequences) return { error: `At most ${GUIDE_LIMITS.sequences} reported sequences.` };
  }

  const categories = new Set((choices ?? []).map((c) => c.value));
  const rounds: GuideRound[] = [];
  const roundIds = new Set<string>();
  let total = 0;
  if (g.rounds !== undefined && g.rounds !== null) {
    if (!Array.isArray(g.rounds)) return { error: "Rounds must be a list." };
    if (g.rounds.length > GUIDE_LIMITS.rounds) return { error: `At most ${GUIDE_LIMITS.rounds} rounds.` };
    for (const [r, item] of g.rounds.entries()) {
      const round = obj(item);
      if (!round) return { error: `Round ${r + 1}: must be an object.` };
      const name = typeof round.name === "string" ? cleanText(round.name) : "";
      if (!name || name.length > 80) return { error: `Round ${r + 1}: give it a name (at most 80 characters).` };
      const id = typeof round.id === "string" && round.id.trim() ? round.id.trim() : roundId(name);
      if (!ROUND_ID_PATTERN.test(id) || id.length > 60) return { error: `${name}: its id must be lowercase letters, numbers and dashes.` };
      if (roundIds.has(id)) return { error: `Two rounds are both "${id}". Give each round its own name.` };
      roundIds.add(id);
      const reports = count(round.reports);
      if (reports === null) return { error: `${name}: candidate accounts must be a whole number.` };
      const summary = typeof round.summary === "string" ? cleanParagraphs(round.summary) : "";
      if (summary.length > GUIDE_LIMITS.summary) return { error: `${name}: the summary is at most ${GUIDE_LIMITS.summary} characters.` };
      if (round.questions !== undefined && !Array.isArray(round.questions)) return { error: `${name}: questions must be a list.` };
      const questions: GuideQuestion[] = [];
      const ids = new Set<string>();
      for (const [index, entry] of ((round.questions as unknown[] | undefined) ?? []).entries()) {
        const at = `${name}, question ${index + 1}`;
        const q = obj(entry);
        if (!q) return { error: `${at}: must be an object.` };
        const text = typeof q.text === "string" ? cleanText(q.text) : "";
        if (!text) continue;
        const qid = typeof q.id === "string" ? q.id.trim() : "";
        if (!QUESTION_ID_PATTERN.test(qid)) return { error: `${at}: id must be 1–40 lowercase letters, numbers, "-" or "_".` };
        if (ids.has(qid)) return { error: `${at}: id "${qid}" is used twice in this round.` };
        ids.add(qid);
        if (text.length > GUIDE_LIMITS.text) return { error: `${at}: at most ${GUIDE_LIMITS.text} characters.` };
        const category = typeof q.category === "string" ? q.category : "";
        if (!categories.has(category)) return { error: `${at}: choose one of the listed categories.` };
        const difficulty = q.difficulty === null || q.difficulty === undefined || q.difficulty === "" ? null : q.difficulty;
        if (difficulty !== null && !isDifficulty(difficulty)) return { error: `${at}: difficulty must be Easy, Medium or Hard (or empty).` };
        let practiceUrl: string | null = null;
        if (q.practiceUrl !== null && q.practiceUrl !== undefined && q.practiceUrl !== "") {
          practiceUrl = safeExternalUrl(q.practiceUrl);
          if (!practiceUrl || !practiceUrl.startsWith("https://")) return { error: `${at}: the practice link must be an https URL.` };
        }
        const qReports = count(q.reports);
        if (qReports === null) return { error: `${at}: reports must be a whole number.` };
        questions.push({ id: qid, text, category, difficulty, practiceUrl, reports: qReports, review: q.review === true });
      }
      total += questions.length;
      rounds.push({ id, name, reports, summary, questions });
    }
  }
  if (total > GUIDE_LIMITS.questions) return { error: `At most ${GUIDE_LIMITS.questions} questions per guide.` };
  return { value: { accounts, period, researched, highlights: highlights.value, preparation: preparation.value, official, sequences, rounds } };
}

/** Lenient read of a stored value for display (stored values were validated on save). */
export function readGuide(value: unknown): InterviewGuide {
  const g = obj(value);
  if (!g) return emptyGuide();
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    accounts: num(g.accounts),
    period: typeof g.period === "string" ? g.period : "",
    researched: typeof g.researched === "string" ? g.researched : "",
    highlights: strings(g.highlights),
    preparation: strings(g.preparation),
    official: (Array.isArray(g.official) ? g.official : []).flatMap((o) => {
      const x = obj(o);
      return x && typeof x.title === "string" && typeof x.url === "string" ? [{ title: x.title, url: x.url, points: strings(x.points) }] : [];
    }),
    sequences: (Array.isArray(g.sequences) ? g.sequences : []).flatMap((s) => {
      const x = obj(s);
      return x ? [{ steps: strings(x.steps), reports: num(x.reports) }] : [];
    }),
    rounds: (Array.isArray(g.rounds) ? g.rounds : []).flatMap((r) => {
      const x = obj(r);
      if (!x || typeof x.name !== "string") return [];
      const questions = (Array.isArray(x.questions) ? x.questions : []).flatMap((q) => {
        const y = obj(q);
        return y && typeof y.id === "string" && typeof y.text === "string"
          ? [{ id: y.id, text: y.text, category: typeof y.category === "string" ? y.category : "other", difficulty: isDifficulty(y.difficulty) ? y.difficulty : null, practiceUrl: typeof y.practiceUrl === "string" ? y.practiceUrl : null, reports: num(y.reports), review: y.review === true }]
          : [];
      });
      return [{ id: typeof x.id === "string" && x.id ? x.id : roundId(x.name), name: x.name, reports: num(x.reports), summary: typeof x.summary === "string" ? x.summary : "", questions }];
    }),
  };
}

export type CategoryCount = { value: string; label: string; count: number };

/** Counts per category in the field's order (unknown categories last, by their value). */
export function countCategories(questions: Array<Pick<GuideQuestion, "category">>, choices: SelectOption[] | undefined): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const q of questions) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const out: CategoryCount[] = [];
  for (const c of choices ?? []) {
    const n = counts.get(c.value);
    if (n) out.push({ value: c.value, label: c.label, count: n });
    counts.delete(c.value);
  }
  for (const [value, n] of counts) out.push({ value, label: value, count: n });
  return out;
}

/**
 * The guide as readers get it: questions still marked "Needs review" are held
 * back (not shown, counted, searched or copied) until the owner clears the
 * flag. Rounds stay, so a round whose questions are all held still shows its
 * summary. Every public read goes through this (interviewFacts, card facts,
 * search text); the Studio reads the full guide.
 */
export function publicGuide(guide: InterviewGuide): InterviewGuide {
  if (!guide.rounds.some((r) => r.questions.some((q) => q.review))) return guide;
  return { ...guide, rounds: guide.rounds.map((r) => ({ ...r, questions: r.questions.filter((q) => !q.review) })) };
}

/** Questions held back from the public page until reviewed. */
export function heldQuestions(guide: Pick<InterviewGuide, "rounds">): number {
  return guide.rounds.reduce((n, r) => n + r.questions.filter((q) => q.review).length, 0);
}

export function guideQuestions(guide: Pick<InterviewGuide, "rounds">): GuideQuestion[] {
  return guide.rounds.flatMap((r) => r.questions);
}

export function guideStats(guide: InterviewGuide, choices?: SelectOption[]) {
  const questions = guideQuestions(guide);
  return {
    rounds: guide.rounds.length,
    questions: questions.length,
    review: questions.filter((q) => q.review).length,
    multiple: questions.filter((q) => q.reports >= 2).length,
    byCategory: countCategories(questions, choices),
  };
}

/** Text that makes a guide findable in site search: round names and question text. */
export function guideSearchText(value: unknown): string {
  const guide = publicGuide(readGuide(value));
  return [...guide.rounds.flatMap((r) => [r.name, ...r.questions.map((q) => q.text)]), ...guide.highlights].join(" ").slice(0, 20000);
}

/** "18 candidate accounts", "1 candidate account". */
export function accountsLabel(n: number): string {
  return `${n} candidate ${n === 1 ? "account" : "accounts"}`;
}

/** The most-reported sequence, when one stands out (reported by at least two accounts). */
export function commonSequence(guide: Pick<InterviewGuide, "sequences">): ReportedSequence | null {
  const top = guide.sequences[0];
  return top && top.reports >= 2 ? top : null;
}
