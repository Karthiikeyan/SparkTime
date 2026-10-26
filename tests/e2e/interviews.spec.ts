import { expect, test, type Page } from "@playwright/test";
import { buildCompanyImport } from "../../src/lib/interviews/research";
import { companyEvidence } from "../helpers/company-evidence";
import { login } from "./support/helpers";

/**
 * Interview Experiences end to end: import a company's research from Studio →
 * Import (preview, then drafts), publish with a question held for review, clear
 * the flag and publish the change, then use the
 * role's page as a candidate would — round navigation, topics, search, Copy
 * for AI — on a laptop and a phone, and find it from /interviews.
 *
 * Mutating: run only against an isolated local server and database (see
 * playwright.config.ts and docs/INTERVIEWS.md → Testing). The pages it
 * creates are moved to the Trash at the end.
 */

test.describe.configure({ mode: "serial" });

const stamp = `qa${Date.now().toString(36)}`;
const company = `Interviewqa ${stamp}`;
const companySlug = `interviewqa-${stamp}`;
const rolePath = `/interviews/${companySlug}-sde-1`;
const pkg = buildCompanyImport(companyEvidence({ company, researchRun: `${stamp}-run` })).build!.pkg!;
const ids: string[] = [];

/** The system clipboard; Windows hands text back with CRLF line endings. */
async function clipboard(page: Page): Promise<string> {
  return (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
}

async function call(page: Page, method: string, path: string, data?: unknown) {
  const res = await page.request.fetch(path, { method, data, headers: { origin: new URL(page.url()).origin, ...(data === undefined ? {} : { "content-type": "application/json" }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test("import: the research opens from Studio → Import, every page previewed with its result, imported as drafts", async ({ page }) => {
  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose files or a ZIP").setInputFiles({ name: "import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pkg)) });
  await expect(page.getByRole("heading", { name: `${company}: 2 pages` })).toBeVisible();
  await expect(page.getByText(/13 questions · 1 held for review · 2 new · 0 to update/)).toBeVisible();
  const role = page.locator("article", { hasText: `/interviews/${companySlug}-sde-1` });
  const result = page.locator(`[id="${companySlug}-sde-1-result"]`);
  await expect(result.getByText("New", { exact: true })).toBeVisible();
  await expect(result.getByText("Draft", { exact: true })).toBeVisible();
  await expect(result.getByText("Index once live", { exact: true })).toBeVisible();
  await expect(page.getByText(/2 pages: 2 drafts · 1 to be indexed once published · 1 question held for review/)).toBeVisible();
  await expect(role.getByText(/Research advice INDEX/)).toBeVisible();
  await role.getByText(/Rounds and 1 question held for review/).click();
  await expect(role.getByText("Why: Wording not remembered.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not included (too little evidence)" })).toBeVisible();
  await page.getByRole("button", { name: "Import 2 pages as drafts" }).click();
  await expect(page.getByRole("heading", { name: "Imported", exact: true })).toBeVisible();
  for (const link of await page.getByRole("link", { name: /Interview Experiences$/ }).all()) ids.push((await link.getAttribute("href"))!.split("/").pop()!);
  expect(ids).toHaveLength(2);
});

test("editor: a question held for review never blocks publishing; clearing it publishes the question", async ({ page }) => {
  await login(page);
  const roleId = ids[1]!;
  await page.goto(`/admin/documents/${roleId}`);
  await expect(page.getByRole("heading", { name: /Interview guide · 4 rounds · 13 questions · 1 held back until reviewed/ })).toBeVisible();
  await expect(page.getByText("Not shown publicly until reviewed")).toBeVisible();
  await expect(page.getByLabel("Technical Round 1 summary")).toHaveValue("Two DSA problems, sometimes with a behavioural question.");
  await expect(page.getByText(/Not on the site yet\. Publish makes it: live and listed across the site; indexed by search engines\./)).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Published", exact: true })).toBeVisible();
  await call(page, "POST", `/api/admin/documents/${ids[0]}/actions`, { action: "publish" });

  // Live with 12 questions: the held one is not on the page.
  const live = await page.context().newPage();
  await live.goto(rolePath);
  await expect(live.getByRole("navigation", { name: "Rounds" }).getByRole("button", { name: /All rounds\s*12/ })).toBeVisible();
  await expect(live.getByText("Tell me about something you owned end to end.")).toHaveCount(0);
  await live.close();

  await page.getByRole("button", { name: "Mark all reviewed" }).click();
  await expect(page.getByRole("heading", { name: /^Interview guide · 4 rounds · 13 questions$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish changes" })).toBeEnabled();
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByRole("button", { name: "Published", exact: true })).toBeVisible();
});

test("role page on a laptop: process, rounds, topics, search and Copy for AI", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(rolePath);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${company} SDE 1 Interview Experiences`);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: company })).toHaveAttribute("href", `/interviews/${companySlug}`);
  await expect(page.getByRole("heading", { name: "The process candidates reported" })).toBeVisible();
  await expect(page.getByRole("heading", { name: `Official · what ${company} publishes` })).toBeVisible();
  const rounds = page.getByRole("navigation", { name: "Rounds" });
  await expect(rounds.getByRole("button", { name: /All rounds\s*13/ })).toHaveAttribute("aria-pressed", "true");

  // A round in the process overview opens that round below.
  await page.getByRole("link", { name: "Technical Round 1" }).first().click();
  await expect(rounds.getByRole("button", { name: /Technical Round 1\s*9/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('section[id^="round-"]')).toHaveCount(1);
  await expect(page).toHaveURL(/\?round=technical-round-1$/);

  // Topic within the round.
  await page.getByRole("group", { name: "Topics" }).getByRole("button", { name: /Behavioral/ }).click();
  await expect(page.locator('li[id^="q-"]')).toHaveCount(1);
  await page.getByRole("button", { name: /Copy 1 question as a prompt for an AI assistant/ }).click();
  await expect(page.getByRole("status").last()).toHaveText(/Copied 1 question as a prompt\. Paste it into ChatGPT, Claude or Gemini\./);
  const prompt = await clipboard(page);
  expect(prompt).toContain(`I'm preparing for my ${company} SDE 1 interview. Below is 1 interview question that candidates have publicly reported from their own ${company} SDE 1 interviews (Technical Round 1 · Behavioral), grouped by round.`);
  expect(prompt).toContain("Questions:\n\nTechnical Round 1\n1. [Behavioral] Tell me about a time you missed a deadline.");
  expect(prompt).toContain(`Source: ${new URL(page.url()).origin}${rolePath}`);

  // Search across every round, and the filters survive a reload.
  await page.getByRole("button", { name: /Show all 13 questions/ }).click();
  await page.getByLabel("Search questions").fill("lru");
  await expect(page.locator('li[id^="q-"]')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel("Search questions")).toHaveValue("lru");
  await expect(page.locator('li[id^="q-"]')).toHaveCount(1);
  await expect(page.getByText("Reported by 3 candidates")).toBeVisible();
  await expect(page.getByRole("link", { name: /Practice on leetcode\.com/ })).toHaveAttribute("href", "https://leetcode.com/problems/lru-cache/");
  await page.getByRole("button", { name: /Copy 1 question as a plain list/ }).click();
  expect(await clipboard(page)).toBe(`${company} SDE 1 — interview questions reported by candidates (matching “lru”)\n\nTechnical Round 1\n1. Design an LRU cache\n\nSource: ${new URL(page.url()).origin}${rolePath}`);

  // Everything: four rounds, thirteen questions, numbered across rounds in the prompt.
  await page.getByRole("button", { name: /Show all 13 questions/ }).click();
  await expect(page.locator('section[id^="round-"]')).toHaveCount(4);
  await page.getByRole("button", { name: /Copy 13 questions as a prompt/ }).click();
  const all = await clipboard(page);
  expect(all).toContain("\n13. ");
  // A round with no reported question isn't put in the prompt.
  expect(all).not.toContain("\nOnline Assessment\n");
});

test("role page on a phone: round picker, copy in reach, nothing wider than the screen", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  await page.goto(rolePath);
  await expect(page.getByRole("navigation", { name: "Rounds" })).toBeHidden();
  await page.getByLabel("Round", { exact: true }).selectOption("bar-raiser");
  await expect(page.locator('li[id^="q-"]')).toHaveCount(2);
  await expect(page.getByText("Showing 2 of 13 questions")).toBeVisible();
  // The copy button stays in reach (sticky) while reading the questions.
  const copy = page.getByRole("button", { name: /Copy 2 questions as a prompt/ });
  await page.locator("#round-bar-raiser li").last().scrollIntoViewIfNeeded();
  await expect(copy).toBeInViewport();
  // On a phone the questions come straight after the process; the official sources follow them.
  const order = await page.evaluate(() => [document.getElementById("questions")!.getBoundingClientRect().top, document.getElementById("official-heading")!.getBoundingClientRect().top]);
  expect(order[0]).toBeLessThan(order[1]!);
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Bar Raiser");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `.data/e2e-results/interview-role-mobile.png`, fullPage: false });
  await context.close();
});

test("/interviews and the company page lead to the role; the earlier role address redirects", async ({ page }) => {
  await page.goto("/interviews");
  const section = page.locator(`section:has(h2 a:text-is("${company}"))`);
  await expect(section.getByRole("link", { name: /SDE 1/ })).toHaveAttribute("href", rolePath);
  await section.getByRole("link", { name: company }).click();
  await expect(page).toHaveURL(new RegExp(`/interviews/${companySlug}$`));
  await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible();
  // The company-wide official source is on the company's page.
  await expect(page.getByRole("link", { name: /Acme: how we hire/ })).toHaveAttribute("href", "https://acme.example/hire");
  await expect(page.getByRole("link", { name: new RegExp(`${company} SDE 1`) })).toHaveAttribute("href", rolePath);
  await page.goto(`/interviews/${companySlug}/sde-1`);
  await expect(page).toHaveURL(new RegExp(`${rolePath}$`));
});

test("cleanup: move the pages to the Trash", async ({ page }) => {
  await login(page);
  await call(page, "POST", "/api/admin/documents/bulk", { operationId: crypto.randomUUID(), ids, action: { action: "trash" } });
});
