import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./support/helpers";

/**
 * The publishing redesign end to end (docs/content-publishing-redesign.md):
 *  - public pages show no publication dates while structured data keeps them;
 *  - the generic importer: a file's "published" doesn't publish, the owner's
 *    choice does, one bad file doesn't stop the rest, the confirmation counts;
 *  - real interview research (Amazon, TCS) from Studio â†’ Import: publish with
 *    automatic indexing, drafts, held questions kept off the live page;
 *  - the editor says what Publish will do; bulk indexing; anonymous access.
 *
 * Mutating: run only against an isolated local server and database (see
 * playwright.config.ts). Everything it creates is deleted (Trash, then permanently) at the
 * end. Screenshots for review go to .data/e2e-results/publishing-shots/.
 */

test.describe.configure({ mode: "serial" });

const stamp = `pubqa${Date.now().toString(36)}`;
const SHOTS = resolve(".data/e2e-results/publishing-shots");
mkdirSync(SHOTS, { recursive: true });
const created: string[] = [];

const MONTH = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*";
/** "12 Mar 2026", "March 2026", "Oct 2026": what a visible publication date looks like on this site. */
const DATE = new RegExp(`\\b(\\d{1,2} )?${MONTH} 20\\d\\d\\b`);

async function call<T = Record<string, unknown>>(page: Page, method: string, path: string, data?: unknown): Promise<T> {
  const res = await page.request.fetch(path, { method, data, headers: { origin: new URL(page.url()).origin, ...(data === undefined ? {} : { "content-type": "application/json" }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: false });
}

/** The visible text of the page's main content (structured data and the /now glimpse aside). */
async function mainText(page: Page): Promise<string> {
  return page.locator("main").evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script").forEach((s) => s.remove());
    return clone.innerText;
  });
}

const robots = (page: Page) => page.locator('meta[name="robots"]').getAttribute("content");

