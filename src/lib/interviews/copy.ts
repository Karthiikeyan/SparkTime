/**
 * What "Copy for AI" and "Copy list" put on the clipboard. Pure, so the
 * exact text is unit-tested and identical wherever it is produced.
 *
 * The prompt is written to be pasted as-is into ChatGPT, Claude or Gemini:
 * who the candidate is preparing for, where the questions come from (and that
 * the wording is a candidate's recollection), how to coach — attempt first,
 * feedback after, never an invented experience — then the questions numbered
 * continuously and grouped by round, each tagged with its topic so the
 * assistant can switch between coding, design and behavioural coaching.
 * Coaching lines are included only for the kinds of question present.
 */

export type CopyQuestion = { text: string; category: string; categoryLabel: string };
export type CopyRound = { name: string; questions: CopyQuestion[] };
export type CopyContext = {
  company: string;
  role: string;
  /** Absolute URL of the page the questions come from. */
  url: string;
  /** Describes a narrowed selection ("Technical Round 1 · DSA / Coding · matching "graph""); empty for everything. */
  scope: string;
};

const DESIGN = new Set(["system-design"]);
const BEHAVIORAL = new Set(["behavioral"]);
const NON_TECHNICAL = new Set([...DESIGN, ...BEHAVIORAL, "other"]);

const rounds = (list: CopyRound[]) => list.filter((r) => r.questions.length > 0);
export const copyCount = (list: CopyRound[]) => list.reduce((n, r) => n + r.questions.length, 0);

function target(ctx: CopyContext): string {
  return [ctx.company, ctx.role].filter(Boolean).join(" ");
}

function numbered(list: CopyRound[], tagged: boolean): string[] {
  const blocks: string[] = [];
  let n = 0;
  for (const round of rounds(list)) {
    blocks.push([round.name, ...round.questions.map((q) => `${++n}. ${tagged ? `[${q.categoryLabel}] ` : ""}${q.text}`)].join("\n"));
  }
  return blocks;
}

/** A prompt to paste into an AI assistant. */
export function formatForAI(ctx: CopyContext, list: CopyRound[]): string {
  const name = target(ctx);
  const questions = rounds(list).flatMap((r) => r.questions);
  const total = questions.length;
  const has = (pred: (q: CopyQuestion) => boolean) => questions.some(pred);
  const coaching = [
    "Ask me one question at a time, in order, the way an interviewer would, and wait for my answer before giving feedback or a solution.",
    has((q) => !NON_TECHNICAL.has(q.category))
      ? "Coding and technical questions: let me ask clarifying questions and explain my approach first. Then review my solution for correctness, edge cases and time/space complexity, and ask the follow-ups an interviewer would."
      : null,
    has((q) => DESIGN.has(q.category)) ? "Design questions: make me start from requirements, then push on trade-offs, scale and failure cases." : null,
    has((q) => BEHAVIORAL.has(q.category))
      ? `Behavioral questions: help me shape a STAR answer from my own experience. Ask me for the details; never invent experiences for me. Then challenge the answer with follow-ups${ctx.company ? `, and tell me which of ${ctx.company}'s published values or leadership principles it shows, if it has any` : ""}.`
      : null,
    "After each answer, tell me briefly what was strong, what was missing and what to practise next.",
  ].filter((line): line is string => Boolean(line));

  return [
    `I'm preparing for ${name ? `my ${name} interview` : "an interview"}. Below ${total === 1 ? "is 1 interview question" : `are ${total} interview questions`} that candidates have publicly reported from their own ${name || "interviews"}${name ? " interviews" : ""}${ctx.scope ? ` (${ctx.scope})` : ""}, grouped by round. The wording is the candidates' recollection, not an official question.`,
    `Act as my interview coach:\n${coaching.map((line) => `- ${line}`).join("\n")}`,
    "If I ask for a study plan instead, group the questions by topic and suggest an order to practise them.",
    `Questions:\n\n${numbered(list, true).join("\n\n")}`,
    ctx.url ? `Source: ${ctx.url}` : "",
    "Start with question 1.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The questions alone, for notes. */
export function formatList(ctx: CopyContext, list: CopyRound[]): string {
  const name = target(ctx);
  const heading = `${name ? `${name} — ` : ""}interview questions reported by candidates${ctx.scope ? ` (${ctx.scope})` : ""}`;
  return [heading, ...numbered(list, false), ctx.url ? `Source: ${ctx.url}` : ""].filter(Boolean).join("\n\n");
}
