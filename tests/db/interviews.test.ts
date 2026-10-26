import { eq } from "drizzle-orm";
import { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InterviewCompanyHubView, InterviewIndexView } from "@/components/pages/interview-index-view";
import { DocumentView } from "@/components/templates/document-view";
import { readGuide } from "@/lib/interviews/guide";
import { buildCompanyImport } from "@/lib/interviews/research";
import { documentRobots } from "@/lib/seo/robots";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import { sitemapEntries } from "@/server/seo/discovery";
import { documentMetadata } from "@/server/seo/metadata";
import { getContentTypeBySlug } from "@/server/services/content-types";
import { loadDocumentPage } from "@/server/services/document-page";
import { getDocumentForEdit, runDocumentAction, saveDocument } from "@/server/services/documents";
import { previewInterviewImport, runInterviewImport } from "@/server/services/interview-import";
import { findRolePage, getInterviewCompany, getInterviewDirectory } from "@/server/services/interviews";
import { getDocumentByTypeAndSlug } from "@/server/services/public-content";
import { searchPublic } from "@/server/services/search";
import { companyEvidence } from "../helpers/company-evidence";
import { createAdmin, createTestDb } from "../helpers/db";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;
const ids: Record<string, string> = {};

async function html(element: React.ReactElement): Promise<string> {
  const { prelude } = await prerenderToNodeStream(element);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replace(/<!-- -->/g, "");
}

async function page(slug: string) {
  return loadDocumentPage((await getDocumentByTypeAndSlug("interviews", slug))!);
}

async function publishReviewed(id: string) {
  const doc = await getDocumentForEdit(admin, id);
  const guide = readGuide(doc.properties.guide);
  for (const r of guide.rounds) for (const q of r.questions) q.review = false;
  await saveDocument(admin, id, { body: { properties: { ...doc.properties, guide } } });
  await runDocumentAction(admin, id, { action: "publish" });
}

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
  const pkg = buildCompanyImport(companyEvidence()).build!.pkg;
  const preview = await previewInterviewImport(admin, { package: pkg });
  const result = await runInterviewImport(admin, { package: pkg, token: preview.token });
  for (const i of result.imported) ids[i.title] = i.id;
  // Only the role page is published; the company page stays a draft for now.
  await publishReviewed(ids["Acme SDE 1 Interview Experiences"]!);
});
afterAll(() => ctx.close());

