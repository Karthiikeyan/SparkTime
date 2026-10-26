import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interviewFacts } from "@/lib/interviews/directory";
import { readGuide } from "@/lib/interviews/guide";
import type { Properties } from "@/lib/content/properties";
import { buildCompanyImport } from "@/lib/interviews/research";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { auditLogs, documents } from "@/server/db/schema";
import { runBulkChunk } from "@/server/services/content-ops";
import { getDocumentForEdit, runDocumentAction } from "@/server/services/documents";
import { previewInterviewImport, runInterviewImport } from "@/server/services/interview-import";
import { getDocumentByTypeAndSlug } from "@/server/services/public-content";
import { companyEvidence } from "../helpers/company-evidence";
import { createAdmin, createTestDb } from "../helpers/db";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
});
afterAll(() => ctx.close());

type Pkg = { company: string; pages: Array<{ slug: string; role: string | null; advice: { indexing: string }; guide: { accounts: number; rounds: Array<{ reports: number; questions: Array<{ id: string; review: boolean; reports: number }> }> } }> };
const pkg = (over: Record<string, unknown> = {}) => JSON.parse(JSON.stringify(buildCompanyImport(companyEvidence(over)).build!.pkg)) as Pkg;

async function importAll(p: unknown, options?: unknown) {
  const preview = await previewInterviewImport(admin, { package: p, options });
  expect(preview.errors).toEqual([]);
  return { preview, result: await runInterviewImport(admin, { package: p, options, token: preview.token }) };
}

const row = async (slug: string) => (await db.select().from(documents).where(eq(documents.slug, slug)))[0]!;

