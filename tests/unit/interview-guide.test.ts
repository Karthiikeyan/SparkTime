import { describe, expect, it } from "vitest";
import { formatForAI, formatList, type CopyRound } from "@/lib/interviews/copy";
import { coerceGuide, countCategories, DEFAULT_INTERVIEW_CATEGORIES, guideSearchText, heldQuestions, practiceProblemUrl, publicGuide, readGuide, roundId } from "@/lib/interviews/guide";
import { normalizeFieldDefinitions, propertySearchText, validateProperties } from "@/lib/content/properties";

const q = (id: string, text: string, over: Record<string, unknown> = {}) => ({ id, text, category: "dsa", difficulty: null, practiceUrl: null, reports: 1, review: false, ...over });
const guide = (rounds: unknown[], over: Record<string, unknown> = {}) => ({ accounts: 5, period: "2024–2026", researched: "2026-10-07", highlights: [], preparation: [], official: [], sequences: [], rounds, ...over });

describe("interview guide values", () => {
  it("cleans what an editor types and drops rows still being typed", () => {
    const result = coerceGuide(
      guide([{ name: "  Technical   Round 1 ", reports: 3, summary: "Two problems.\r\n\r\n\r\nThen LP.", questions: [q("lru", "  Design an\tLRU cache "), q("blank", "   ")] }], {
        highlights: ["  One ", "", "Two"],
        official: [{ title: "", url: "", points: [] }, { title: "Acme: how we hire", url: "https://acme.example/hire", points: ["Three interviews.", ""] }],
      }),
      DEFAULT_INTERVIEW_CATEGORIES,
      "draft",
    );
    expect(result).toEqual({
      value: guide([{ id: "technical-round-1", name: "Technical Round 1", reports: 3, summary: "Two problems.\n\nThen LP.", questions: [q("lru", "Design an LRU cache")] }], {
        highlights: ["One", "Two"],
        official: [{ title: "Acme: how we hire", url: "https://acme.example/hire", points: ["Three interviews."] }],
      }),
    });
  });

  it("refuses what would break the page: unknown categories, duplicate ids or rounds, insecure links", () => {
    const err = (g: unknown) => ("error" in coerceGuide(g, DEFAULT_INTERVIEW_CATEGORIES, "draft") ? (coerceGuide(g, DEFAULT_INTERVIEW_CATEGORIES, "draft") as { error: string }).error : "");
    expect(err(guide([{ name: "R1", questions: [q("a", "x", { category: "astrology" })] }]))).toMatch(/categories/);
    expect(err(guide([{ name: "R1", questions: [q("a", "x"), q("a", "y")] }]))).toMatch(/used twice/);
    expect(err(guide([{ name: "R1" }, { name: "r1" }]))).toMatch(/Two rounds/);
    expect(err(guide([{ name: "R1", questions: [q("a", "x", { practiceUrl: "http://leetcode.com/problems/x/" })] }]))).toMatch(/https/);
    expect(err(guide([], { official: [{ title: "T", url: "javascript:alert(1)", points: [] }] }))).toMatch(/https/);
    expect(err(guide([], { researched: "yesterday" }))).toMatch(/date/);
  });

  it("never blocks publishing on review: questions marked for review are held back from readers instead", () => {
    const g = guide([{ name: "R1", questions: [q("a", "uncertain wording", { review: true }), q("b", "confirmed")] }, { name: "R2", summary: "Format only.", questions: [q("c", "also uncertain", { review: true })] }]);
    const draft = coerceGuide(g, DEFAULT_INTERVIEW_CATEGORIES, "draft");
    const publish = coerceGuide(g, DEFAULT_INTERVIEW_CATEGORIES, "publish");
    expect(publish).toEqual(draft);
    if (!("value" in publish)) throw new Error("expected a value");
    // The stored guide keeps every question and its flag, for the Studio.
    expect(heldQuestions(publish.value)).toBe(2);
    // Readers get only reviewed questions; a round whose questions are all held keeps its summary.
    const shown = publicGuide(publish.value);
    expect(shown.rounds.map((r) => [r.name, r.questions.map((x) => x.id)])).toEqual([
      ["R1", ["b"]],
      ["R2", []],
    ]);
    expect(shown.rounds[1]!.summary).toBe("Format only.");
    expect(heldQuestions(shown)).toBe(0);
    // Held text never reaches site search.
    expect(guideSearchText(publish.value)).toContain("confirmed");
    expect(guideSearchText(publish.value)).not.toMatch(/uncertain/);
    // Nothing held: the same object back (no copying on the hot path).
    const clean = readGuide(guide([{ name: "R1", questions: [q("a", "x")] }]));
    expect(publicGuide(clean)).toBe(clean);
  });

  it("is a field type of its own: one per type, with categories, validated through the property pipeline", () => {
    const def = { key: "guide", label: "Interview guide", type: "interview_guide", options: { choices: DEFAULT_INTERVIEW_CATEGORIES } };
    expect(normalizeFieldDefinitions([def]).errors).toEqual([]);
    expect(normalizeFieldDefinitions([def, { ...def, key: "other" }]).errors.join()).toMatch(/only one interview guide/);
    expect(normalizeFieldDefinitions([{ ...def, options: { choices: [] } }]).errors.join()).toMatch(/category/);
    const fields = normalizeFieldDefinitions([def]).fields;
    const value = guide([{ name: "R1", questions: [q("a", "Design an LRU cache")] }]);
    expect(validateProperties(fields, { guide: value }, "draft").errors).toEqual({});
    expect(validateProperties(fields, { guide: "not a guide" }, "draft").errors).toEqual({ guide: "Must be an interview guide." });
    // Round names and question text make the page findable in site search.
    expect(propertySearchText(fields, { guide: value as never })).toContain("R1 Design an LRU cache");
  });

  it("reads stored values leniently, counts categories in the field's order", () => {
    expect(readGuide(null).rounds).toEqual([]);
    expect(readGuide({ rounds: [{ id: "r", name: "R", questions: [{ id: "a", text: "x", difficulty: "weird" }] }] }).rounds[0]!.questions[0]).toMatchObject({ category: "other", difficulty: null, reports: 0 });
    expect(countCategories([{ category: "behavioral" }, { category: "dsa" }, { category: "dsa" }, { category: "mystery" }], DEFAULT_INTERVIEW_CATEGORIES)).toEqual([
      { value: "dsa", label: "DSA / Coding", count: 2 },
      { value: "behavioral", label: "Behavioral", count: 1 },
      { value: "mystery", label: "mystery", count: 1 },
    ]);
    expect(roundId("Bar Raiser / LP")).toBe("bar-raiser-lp");
    expect(practiceProblemUrl("https://leetcode.com/problems/lru-cache/description/")).toBe("https://leetcode.com/problems/lru-cache/");
    expect(practiceProblemUrl("https://example.com/x")).toBeNull();
  });
});

