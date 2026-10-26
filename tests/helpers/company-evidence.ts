/**
 * A small company evidence file (format interview-company-evidence) for the
 * research, import and page tests. "Acme" has:
 *  - SDE 1: four independent accounts (one syndicated copy that must count once,
 *    one with an unidentified round), enough for a page;
 *  - SDE 2: one account (too thin for a page);
 *  - one account with no level (never guessed into a role).
 */
const source = (id: string, over: Record<string, unknown> = {}) => ({ id, url: `https://leetcode.com/discuss/post/${id}/`, title: `Account ${id}`, kind: "leetcode", tier: "first-hand", reportedDate: "Feb 2025", accessed: "2026-10-07", independenceGroup: id, ...over });
const mention = (key: string, text: string, over: Record<string, unknown> = {}) => ({ key, text, category: "dsa", quote: text, roundContext: "Round 1", ...over });
const round = (name: string, order: number, questions: unknown[], over: Record<string, unknown> = {}) => ({ name, order, attribution: "explicit", questions, vague: [], ...over });
const exp = (id: string, sourceId: string, role: string | null, rounds: unknown[], over: Record<string, unknown> = {}) => ({ id, source: sourceId, alsoOn: [], role, structure: [], rounds, preparation: [], ...over });

export function companyEvidence(over: Record<string, unknown> = {}) {
  return {
    format: "interview-company-evidence",
    version: 1,
    company: "Acme",
    researchRun: "2026-10-07-acme",
    researched: "2026-10-07",
    sources: [
      source("s1", { reportedDate: "Jan 2024" }),
      source("s2"),
      source("s3", { reportedDate: "Mar 2026" }),
      source("s3b", { url: "https://medium.com/copy-of-s3", kind: "medium", independenceGroup: "s3" }),
      source("s4"),
      source("s5"),
      source("s6"),
    ],
    experiences: [
      exp("e1", "s1", "SDE 1", [
        round("Online Assessment", 1, [], { vague: ["two medium problems"] }),
        round("Technical Round 1", 2, [
          mention("lru", "Design an LRU cache"),
          mention("two-sum", "Two sum"),
          mention("lp-deadline", "Tell me about a time you missed a deadline.", { category: "behavioral" }),
          mention("q-a", "Merge k sorted lists"),
          mention("q-b", "Find the median of a data stream"),
        ]),
        round("Bar Raiser", 3, [
          mention("lp-conflict", "Tell me about a disagreement with your manager.", { category: "behavioral" }),
          mention("lp-ownership", "Tell me about something you owned end to end.", { category: "behavioral", review: true, reviewNote: "Wording not remembered." }),
        ]),
      ]),
      exp("e2", "s2", "SDE 1", [
        round("Online Assessment", 1, []),
        round("Technical Round 1", 2, [
          mention("lru", "Design an LRU cache", { practiceUrl: "https://leetcode.com/problems/lru-cache/" }),
          mention("graph-q", "Count islands in a grid"),
          mention("q-c", "Rotting oranges"),
          mention("q-d", "Course schedule"),
        ]),
        round("Technical Round 2", 3, [mention("q-e", "Longest substring without repeating characters"), mention("q-f", "Word ladder", { practiceUrl: "https://example.com/word-ladder" })]),
      ]),
      exp("e3", "s3", "SDE 1", [round("Technical Round 1", 2, [mention("lru", "Design an LRU cache"), mention("q-g", "Trapping rain water")]), round("Final Round", 3, [])], { alsoOn: ["s3b"] }),
      // The round isn't known: kept in the evidence, never imported.
      exp("e6", "s6", "SDE 1", [round("Round 2", 2, [mention("mystery", "A question from an unnamed round")], { attribution: "uncertain" })]),
      // A different level: its own role, never merged with SDE 1 — and too thin for a page.
      exp("e4", "s4", "SDE 2", [round("System Design", 3, [mention("url", "Design a URL shortener", { category: "system-design" }), mention("cache", "Design a distributed cache", { category: "system-design" })])]),
      // No level stated: never guessed.
      exp("e5", "s5", null, [round("Technical Round 1", 2, [mention("a", "Question A"), mention("b", "Question B"), mention("c", "Question C")])]),
    ],
    excluded: [{ text: "Top 50 Acme questions", reason: "Compiled list." }],
    overrides: { "sde-1": { indexing: "INDEX", reason: "Role-level demand checked in OpenSEO." } },
    companyNotes: {
      summary: "What candidates report about Acme interviews.",
      highlights: ["Behavioural questions come up in every round."],
      official: [
        { title: "Acme: how we hire", url: "https://acme.example/hire", accessed: "2026-10-07", points: ["Three interviews of 45 minutes."], roles: [] },
        { title: "Acme: SDE 1 assessment", url: "https://acme.example/sde-1-oa", accessed: "2026-10-07", points: ["A 70-minute coding assessment."], roles: ["sde-1"] },
      ],
    },
    roleNotes: {
      "sde-1": {
        summary: "What four candidates reported about Acme SDE 1 interviews.",
        highlights: ["Most accounts describe two coding problems per round."],
        preparation: ["NeetCode 150."],
        caveats: ["Small sample."],
        review: [],
        rounds: { "online-assessment": "Two coding problems in about 70 minutes.", "technical-round-1": "Two DSA problems, sometimes with a behavioural question.", "technical-round-2": "Another DSA round.", "bar-raiser": "Mostly behavioural." },
      },
    },
    ...over,
  };
}