test("public pages: no publication dates for readers, every date kept for machines", async ({ page }) => {
  await page.goto("/library");
  const firstArticle = await page.locator('main a[href^="/article/"]').first().getAttribute("href");
  expect(firstArticle).toBeTruthy();
  expect(await mainText(page)).not.toMatch(DATE);
  await expect(page.locator("main").getByText(/\d+ min read/).first()).toBeVisible();
  await shot(page, "library-desktop");

  await page.goto(firstArticle!);
  const text = await mainText(page);
  expect(text).not.toMatch(DATE);
  expect(text).not.toMatch(/Updated/);
  await expect(page.locator("main time")).toHaveCount(0);
  await expect(page.locator("main").getByText(/\d+ min read/).first()).toBeVisible();
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("\n");
  expect(ld).toMatch(/"datePublished":"20\d\d-/);
  expect(await page.locator('meta[property="article:published_time"]').count()).toBeGreaterThan(0);
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toContain(firstArticle!);
  expect(await robots(page)).toMatch(/^index/);
  await shot(page, "article-desktop");

  for (const path of ["/", "/library", "/topics"]) {
    await page.goto(path);
    const t = await mainText(page);
    // The home page may show the /now page's own "Updated â€¦" line â€” the one deliberate exception.
    expect(t.replace(/Updated[^\n]*/g, ""), path).not.toMatch(DATE);
  }
  const topic = await page.locator('main a[href^="/"]').filter({ hasNotText: /^$/ }).first().getAttribute("href");
  if (topic) {
    await page.goto(topic);
    expect(await mainText(page)).not.toMatch(DATE);
  }

  // Sitemap and RSS still carry the dates.
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).toMatch(/<lastmod>20\d\d-/);
  const feed = await (await page.request.get("/feed.xml")).text();
  expect(feed).toMatch(/<pubDate>\w{3}, \d{2} \w{3} 20\d\d/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(firstArticle!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, "article-phone");
  await page.goto("/library");
  await shot(page, "library-phone");
});

test("generic import: a file's status never publishes; the owner's choice does, with exact counts", async ({ page }) => {
  await login(page);
  await page.goto("/admin/import");
  const files = [
    { name: `${stamp}-one.md`, body: `---\ntitle: Pubqa ${stamp} One\nstatus: published\nrobots: index\n---\n${"Real words for a real body. ".repeat(60)}` },
    { name: `${stamp}-two.md`, body: `---\ntitle: Pubqa ${stamp} Two\n---\n${"Another body worth reading. ".repeat(40)}` },
    { name: `${stamp}-bad.md`, body: `---\ntitle: [unclosed\n---\nBody` },
  ];
  await page.getByLabel("Choose files or a ZIP").setInputFiles(files.map((f) => ({ name: f.name, mimeType: "text/markdown", buffer: Buffer.from(f.body) })));
  await expect(page.getByRole("heading", { name: /^Preview/ })).toBeVisible();

  const row = (title: string) => page.getByRole("row").filter({ hasText: title });
  // Defaults: drafts, whatever the file says; the bad file is blocked on its own.
  await expect(row(`Pubqa ${stamp} One`).getByText("Draft", { exact: true }).last()).toBeVisible();
  await expect(row(`Pubqa ${stamp} One`).getByText("Index once live")).toBeVisible();
  await expect(row(`${stamp}-bad`).getByText("Blocked")).toBeVisible();
  await shot(page, "generic-preview-drafts");

  // Choose Published for the import, keep "Two" as a draft.
  await page.getByRole("group", { name: "Imported items become" }).getByText("Published", { exact: true }).click();
  await page.getByLabel(`Result for Pubqa ${stamp} Two`).selectOption("draft:public");
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(row(`Pubqa ${stamp} One`).getByText("Published", { exact: true }).last()).toBeVisible();
  await expect(row(`Pubqa ${stamp} One`).getByText("Indexed", { exact: true })).toBeVisible();
  await expect(row(`Pubqa ${stamp} Two`).getByText("Draft", { exact: true }).last()).toBeVisible();
  await shot(page, "generic-preview-published");

  await page.getByRole("button", { name: "Approve and import" }).click();
  const dialog = page.getByRole("dialog", { name: "Import and publish these documents?" });
  await expect(dialog).toContainText("1 will be published (live and listed); 1 not on the site.");
  await expect(dialog).toContainText("1 indexed by search engines once live.");
  await shot(page, "generic-confirm");
  await dialog.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Import complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  await shot(page, "generic-done");

  const one = await page.request.get(`/article/pubqa-${stamp}-one`);
  expect(one.status()).toBe(200);
  expect(await one.text()).toMatch(/<meta name="robots" content="index/);
  expect((await page.request.get(`/article/pubqa-${stamp}-two`)).status()).toBe(404);
  const found = await call<{ items: Array<{ id: string; title: string; status: string; visibility: string }> }>(page, "GET", `/api/admin/documents?q=${stamp}`);
  expect(found.items.map((d) => [d.title, d.status, d.visibility]).sort()).toEqual([
    [`Pubqa ${stamp} One`, "published", "public"],
    [`Pubqa ${stamp} Two`, "draft", "public"],
  ]);
  created.push(...found.items.map((d) => d.id));
});

const research = (company: string) => resolve("research/interviews", company, "import.json");

test("interview research: Amazon published with automatic indexing; held questions stay off the page", async ({ page }) => {
  test.skip(!existsSync(research("amazon")), "research/interviews/amazon is not on this machine");
  const pkg = JSON.parse(readFileSync(research("amazon"), "utf8")) as { pages: Array<{ slug: string; advice: { indexing: string }; guide: { rounds: Array<{ questions: Array<{ review: boolean }> }> } }> };
  const sde1 = pkg.pages.find((p) => p.slug === "amazon-sde-1")!;
  const shown = sde1.guide.rounds.reduce((n, r) => n + r.questions.filter((q) => !q.review).length, 0);
  const held = sde1.guide.rounds.reduce((n, r) => n + r.questions.filter((q) => q.review).length, 0);

  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose files or a ZIP").setInputFiles(research("amazon"));
  await expect(page.getByRole("heading", { name: /^Amazon: \d+ pages$/ })).toBeVisible();
  await page.getByRole("group", { name: "Imported items become" }).getByText("Published", { exact: true }).click();
  const result = page.locator('[id="amazon-sde-1-result"]');
  // The address each page will really have (numbered if an earlier page in the Trash still holds it).
  const pathOf = (slug: string) => page.locator("article", { has: page.locator(`[id="${slug}-result"]`) }).locator("span.font-mono").first().innerText();
  const rolePath = await pathOf("amazon-sde-1");
  const companyPath = await pathOf("amazon");
  await expect(result.getByText("Published", { exact: true })).toBeVisible();
  await expect(result.getByText("Indexed", { exact: true })).toBeVisible();
  await expect(page.locator('[id="amazon-result"]').getByText("Noindex", { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`${held} held back until reviewed`)).first()).toBeVisible();
  await shot(page, "amazon-preview-published");
  await page.getByRole("button", { name: /^Import and publish \d+ pagesâ€¦$/ }).click();
  const dialog = page.getByRole("dialog", { name: "Import and publish Amazon pages?" });
  await expect(dialog).toContainText(/\d+ published \(live and listed\)/);
  await expect(dialog).toContainText(/held back from the public pages until you review them/);
  await shot(page, "amazon-confirm");
  await dialog.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByRole("heading", { name: "Imported", exact: true })).toBeVisible();
  for (const link of await page.getByRole("link", { name: /Interview Experiences$/ }).all()) created.push((await link.getAttribute("href"))!.split("/").pop()!);

  await page.goto(rolePath);
  expect(await robots(page)).toMatch(/^index/);
  await expect(page.getByRole("navigation", { name: "Rounds" }).getByRole("button", { name: new RegExp(`All rounds\\s*${shown}`) })).toBeVisible();
  expect(await mainText(page)).not.toMatch(/Researched/);
  await shot(page, "amazon-role-page");
  await page.goto(companyPath);
  expect(await robots(page)).toMatch(/noindex/);
});

test("interview research: TCS imported as drafts; the editor states what Publish will do", async ({ page }) => {
  test.skip(!existsSync(research("tcs")), "research/interviews/tcs is not on this machine");
  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose files or a ZIP").setInputFiles(research("tcs"));
  await expect(page.getByRole("heading", { name: /^TCS: \d+ pages$/ })).toBeVisible();
  await expect(page.getByText(/to be indexed once published/)).toBeVisible();
  await shot(page, "tcs-preview-drafts");
  await page.getByRole("button", { name: /^Import \d+ pages as drafts$/ }).click();
  await expect(page.getByRole("heading", { name: "Imported", exact: true })).toBeVisible();
  const links = await page.getByRole("link", { name: /Interview Experiences$/ }).all();
  const ids = await Promise.all(links.map(async (l) => (await l.getAttribute("href"))!.split("/").pop()!));
  created.push(...ids);
  expect((await page.request.get("/interviews/tcs-prime")).status()).toBe(404);

  // The company page: its draft line and the SEO default that matches the format (not indexed by default).
  const company = await call<{ id: string; title: string }>(page, "GET", `/api/admin/documents/${ids[0]}`);
  await page.goto(`/admin/documents/${company.id}`);
  await expect(page.getByText(/Not on the site yet\. Publish makes it: live and listed across the site; not indexed\./)).toBeVisible();
  const panel = page.getByRole("button", { name: "Show details panel" });
  if (await panel.isVisible()) await panel.click();
  await page.getByRole("tab", { name: "SEO" }).click();
  await expect(page.getByLabel("Search engines")).toHaveValue("noindex");
  await expect(page.getByLabel("Search engines").locator("option", { hasText: "Default (noindex)" })).toHaveCount(1);
  await shot(page, "editor-seo-panel");
  await page.getByRole("tab", { name: "Publish" }).click();
  await expect(page.getByLabel("Who can see it")).toHaveValue("public");
  await shot(page, "editor-publish-panel");
});

test("bulk indexing from the documents list, with a confirmation that explains it", async ({ page }) => {
  await login(page);
  await page.goto(`/admin/documents?q=${encodeURIComponent(`Pubqa ${stamp} One`)}`);
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: `Pubqa ${stamp} One`, exact: true }) });
  await row.getByRole("checkbox").check();
  const toolbar = page.getByRole("toolbar", { name: /selected$/ });
  await toolbar.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Change search engine indexingâ€¦" }).click();
  await page.getByLabel("Search engines").selectOption("noindex");
  await page.getByRole("button", { name: "Continue" }).click();
  const confirm = page.getByRole("dialog", { name: "Change search engine indexing for 1 document?" });
  await expect(confirm).toContainText("kept out of search engines");
  await shot(page, "bulk-indexing-confirm");
  await confirm.getByRole("button", { name: "Change indexing" }).click();
  await expect(page.getByRole("dialog").getByText("1 document set to noindex.")).toBeVisible();
  const live = await page.request.get(`/article/pubqa-${stamp}-one`);
  expect(await live.text()).toMatch(/<meta name="robots" content="noindex/);
});