describe("copy for AI", () => {
  const rounds: CopyRound[] = [
    { name: "Technical Round 1", questions: [{ text: "Design an LRU cache", category: "dsa", categoryLabel: "DSA / Coding" }, { text: "Tell me about a missed deadline.", category: "behavioral", categoryLabel: "Behavioral" }] },
    { name: "Online Assessment", questions: [] },
    { name: "Bar Raiser", questions: [{ text: "Tell me about a disagreement.", category: "behavioral", categoryLabel: "Behavioral" }] },
  ];
  const ctx = { company: "Amazon", role: "SDE 1", url: "https://example.test/interviews/amazon-sde-1", scope: "" };

  it("is a complete prompt: context, coaching, questions numbered across rounds with their topic, the source", () => {
    const text = formatForAI(ctx, rounds);
    expect(text.startsWith("I'm preparing for my Amazon SDE 1 interview. ")).toBe(true);
    expect(text).toContain("Below are 3 interview questions that candidates have publicly reported from their own Amazon SDE 1 interviews, grouped by round.");
    expect(text).toContain("The wording is the candidates' recollection, not an official question.");
    expect(text).toContain("wait for my answer before giving feedback or a solution");
    expect(text).toContain("never invent experiences for me");
    expect(text).toContain("Amazon's published values or leadership principles");
    expect(text).toContain("Questions:\n\nTechnical Round 1\n1. [DSA / Coding] Design an LRU cache\n2. [Behavioral] Tell me about a missed deadline.\n\nBar Raiser\n3. [Behavioral] Tell me about a disagreement.");
    // An empty round is not listed; coaching for a kind of question that isn't there is left out.
    expect(text).not.toContain("Online Assessment");
    expect(text).not.toContain("Design questions:");
    expect(text).toContain("Source: https://example.test/interviews/amazon-sde-1");
    expect(text.endsWith("Start with question 1.")).toBe(true);
  });

  it("names a narrowed selection and adapts to one question", () => {
    const text = formatForAI({ ...ctx, scope: "Bar Raiser · Behavioral" }, [rounds[2]!]);
    expect(text).toContain("Below is 1 interview question that candidates have publicly reported from their own Amazon SDE 1 interviews (Bar Raiser · Behavioral)");
    expect(text).not.toContain("Coding and technical questions:");
  });

  it("copies a plain list for notes", () => {
    expect(formatList(ctx, rounds)).toBe(
      "Amazon SDE 1 — interview questions reported by candidates\n\nTechnical Round 1\n1. Design an LRU cache\n2. Tell me about a missed deadline.\n\nBar Raiser\n3. Tell me about a disagreement.\n\nSource: https://example.test/interviews/amazon-sde-1",
    );
  });
});
