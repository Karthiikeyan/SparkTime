import { describe, expect, it } from "vitest";
import { DEFAULT_INTERVIEW_CATEGORIES } from "@/lib/interviews/guide";
import { analysisErrors, analyzeImportPackage, indexFloor, type ImportPackage } from "@/lib/interviews/import-package";
import { buildCompanyImport, UNIDENTIFIED_ROUND, UNSPECIFIED_ROLE } from "@/lib/interviews/research";
import { renderRoleReadme, renderSummary } from "@/lib/interviews/research-report";
import { companyEvidence } from "../helpers/company-evidence";

function build(over: Record<string, unknown> = {}) {
  const result = buildCompanyImport(companyEvidence(over));
  expect(result.errors).toEqual([]);
  return result.build!;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("company research → import package", () => {
  it("makes one page per role with enough evidence, plus the company page; thin roles stay in the research", () => {
    const b = build();
    expect(b.pkg!.pages.map((p) => [p.role, p.slug])).toEqual([
      [null, "acme"],
      ["SDE 1", "acme-sde-1"],
    ]);
    expect(b.pkg!.notIncluded.map((n) => n.role)).toEqual(["SDE 2", UNSPECIFIED_ROLE]);
    expect(b.pkg!.notIncluded[0]!.reason).toMatch(/1 independent account/);
  });

  it("counts independent accounts: a syndicated copy counts once, everywhere", () => {
    const sde1 = build().pkg!.pages[1]!;
    expect(sde1.guide.accounts).toBe(4);
    const tr1 = sde1.guide.rounds.find((r) => r.id === "technical-round-1")!;
    expect(tr1.reports).toBe(3);
    // Merged by key within the round, most reported first, with the sources that establish it.
    expect(tr1.questions[0]).toMatchObject({ id: "lru", reports: 3, sources: ["s1", "s2", "s3"] });
    expect(tr1.questions[0]!.practiceUrl).toBe("https://leetcode.com/problems/lru-cache/");
  });

  it("keeps a round reported by several accounts without questions, drops a single unexplained one, never imports an unidentified round", () => {
    const b = build();
    const sde1 = b.pkg!.pages[1]!;
    expect(sde1.guide.rounds.map((r) => [r.name, r.reports, r.questions.length])).toEqual([
      ["Online Assessment", 2, 0],
      ["Technical Round 1", 3, 9],
      ["Bar Raiser", 1, 2],
      ["Technical Round 2", 1, 2],
    ]);
    expect(b.roles.find((r) => r.slug === "sde-1")!.skipped.map((s) => s.round)).toEqual(["Final Round"]);
    expect(b.unresolved.map((u) => u.text)).toEqual(["A question from an unnamed round"]);
    // Sequences use the normalised names, an unknown round included, and never claim one process.
    expect(sde1.guide.sequences.map((s) => s.steps.join(" > "))).toContain(UNIDENTIFIED_ROUND);
    expect(sde1.guide.sequences.every((s) => s.reports === 1)).toBe(true);
  });

  it("carries the researcher's notes: summaries per round, highlights, preparation and the official sources for each page", () => {
    const [company, sde1] = build().pkg!.pages;
    expect(sde1!.excerpt).toBe("What four candidates reported about Acme SDE 1 interviews.");
    expect(sde1!.guide.rounds[0]!.summary).toBe("Two coding problems in about 70 minutes.");
    expect(sde1!.guide.highlights).toEqual(["Most accounts describe two coding problems per round."]);
    expect(sde1!.guide.official.map((o) => o.title)).toEqual(["Acme: SDE 1 assessment"]);
    expect(company!.guide.official.map((o) => o.title)).toEqual(["Acme: how we hire", "Acme: SDE 1 assessment"]);
    expect(company!.guide.rounds).toEqual([]);
    expect(sde1!.guide.period).toBe("2024–2026");
    expect(sde1!.guide.researched).toBe("2026-10-07");
  });

  it("advice: an override replaces the computed advice; nothing is INDEX by itself", () => {
    const [company, sde1] = build().pkg!.pages;
    expect(sde1!.advice).toEqual({ indexing: "INDEX", reason: "Role-level demand checked in OpenSEO." });
    expect(company!.advice.indexing).toBe("HOLD");
    expect(build({ overrides: {} }).pkg!.pages[1]!.advice.indexing).toBe("HOLD");
  });

  it("refuses evidence that would mislead: advice per round, notes for unknown roles, a copy in another group, a compiled source", () => {
    const errors = (over: Record<string, unknown>) => buildCompanyImport(companyEvidence(over)).errors.join("\n");
    expect(errors({ overrides: { "sde-1/technical-round-1": { indexing: "HOLD", reason: "x" } } })).toMatch(/per page now/);
    expect(errors({ roleNotes: { "sde-9": { rounds: {} } } })).toMatch(/no role has that slug/);
    const ev = companyEvidence();
    (ev.sources as Array<Record<string, unknown>>)[3]!.independenceGroup = "elsewhere";
    expect(buildCompanyImport(ev).errors.join("\n")).toMatch(/must share s3's independenceGroup/);
    const compiled = companyEvidence();
    (compiled.sources as Array<Record<string, unknown>>)[0]!.tier = "compiled";
    expect(buildCompanyImport(compiled).errors.join("\n")).toMatch(/not first-hand/);
  });

  it("writes READMEs a reviewer can read: every question with its counts and review flags", () => {
    const b = build();
    const readme = renderRoleReadme(b, b.roles.find((r) => r.slug === "sde-1")!);
    expect(readme).toContain("**[NEEDS REVIEW]** Tell me about something you owned end to end.");
    expect(readme).toContain("Review: Wording not remembered.");
    expect(readme).toContain("| Online Assessment | 1 | 2 of 4 | 0 | 0 | 1 |");
    expect(renderSummary(b)).toContain("Questions whose round could not be determined");
  });
});

describe("the importer's package checks", () => {
  const pkg = () => clone(build().pkg!);

  it("passes what the build produces, leaving out a practice link that isn't a problem page", () => {
    const analysis = analyzeImportPackage(pkg(), DEFAULT_INTERVIEW_CATEGORIES);
    expect(analysis.errors).toEqual([]);
    expect(analysis.warnings.join("\n")).toMatch(/example\.com\/word-ladder.*left out/);
    const sde1 = analysis.pages[1]!;
    expect(sde1.stats).toMatchObject({ rounds: 4, questions: 13, review: 1, multiple: 1 });
    // What the CMS stores carries no evidence: no sources, no review notes.
    expect(JSON.stringify(sde1.guide)).not.toMatch(/"sources"|reviewNote|leetcode\.com\/discuss/);
    expect(sde1.review).toEqual([{ round: "Bar Raiser", text: "Tell me about something you owned end to end.", note: "Wording not remembered." }]);
  });

  it("catches a hand-edited count, a compiled source, an unknown category, two pages for one role and the earlier format", () => {
    const errors = (mutate: (p: ImportPackage) => void) => {
      const p = pkg();
      mutate(p);
      return analysisErrors(analyzeImportPackage(p, DEFAULT_INTERVIEW_CATEGORIES)).join("\n");
    };
    expect(errors((p) => (p.pages[1]!.guide.rounds[1]!.questions[0]!.reports = 5))).toMatch(/reports is 5 but its sources are 3 independent accounts/);
    expect(errors((p) => (p.sources[0]!.tier = "compiled"))).toMatch(/a question needs a candidate's own account/);
    expect(errors((p) => (p.pages[1]!.guide.rounds[1]!.questions[0]!.category = "astrology"))).toMatch(/isn't one of this site's categories/);
    expect(errors((p) => p.pages.push({ ...clone(p.pages[1]!), slug: "acme-sde-1-copy", role: "sde 1" }))).toMatch(/same role/);
    expect(errors((p) => (p.pages[1]!.guide.rounds[0]!.reports = 99))).toMatch(/more than the page's 4/);
    expect(analyzeImportPackage({ format: "interview-research-package", version: 1 }, DEFAULT_INTERVIEW_CATEGORIES).errors[0]).toMatch(/earlier format/);
  });

  it("keeps a page's problems to that page, and treats editorial concerns as warnings", () => {
    const p = pkg();
    p.pages[1]!.guide.rounds[1]!.questions[0]!.reports = 5;
    const a = analyzeImportPackage(p, DEFAULT_INTERVIEW_CATEGORIES);
    // The broken role page is stopped on its own; the package and the company page are not.
    expect(a.errors).toEqual([]);
    expect(Object.keys(a.pageErrors)).toEqual([p.pages[1]!.slug]);
    // Every question flagged for review is a warning (the page shows rounds without questions), not an error.
    const q = pkg();
    for (const r of q.pages[1]!.guide.rounds) for (const x of r.questions) x.review = true;
    const b = analyzeImportPackage(q, DEFAULT_INTERVIEW_CATEGORIES);
    expect(analysisErrors(b)).toEqual([]);
    expect(b.warnings.join("\n")).toMatch(/every question is marked for review/);
  });

  it("only lets research advice index a page that clears the build's own bar", () => {
    const pages = analyzeImportPackage(pkg(), DEFAULT_INTERVIEW_CATEGORIES).pages;
    const sde1 = pages[1]!;
    expect(indexFloor(sde1)).toEqual({ ok: true });
    expect(indexFloor({ ...sde1, guide: { ...sde1.guide, accounts: 2 } })).toMatchObject({ ok: false, reason: expect.stringMatching(/only 2 candidate accounts/) });
    expect(indexFloor({ ...sde1, stats: { ...sde1.stats, review: sde1.stats.questions - 9 } })).toMatchObject({ ok: false, reason: expect.stringMatching(/only 9 questions shown publicly/) });
    const company = pages[0]!;
    expect(indexFloor({ ...company, guide: { ...company.guide, official: [] } })).toMatchObject({ ok: false, reason: "no official source" });
  });
});