test("anonymous and cross-site requests can't reach the importers or bulk operations", async ({ page, browser, baseURL }) => {
  const anon = await browser.newContext();
  for (const path of ["/api/admin/interviews/preview", "/api/admin/interviews/import", "/api/admin/documents/bulk", "/api/admin/import/jobs"]) {
    const res = await anon.request.post(`${baseURL}${path}`, { data: { package: {}, token: "0".repeat(64) }, headers: { origin: baseURL! } });
    expect([401, 403], path).toContain(res.status());
  }
  const studio = await anon.newPage();
  await studio.goto(`${baseURL}/admin/import`);
  await expect(studio).toHaveURL(/\/admin\/login/);
  await anon.close();

  await login(page);
  const forged = await page.request.post("/api/admin/interviews/preview", { data: { package: {} }, headers: { origin: "https://evil.example", "content-type": "application/json" } });
  expect(forged.status()).toBe(403);
});

test("cleanup: delete everything this run created (Trash, then permanently), so the next run starts clean", async ({ page }) => {
  await login(page);
  const ids = [...new Set(created)];
  if (!ids.length) return;
  await call(page, "POST", "/api/admin/documents/bulk", { operationId: crypto.randomUUID(), ids, action: { action: "trash" } });
  await call(page, "POST", "/api/admin/documents/bulk", { operationId: crypto.randomUUID(), ids, action: { action: "delete", confirm: "permanently-delete" } });
});