describe("Studio → Import: interview research", () => {
  let ids: Record<string, string> = {};

  it("previews every page and its result under the default choices, without writing anything", async () => {
    const preview = await previewInterviewImport(admin, { package: pkg() });
    expect(preview.ok).toBe(true);
    expect(preview.company).toBe("Acme");
    expect(preview.options).toEqual({ publication: "draft", indexing: "auto", pages: {} });
    expect(preview.items.map((i) => [i.role, i.action, i.slug, i.advice.indexing, i.result?.label, i.result?.robotsIndex])).toEqual([
      [null, "create", "acme", "HOLD", "Draft", "noindex"],
      ["SDE 1", "create", "acme-sde-1", "INDEX", "Draft", "index"],
    ]);
    expect(preview.items[1]).toMatchObject({ accounts: 4, questions: 13, review: 1 });
    expect(preview.items[1]!.indexNote).toMatch(/indexed once live \(Automatic follows the advice\)/);
    expect(preview.items[1]!.rounds.map((r) => r.name)).toEqual(["Online Assessment", "Technical Round 1", "Bar Raiser", "Technical Round 2"]);
    expect(preview.items[1]!.reviewItems).toEqual([{ round: "Bar Raiser", text: "Tell me about something you owned end to end.", note: "Wording not remembered." }]);
    expect(preview.totals).toMatchObject({ create: 2, publish: 0, unlisted: 0, draft: 2, indexed: 0, review: 1 });
    expect(preview.notIncluded.map((n) => n.role)).toEqual(["SDE 2", "Software Engineer (Level Unspecified)"]);
    expect(preview.warnings.join("\n")).toMatch(/word-ladder/);
    expect(await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, "acme-sde-1"))).toEqual([]);
  });

  it("imports drafts by default — a file never publishes — with the research's indexing advice", async () => {
    const { result } = await importAll(pkg());
    expect(result.failed).toEqual([]);
    expect(result.imported.map((i) => [i.title, i.created, i.outcome])).toEqual([
      ["Acme Interview Experiences", true, "Draft"],
      ["Acme SDE 1 Interview Experiences", true, "Draft"],
    ]);
    expect(result.affectsPublic).toBe(false);
    ids = Object.fromEntries(result.imported.map((i) => [i.title, i.id]));
    const sde1 = await row("acme-sde-1");
    expect([sde1.status, sde1.visibility, sde1.robotsIndex]).toEqual(["draft", "public", "index"]);
    expect(sde1.notes).toMatch(/research run 2026-10-07-acme.*Advice: INDEX/);
    const company = await row("acme");
    expect([company.status, company.visibility, company.robotsIndex]).toEqual(["draft", "public", "noindex"]);
    const doc = await getDocumentForEdit(admin, sde1.id);
    expect(doc.properties.company).toBe("Acme");
    expect(doc.properties.jobRole).toBe("SDE 1");
    const guide = readGuide(doc.properties.guide);
    expect(guide.rounds[1]!.questions[0]).toEqual({ id: "lru", text: "Design an LRU cache", category: "dsa", difficulty: null, practiceUrl: "https://leetcode.com/problems/lru-cache/", reports: 3, review: false });
    expect(guide.rounds[3]!.questions.find((q) => q.id === "q-f")!.practiceUrl).toBeNull();
    expect(readGuide((await getDocumentForEdit(admin, company.id)).properties.guide).official).toHaveLength(2);
    const audit = await db.select({ action: auditLogs.action }).from(auditLogs);
    expect(audit.filter((a) => a.action === "interview.import")).toHaveLength(2);
    expect(audit.filter((a) => a.action === "interview.import-company")).toHaveLength(1);
  });

  it("publishes a page with a question still marked for review, holding that question back from readers", async () => {
    const id = ids["Acme SDE 1 Interview Experiences"]!;
    await expect(runDocumentAction(admin, id, { action: "publish" })).resolves.toMatchObject({ affectsPublic: true });
    const live = await getDocumentByTypeAndSlug("interviews", "acme-sde-1");
    expect(live).not.toBeNull();
    const stored = readGuide((live!.properties as Properties).guide);
    const shown = interviewFacts(live!.fullType.fields, live!.properties as Properties).guide;
    const all = (g: typeof stored) => g.rounds.flatMap((r) => r.questions.map((q) => q.text));
    expect(all(stored)).toContain("Tell me about something you owned end to end.");
    expect(all(shown)).not.toContain("Tell me about something you owned end to end.");
    expect(all(shown)).toHaveLength(12);
  });

  it("re-importing stages the update of a live page by default, and publishes it when asked", async () => {
    const evidence = companyEvidence();
    const experiences = evidence.experiences as Array<{ id: string; rounds: Array<{ name: string; questions: unknown[] }> }>;
    experiences[0]!.rounds[1]!.questions.push({ key: "new-q", text: "A newly found question", category: "dsa", quote: "A newly found question", roundContext: "Round 1" });
    const next = buildCompanyImport(evidence).build!.pkg;
    const preview = await previewInterviewImport(admin, { package: next });
    expect(preview.items.map((i) => [i.role, i.action, i.target?.status, i.result?.label, i.result?.staged])).toEqual([
      [null, "update", "draft", "Draft", false],
      ["SDE 1", "update", "published", "Published", true],
    ]);
    expect(preview.items[1]!.diff).toEqual({ added: 1, removed: 0, kept: 13 });
    expect(preview.items[1]!.indexNote).toMatch(/keeps the page's current setting \(index\)/);
    const staged = await runInterviewImport(admin, { package: next, token: preview.token });
    expect(staged.imported.map((i) => [i.created, i.staged, i.outcome])).toEqual([
      [false, false, "Draft"],
      [false, true, "Live page unchanged; update staged"],
    ]);
    const sde1 = ids["Acme SDE 1 Interview Experiences"]!;
    expect(JSON.stringify((await row("acme-sde-1")).properties)).not.toContain("A newly found question");
    expect(JSON.stringify((await getDocumentForEdit(admin, sde1)).workingCopy?.properties)).toContain("A newly found question");

    // The same package, now choosing "Publish changes" for the role page and keeping the company page out of search.
    const options = { publication: "draft", indexing: "auto", pages: { "acme-sde-1": { publication: "published" }, acme: { indexing: "noindex" } } };
    const again = await previewInterviewImport(admin, { package: next, options });
    expect(again.items.map((i) => [i.slug, i.result?.label, i.result?.staged])).toEqual([
      ["acme", "Draft", false],
      ["acme-sde-1", "Published", false],
    ]);
    const done = await runInterviewImport(admin, { package: next, options, token: again.token });
    expect(done.imported.map((i) => i.outcome)).toEqual(["Draft", "Published"]);
    expect(done.affectsPublic).toBe(true);
    const live = await row("acme-sde-1");
    expect(live.workingCopy).toBeNull();
    expect(JSON.stringify(live.properties)).toContain("A newly found question");
  });

  it("binds the token to the package, the choices and the existing pages", async () => {
    const p = pkg();
    const preview = await previewInterviewImport(admin, { package: p });
    await expect(runInterviewImport(admin, { package: p, token: "0".repeat(64) })).rejects.toMatchObject({ code: "conflict" });
    await expect(runInterviewImport(admin, { package: { ...p, researchRun: "changed" }, token: preview.token })).rejects.toMatchObject({ code: "conflict" });
    // Previewed as drafts, then sent with "publish everything": refused, so nothing goes live that wasn't shown.
    await expect(runInterviewImport(admin, { package: p, options: { publication: "published" }, token: preview.token })).rejects.toMatchObject({ code: "conflict" });
    await expect(previewInterviewImport(admin, { package: p, options: { publication: "live-now" } })).rejects.toMatchObject({ code: "invalid" });
  });

  it("publishes new pages as chosen, and applies INDEX advice only above the quality floor", async () => {
    const p = pkg({ company: "Beta", researchRun: "2026-10-08-beta" });
    // Hold back 4 of the role's 13 questions: 9 shown, below the 10 the build requires for a page.
    let held = 0;
    for (const r of p.pages[1]!.guide.rounds)
      for (const q of r.questions) {
        if (q.review || held === 3) continue;
        q.review = true;
        held++;
      }
    const preview = await previewInterviewImport(admin, { package: p, options: { publication: "unlisted" } });
    const role = preview.items[1]!;
    expect(role.review).toBe(4);
    expect(role.result).toMatchObject({ label: "Unlisted", robotsIndex: "noindex", indexed: false });
    expect(role.indexNote).toMatch(/INDEX advice isn.t applied automatically because the page has only 9 questions shown publicly/);

    // An explicit Index choice is the owner's decision and wins.
    const options = { publication: "published", indexing: "auto", pages: { "beta-sde-1": { indexing: "index" } } };
    const { preview: chosen, result } = await importAll(p, options);
    expect(chosen.items.map((i) => [i.slug, i.result?.label, i.result?.robotsIndex, i.result?.indexed])).toEqual([
      ["beta", "Published", "noindex", false],
      ["beta-sde-1", "Published", "index", true],
    ]);
    expect(chosen.totals).toMatchObject({ publish: 2, indexed: 1 });
    expect(result.imported.map((i) => i.outcome)).toEqual(["Published", "Published"]);
    const live = await row("beta-sde-1");
    expect([live.status, live.visibility, live.robotsIndex]).toEqual(["published", "public", "index"]);
    expect(live.publishedAt).not.toBeNull();
  });

  it("leaves out pages the owner unticks, and imports the rest when one page is invalid", async () => {
    const p = pkg({ company: "Gamma", researchRun: "2026-10-08-gamma" });
    p.pages[1]!.guide.rounds[1]!.questions[0]!.reports = 5;
    const preview = await previewInterviewImport(admin, { package: p });
    expect(preview.errors).toEqual([]);
    expect(preview.ok).toBe(true);
    expect(preview.items.map((i) => [i.slug, i.action])).toEqual([
      ["gamma", "create"],
      ["gamma-sde-1", "blocked"],
    ]);
    expect(preview.items[1]!.errors.join("\n")).toMatch(/reports is 5/);
    const result = await runInterviewImport(admin, { package: p, token: preview.token });
    expect(result.imported.map((i) => i.title)).toEqual(["Gamma Interview Experiences"]);
    expect(await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, "gamma-sde-1"))).toEqual([]);

    const fixed = pkg({ company: "Gamma", researchRun: "2026-10-08-gamma" });
    const skipping = await previewInterviewImport(admin, { package: fixed, options: { pages: { gamma: { include: false } } } });
    expect(skipping.items.map((i) => [i.slug, i.action])).toEqual([
      ["gamma", "skipped"],
      ["gamma-sde-1", "create"],
    ]);
    const second = await runInterviewImport(admin, { package: fixed, options: { pages: { gamma: { include: false } } }, token: skipping.token });
    expect([second.skipped, second.imported.map((i) => i.title)]).toEqual([1, ["Gamma SDE 1 Interview Experiences"]]);
  });

  it("shows the address a new page will really get when a page in the Trash still holds it", async () => {
    const p = pkg({ company: "Gamma", researchRun: "2026-10-08-gamma" });
    const company = await row("gamma");
    await runBulkChunk(admin, { operationId: randomUUID(), ids: [company.id], action: { action: "trash" } });
    const preview = await previewInterviewImport(admin, { package: p, options: { pages: { "gamma-sde-1": { include: false } } } });
    expect(preview.items[0]).toMatchObject({ slug: "gamma", action: "create", path: "/interviews/gamma-2" });
    expect(preview.warnings.join("\n")).toMatch(/still belongs to "Gamma Interview Experiences" in the Trash, so a new page would be created at \/interviews\/gamma-2/);
    const result = await runInterviewImport(admin, { package: p, options: { pages: { "gamma-sde-1": { include: false } } }, token: preview.token });
    const [created] = await db.select({ slug: documents.slug }).from(documents).where(eq(documents.id, result.imported[0]!.id));
    expect(created!.slug).toBe("gamma-2");
  });

  it("blocks a role with two pages, and only that role", async () => {
    const p = pkg();
    await runDocumentAction(admin, ids["Acme SDE 1 Interview Experiences"]!, { action: "duplicate" });
    const blocked = await previewInterviewImport(admin, { package: p });
    expect(blocked.items.map((i) => i.action)).toEqual(["update", "blocked"]);
    expect(blocked.items[1]!.errors.join("\n")).toMatch(/2 pages already exist for SDE 1/);
    expect(blocked.ok).toBe(true);
  });
});
