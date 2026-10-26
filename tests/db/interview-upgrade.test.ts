import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readGuide } from "@/lib/interviews/guide";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { contentTypeFields, documents, redirects } from "@/server/db/schema";
import { getContentTypeBySlug, loadContentTypes } from "@/server/services/content-types";
import { getDocumentForEdit } from "@/server/services/documents";
import { applyInterviewUpgrade, planInterviewUpgrade } from "@/server/services/interview-upgrade";
import { createAdmin, createTestDb, typeId } from "../helpers/db";

/**
 * What `npm run interviews:install -- --apply` does on a site that installed
 * the earlier one-page-per-round format: the type's fields are replaced, each
 * company × role's rounds become one draft, the round pages go to the Trash and
 * a published round's address redirects to the new page.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;
let interviews: string;

const legacyQuestion = (id: string, text: string, over: Record<string, unknown> = {}) => ({ id, text, category: "dsa", difficulty: null, practiceUrl: null, reports: 1, frequent: false, review: false, ...over });

async function legacyRound(company: string, role: string, round: string, order: number | null, questions: unknown[], status: "draft" | "published") {
  const [row] = await db
    .insert(documents)
    .values({
      typeId: interviews,
      title: `${company} ${role} — ${round} Interview Questions`,
      slug: `${company}-${role}-${round}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      status,
      visibility: "public",
      excerpt: "",
      content: { type: "doc", content: [] },
      properties: { company, jobRole: role, round, ...(order !== null ? { roundOrder: order } : {}), questions },
      publishedAt: status === "published" ? new Date() : null,
    })
    .returning({ id: documents.id });
  return row!.id;
}

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
  interviews = await typeId(db, "interviews");
  // Turn the seeded type back into the earlier format.
  await db.delete(contentTypeFields).where(and(eq(contentTypeFields.contentTypeId, interviews), eq(contentTypeFields.key, "guide")));
  await db.update(contentTypeFields).set({ required: true }).where(and(eq(contentTypeFields.contentTypeId, interviews), eq(contentTypeFields.key, "jobRole")));
  await db.insert(contentTypeFields).values([
    { contentTypeId: interviews, key: "round", label: "Round", type: "text", role: "interviewRound", required: true, position: 2 },
    { contentTypeId: interviews, key: "roundOrder", label: "Round order", type: "number", role: "interviewRoundOrder", position: 3 },
    { contentTypeId: interviews, key: "questions", label: "Questions", type: "question_list", options: { choices: [{ value: "dsa", label: "DSA / Coding" }, { value: "behavioral", label: "Behavioral" }, { value: "other", label: "Other" }] }, position: 4 },
  ]);
  await legacyRound("Amazon", "SDE 1", "Technical Round 2", 3, [legacyQuestion("q01", "Design an LRU cache")], "draft");
  await legacyRound("Amazon", "SDE 1", "Technical Round 1", 2, [legacyQuestion("q01", "Reverse a linked list", { reports: 2, frequent: true }), legacyQuestion("q02", "Tell me about a deadline", { category: "behavioral", review: true })], "published");
  await legacyRound("Amazon", "SDE 2", "System Design", 4, [legacyQuestion("q01", "Design a URL shortener", { category: "system-design" })], "draft");
});
afterAll(() => ctx.close());

describe("upgrading the earlier one-page-per-round format", () => {
  it("plans without changing anything", async () => {
    const plan = await planInterviewUpgrade(db);
    expect(plan.needsFields).toBe(true);
    expect(plan.groups.map((g) => [g.title, g.rounds.map((r) => r.round)])).toEqual([
      ["Amazon SDE 1 Interview Experiences", ["Technical Round 1", "Technical Round 2"]],
      ["Amazon SDE 2 Interview Experiences", ["System Design"]],
    ]);
    expect((await db.select({ id: documents.id }).from(documents).where(eq(documents.typeId, interviews))).length).toBe(3);
  });

  it("replaces the fields, makes one draft per role, trashes the rounds and redirects a published one", async () => {
    const result = await applyInterviewUpgrade(admin, db);
    expect(result).toMatchObject({ fieldsUpdated: true, trashed: 3, redirected: 1 });
    expect(result.created.map((c) => c.title)).toEqual(["Amazon SDE 1 Interview Experiences", "Amazon SDE 2 Interview Experiences"]);

    const type = (await loadContentTypes(db)).find((t) => t.id === interviews)!;
    expect(type.fields.map((f) => [f.key, f.type, f.required])).toEqual([
      ["company", "text", true],
      ["jobRole", "text", false],
      ["guide", "interview_guide", false],
    ]);
    // The categories carry over from the old question list.
    expect(type.fields[2]!.options.choices!.map((c) => c.value)).toEqual(["dsa", "behavioral", "other"]);

    const sde1 = await getDocumentForEdit(admin, result.created[0]!.id);
    expect(sde1.status).toBe("draft");
    const guide = readGuide(sde1.properties.guide);
    expect(guide.rounds.map((r) => [r.id, r.name, r.questions.map((q) => q.text)])).toEqual([
      ["technical-round-1", "Technical Round 1", ["Reverse a linked list", "Tell me about a deadline"]],
      ["technical-round-2", "Technical Round 2", ["Design an LRU cache"]],
    ]);
    // Review flags survive; a category the type no longer has becomes "Other".
    expect(guide.rounds[0]!.questions[1]!.review).toBe(true);
    expect(readGuide((await getDocumentForEdit(admin, result.created[1]!.id)).properties.guide).rounds[0]!.questions[0]!.category).toBe("other");

    const statuses = await db.select({ status: documents.status, title: documents.title }).from(documents).where(eq(documents.typeId, interviews));
    expect(statuses.filter((s) => s.status === "trashed")).toHaveLength(3);
    const [rule] = await db.select({ from: redirects.fromPath, to: redirects.toPath }).from(redirects).where(eq(redirects.fromPath, "/interviews/amazon-sde-1-technical-round-1"));
    expect(rule).toEqual({ from: "/interviews/amazon-sde-1-technical-round-1", to: "/interviews/amazon-sde-1" });
  });

  it("is idempotent", async () => {
    expect(await getContentTypeBySlug("interviews")).not.toBeNull();
    const plan = await planInterviewUpgrade(db);
    expect(plan.needsFields).toBe(false);
    expect(plan.groups).toEqual([]);
  });
});
