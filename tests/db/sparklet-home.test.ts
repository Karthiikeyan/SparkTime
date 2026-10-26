import { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HomePage } from "@/components/home/home-page";
import { readGuide } from "@/lib/interviews/guide";
import { buildCompanyImport } from "@/lib/interviews/research";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { siteConfig } from "@/lib/site-config";
import type { AdminActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { getContentTypeBySlug } from "@/server/services/content-types";
import { createDocument, getDocumentForEdit, runDocumentAction, saveDocument, setCollectionItems } from "@/server/services/documents";
import { getHomeData } from "@/server/services/home";
import { previewInterviewImport, runInterviewImport } from "@/server/services/interview-import";
import { getInterviewDirectory } from "@/server/services/interviews";
import { getBrand, getFeaturedTopics, loadAllSettings, updateSettings } from "@/server/services/settings";
import { companyEvidence } from "../helpers/company-evidence";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

/**
 * The home page counts everything it shows from published content:
 * courses and their lessons, interview accounts and questions, pieces in the
 * library. Nothing here is a number typed into the page.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let admin: AdminActor;

async function make(typeSlug: string, title: string, excerpt = `Why ${title} matters. More detail follows.`) {
  const { id } = await createDocument(admin, { typeId: await typeId(db, typeSlug), title });
  await saveDocument(admin, id, { body: { content: docOf(paragraph(`${title} body.`)), properties: {}, excerpt } });
  await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
  admin = await createAdmin(db);
  // Interview pages, imported the way Studio does, with the role page reviewed and published.
  const pkg = buildCompanyImport(companyEvidence()).build!.pkg;
  const preview = await previewInterviewImport(admin, { package: pkg });
  const result = await runInterviewImport(admin, { package: pkg, token: preview.token });
  const role = result.imported.find((i) => i.title === "Acme SDE 1 Interview Experiences")!;
  const doc = await getDocumentForEdit(admin, role.id);
  const guide = readGuide(doc.properties.guide);
  for (const r of guide.rounds) for (const q of r.questions) q.review = false;
  await saveDocument(admin, role.id, { body: { properties: { ...doc.properties, guide } } });
  await runDocumentAction(admin, role.id, { action: "publish" });
  // A course of two lessons, and one piece that isn't in it.
  const lessons = [await make("article", "Lesson one"), await make("article", "Lesson two")];
  await make("article", "A standalone guide");
  const course = await make("course", "Learn Things: From Zero to Ready", "A free two-lesson course. It goes further.");
  await setCollectionItems(admin, course, { items: lessons.map((documentId) => ({ documentId, groupLabel: "", note: "" })) });
});
afterAll(() => ctx.close());

describe("home page data", () => {
  it("counts courses, lessons, interview accounts and questions from what is published", async () => {
    const data = await getHomeData();
    const interviews = await getContentTypeBySlug("interviews");
    const directory = await getInterviewDirectory(interviews!);
    const accounts = directory.reduce((n, c) => n + c.roles.reduce((m, r) => m + r.accounts, 0), 0);
    const questions = directory.reduce((n, c) => n + c.roles.reduce((m, r) => m + r.questions, 0), 0);
    expect(accounts).toBeGreaterThan(0);
    expect(data.stats).toMatchObject({ courses: 1, lessons: 2, accounts, questions });
    // Three articles, the course and the interview page.
    expect(data.stats.pieces).toBe(5);
    expect(data.courses[0]).toMatchObject({ title: "Learn Things", oneLiner: "A free two-lesson course.", lessons: 2 });
    expect(data.companies.map((c) => c.name)).toEqual(["Acme"]);
  });

  it("lists only written pieces as the latest guides", async () => {
    const titles = (await getHomeData()).latest.map((c) => c.title);
    expect(titles).toHaveLength(3);
    expect(titles).not.toContain("Learn Things: From Zero to Ready");
    expect(titles.some((t) => t.includes("Interview Experiences"))).toBe(false);
  });

  it("turns a Popular shortcut whose page isn't published into a search", async () => {
    const { popular } = await getHomeData();
    expect(popular.find((p) => p.label === "Amazon SDE 1")?.href).toBe("/search?q=Amazon%20SDE%201");
    expect(popular).toHaveLength(siteConfig.popular.length);
  });

  it("renders the counted numbers, one h1 and the section outline", async () => {
    const data = await getHomeData();
    const { prelude } = await prerenderToNodeStream(createElement(HomePage, { data }));
    let html = "";
    for await (const chunk of prelude) html += chunk.toString();
    html = html.replace(/<!-- -->/g, "");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(siteConfig.promise);
    expect(html).toContain(`placeholder="Search ${data.stats.pieces} guides, courses and interview experiences"`);
    expect(html).toContain("One free course. Read in order, start to finish.");
    expect(html).toContain("free course · 2 lessons");
    const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());
    expect(h2).toEqual(["Start with your goal", "Interview experiences, round by round", "Latest guides"]);
    expect(html).toContain('alt="Karthikeyan A"');
    expect(html).toContain(`href="${siteConfig.shareInterviewHref.replace("&", "&amp;")}"`);
  });
});

async function render() {
  const { prelude } = await prerenderToNodeStream(createElement(HomePage, { data: await getHomeData() }));
  let html = "";
  for await (const chunk of prelude) html += chunk.toString();
  return html.replace(/<!-- -->/g, "");
}

describe("home page follows Studio → Settings", () => {
  afterAll(async () => {
    await updateSettings(admin, "home", DEFAULT_SETTINGS.home);
    await updateSettings(admin, "site", DEFAULT_SETTINGS.site);
  });

  it("is named SparkTime until the owner renames it, then follows the saved name everywhere", async () => {
    expect((await getBrand()).name).toBe("SparkTime");
    expect((await getBrand()).titleTemplate).toBe("%s · SparkTime");
    await updateSettings(admin, "site", { ...DEFAULT_SETTINGS.site, name: "Spark Studio", authorSummary: "A new summary. Second sentence." });
    const brand = await getBrand();
    expect(brand.name).toBe("Spark Studio");
    expect(brand.titleTemplate).toBe("%s · Spark Studio");
    expect(brand.homeTitle).toMatch(/^Spark Studio — /);
    expect(brand.byline).toBe("by Karthikeyan A");
    const html = await render();
    expect(html).toContain("A new summary. Second sentence.");
  });

  it("shows the headline, shortcuts, counts and bands the owner chose", async () => {
    const home = structuredClone(DEFAULT_SETTINGS.home);
    home.hero.headline = "Learn it properly.";
    home.hero.eyebrow = "";
    home.hero.searchPlaceholder = "Find one of {count} things";
    home.hero.popular = [{ label: "Acme", href: "", query: "Acme interviews" }];
    home.courses.title = "Pick a course";
    home.courses.intro = "{courses} to begin with.";
    home.interviews.enabled = false;
    home.latest.count = 1;
    home.tribe.heading = "Learn in your language";
    home.tribe.buttonLabel = "Meet the tribe";
    await updateSettings(admin, "home", home);
    const data = await getHomeData();
    expect(data.latest).toHaveLength(1);
    expect(data.popular).toEqual([{ label: "Acme", href: "/search?q=Acme%20interviews" }]);
    const html = await render();
    expect(html).toContain("Learn it properly.");
    expect(html).toContain(`placeholder="Find one of ${data.stats.pieces} things"`);
    expect(html).toContain("One free course to begin with.");
    expect(html).toContain("Pick a course");
    expect(html).toContain("Learn in your language");
    expect(html).toContain("Meet the tribe");
    expect(html).not.toContain("Interview experiences, round by round");
    expect(html).not.toContain("Written for engineers in India");
  });

  it("features the topics it lists, and every other topic becomes a note", async () => {
    const home = structuredClone(DEFAULT_SETTINGS.home);
    home.topics.slugs = ["career"];
    await updateSettings(admin, "home", home);
    expect(await getFeaturedTopics()).toEqual(["career"]);
    expect((await loadAllSettings()).home.topics.slugs).toEqual(["career"]);
    const { topics } = await getHomeData();
    expect(topics.map((t) => t.name.toLowerCase())).not.toContain("technology");
  });

  it("refuses a link that is not a site path or http(s) URL", async () => {
    const home = structuredClone(DEFAULT_SETTINGS.home);
    home.tribe.href = "javascript:alert(1)";
    await expect(updateSettings(admin, "home", home)).rejects.toThrow();
  });
});