describe("a role's page", () => {
  it("shows the reported process, every round and question, and the copy tools — in the HTML", async () => {
    const data = await page("acme-sde-1");
    expect(data.template).toBe("interview");
    expect(data.interview).toMatchObject({ company: "Acme", role: "SDE 1" });
    const out = await html(createElement(DocumentView, { data }));
    for (const text of [
      "Acme · Interview experiences",
      ">4</strong> accounts",
      "2024–2026",
      "The process candidates reported",
      "2 of 4 · 0 questions",
      'href="#round-technical-round-1"',
      "Two DSA problems, sometimes with a behavioural question.",
      "Design an LRU cache",
      "Reported by 3 candidates",
      "\u00a0on leetcode.com",
      "Copy for AI",
      "Copy list",
      "Search questions",
      "Candidates who described this round didn’t name specific questions.",
      "What Acme publishes about its process",
      "Acme: SDE 1 assessment",
      "Most accounts describe two coding problems per round.",
      "How candidates prepared",
      "not the company&#x27;s official process",
    ]) {
      expect(out, text).toContain(text);
    }
    // The company-wide official source belongs on the company's page, not here.
    expect(out).not.toContain("Acme: how we hire");
    // Every round is a section with its own anchor; questions are server-rendered.
    for (const id of ["online-assessment", "technical-round-1", "bar-raiser", "technical-round-2"]) expect(out).toContain(`id="round-${id}"`);
    expect((out.match(/<li id="q-/g) ?? []).length).toBe(13);
  });

  it("keeps research internals off the page and adds no answer-style structured data", async () => {
    const data = await page("acme-sde-1");
    const out = await html(createElement(DocumentView, { data }));
    expect(out).not.toMatch(/needs review|reviewNote|leetcode\.com\/discuss|independence/i);
    // One-candidate questions carry no count.
    expect(out).not.toContain("Reported by 1 candidate");
    const ld = JSON.stringify(data.jsonLd);
    expect(ld).toContain('"BreadcrumbList"');
    expect(ld).not.toMatch(/FAQPage|QAPage|Quiz|AggregateRating|"Review"/);
  });

  it("breadcrumbs lead to the company, whose page is built from its roles until it has its own", async () => {
    const data = await page("acme-sde-1");
    expect(data.trail).toEqual([
      { label: "Interview Experiences", href: "/interviews" },
      { label: "Acme", href: "/interviews/acme" },
    ]);
    const type = (await getContentTypeBySlug("interviews"))!;
    const company = (await getInterviewCompany(type, "acme"))!;
    expect(company.page).toBeNull();
    const out = await html(createElement(InterviewCompanyHubView, { type, company, siteUrl: "https://example.test" }));
    expect(out).toContain('href="/interviews/acme-sde-1"');
    expect(out).toContain("SDE 1");
    // The earlier /interviews/{company}/{role} address finds the role's page (the route redirects there).
    expect((await findRolePage(type, "acme", "sde-1"))!.path).toBe("/interviews/acme-sde-1");
  });
});

describe("the company's page and /interviews", () => {
  it("publishing the company page puts its official sources and roles on it", async () => {
    await runDocumentAction(admin, ids["Acme Interview Experiences"]!, { action: "publish" });
    const out = await html(createElement(DocumentView, { data: await page("acme") }));
    for (const text of ["Choose a role", "SDE 1", "rounds reported", "See rounds and questions", "What Acme publishes about its process", "Acme: how we hire", "Three interviews of 45 minutes.", "Behavioural questions come up in every round."]) {
      expect(out, text).toContain(text);
    }
    const type = (await getContentTypeBySlug("interviews"))!;
    const directory = await getInterviewDirectory(type);
    expect(directory.map((c) => [c.name, c.page?.path, c.roles.map((r) => r.role)])).toEqual([["Acme", "/interviews/acme", ["SDE 1"]]]);
    const index = await html(createElement(InterviewIndexView, { type, companies: directory, siteUrl: "https://example.test" }));
    expect(index).toContain('href="/interviews/acme"');
    expect(index).toContain('href="/interviews/acme-sde-1"');
    expect(index).toContain("never answers");
  });

  it("SEO: the directory, the company page and the role page the research advised are indexable and in the sitemap", async () => {
    // The import keeps a company page out of search until its owner decides; on Automatic it is a hub that earns its place.
    await db.update(documents).set({ robotsIndex: "default" }).where(eq(documents.id, ids["Acme Interview Experiences"]!));
    const entries = (await sitemapEntries()).map((e) => e.url);
    expect(entries.some((u) => u.endsWith("/interviews/acme-sde-1"))).toBe(true);
    expect(entries.some((u) => u.endsWith("/interviews/acme"))).toBe(true);
    expect(entries.some((u) => u.endsWith("/interviews"))).toBe(true);
    const role = (await getDocumentByTypeAndSlug("interviews", "acme-sde-1"))!;
    expect(documentRobots({ status: role.status, visibility: role.visibility, robotsIndex: role.robotsIndex, typeIndexable: role.fullType.indexable, canonicalElsewhere: false }).index).toBe(true);
    // A company's page is a hub that earns its place in search even though the type itself is not indexable.
    const company = (await getDocumentByTypeAndSlug("interviews", "acme"))!;
    expect((await documentMetadata(company)).robots).toMatchObject({ index: true });
  });

  it("site search finds a role page by a question it lists", async () => {
    expect((await searchPublic("median data stream")).map((r) => r.path)).toContain("/interviews/acme-sde-1");
  });
});
