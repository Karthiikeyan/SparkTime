import { expect, test, type Page } from "@playwright/test";
import { login } from "./support/helpers";

/**
 * Studio content operations end to end: search, filter, select (rows, page,
 * all matching across pages), bulk Draft + Undo, Trash, Restore, permanent
 * delete, public visibility after trashing, partial failures with Retry, and
 * the activity log.
 *
 * Mutating: run only against an isolated local server and database (see
 * playwright.config.ts and docs/ADMIN-OPERATIONS.md → Testing). Every
 * document it touches is a fixture it creates, titled with a unique stamp,
 * and the run ends by deleting them from the Trash.
 */

test.describe.configure({ mode: "serial" });

const stamp = `OpsQA${Date.now().toString(36)}`;
let articleType = "";
const published: string[] = [];

async function call<T = Record<string, unknown>>(page: Page, method: string, path: string, data?: unknown): Promise<T> {
  const res = await page.request.fetch(path, { method, data, headers: { origin: new URL(page.url()).origin, ...(data === undefined ? {} : { "content-type": "application/json" }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function fixture(page: Page, title: string, text: string, publish: boolean): Promise<string> {
  const { id } = await call<{ id: string }>(page, "POST", "/api/admin/documents", { typeId: articleType, title });
  const doc = await call<{ version: number }>(page, "GET", `/api/admin/documents/${id}`);
  await call(page, "PATCH", `/api/admin/documents/${id}`, { expectedVersion: doc.version, body: { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }, excerpt: "Synthetic QA fixture." } });
  if (publish) await call(page, "POST", `/api/admin/documents/${id}/actions`, { action: "publish" });
  return id;
}

const rowFor = (page: Page, title: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name: title, exact: true }) });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: /selected$/ });

test("setup: sign in and create fixtures", async ({ page }) => {
  await login(page);
  const { items } = await call<{ items: Array<{ id: string; slug: string }> }>(page, "GET", "/api/admin/content-types");
  articleType = items.find((t) => t.slug === "article")!.id;
  for (let i = 1; i <= 3; i++) published.push(await fixture(page, `${stamp} live ${i}`, `Published synthetic fixture number ${i} for ${stamp}.`, true));
  // 52 drafts: more than one page (50) of results for the same search.
  for (let i = 1; i <= 52; i++) await fixture(page, `${stamp} bulk ${String(i).padStart(2, "0")}`, `Draft synthetic fixture ${i}.`, false);
});

test("search, filter, select rows, move to Draft, then undo", async ({ page }) => {
  await login(page);
  await page.goto("/admin/documents");
  await page.getByRole("textbox", { name: "Search" }).fill(`${stamp} live`);
  await page.getByRole("combobox", { name: "Status" }).selectOption("published");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("3 documents match these filters.")).toBeVisible();

  await rowFor(page, `${stamp} live 1`).getByRole("checkbox").check();
  await rowFor(page, `${stamp} live 2`).getByRole("checkbox").check();
  await expect(toolbar(page)).toContainText("2 documents selected");

  await toolbar(page).getByRole("button", { name: "Draft" }).click();
  const confirm = page.getByRole("dialog", { name: "Move 2 documents to Draft?" });
  await expect(confirm).toContainText("2 published documents will be unpublished and disappear from the site.");
  await confirm.getByRole("button", { name: "Move to Draft" }).click();
  const done = page.getByRole("dialog", { name: "Move to Draft: done" });
  await expect(done).toContainText("2 documents moved to Draft.");
  await done.getByRole("button", { name: "Close", exact: true }).last().click();

  // The list was filtered to Published, so the two drafts leave it.
  await expect(page.getByText("1 document matches these filters.")).toBeVisible();
  const banner = page.getByRole("status").filter({ hasText: "2 documents moved to Draft." });
  await banner.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/Undone: 2 documents restored/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("3 documents match these filters.")).toBeVisible();
});

test("select all matching across pages, move to Trash, restore one, and the public site hides the rest", async ({ page, browser, baseURL }) => {
  await login(page);
  // Remember a live fixture's public URL before trashing it.
  const liveDoc = await call<{ path: string }>(page, "GET", `/api/admin/documents/${published[2]}`);

  await page.goto(`/admin/documents?q=${encodeURIComponent(stamp)}`);
  await expect(page.getByText("55 documents match these filters.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select all documents on this page" }).check();
  await expect(toolbar(page)).toContainText("50 documents selected");
  await page.getByRole("button", { name: "Select all 55 matching documents" }).click();
  await expect(toolbar(page)).toContainText("55 documents selected");
  // Deselect one row: "all matching" minus an exclusion.
  await rowFor(page, `${stamp} live 1`).getByRole("checkbox").uncheck();
  await expect(toolbar(page)).toContainText("54 documents selected");

  await toolbar(page).getByRole("button", { name: "Trash" }).click();
  const confirm = page.getByRole("dialog", { name: "Move 54 documents to Trash?" });
  await expect(confirm).toContainText("2 documents currently on the site will disappear immediately.");
  await confirm.getByRole("button", { name: "Move to Trash" }).click();
  const done = page.getByRole("dialog", { name: "Move to Trash: done" });
  await expect(done).toContainText("54 documents moved to Trash.", { timeout: 60_000 });
  await done.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(page.getByText("1 document matches these filters.")).toBeVisible();

  // Public: the trashed live page is gone and public search doesn't return it.
  const anonymous = await browser.newContext({ baseURL });
  const reader = await anonymous.newPage();
  expect((await reader.goto(liveDoc.path))?.status()).toBe(404);
  const search = await (await anonymous.request.get(`/api/search?q=${encodeURIComponent(`${stamp} live 3`)}`)).json() as { results?: Array<{ title: string }> };
  expect((search.results ?? []).map((r) => r.title)).not.toContain(`${stamp} live 3`);
  await anonymous.close();

  // Trash: restore one, and it is back as a draft.
  await page.goto("/admin/trash");
  await page.getByRole("button", { name: `Restore ${stamp} bulk 01` }).click();
  const restore = page.getByRole("dialog", { name: "Restore 1 document?" });
  await restore.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("dialog", { name: "Restore: done" }).getByRole("button", { name: "Close", exact: true }).last().click();
  await page.goto(`/admin/documents?q=${encodeURIComponent(`${stamp} bulk 01`)}`);
  await expect(rowFor(page, `${stamp} bulk 01`)).toContainText("Draft");
});

test("partial failure: one ready, one with a [TODO]; Retry failed reports it again", async ({ page }) => {
  await login(page);
  await fixture(page, `${stamp} ready`, "A complete fixture body.", false);
  await fixture(page, `${stamp} unfinished`, "[TODO] finish this fixture", false);
  await page.goto(`/admin/documents?q=${encodeURIComponent(stamp)}&status=draft`);
  await rowFor(page, `${stamp} ready`).getByRole("checkbox").check();
  await rowFor(page, `${stamp} unfinished`).getByRole("checkbox").check();
  await toolbar(page).getByRole("button", { name: "Publish" }).click();
  await page.getByRole("dialog", { name: "Publish 2 documents?" }).getByRole("button", { name: "Publish" }).click();
  const done = page.getByRole("dialog", { name: "Publish: finished with problems" });
  await expect(done).toContainText("1 document published.");
  await expect(done).toContainText("✕ 1 failed.");
  await expect(done).toContainText(`${stamp} unfinished`);
  await expect(done).toContainText("[TODO]");
  await done.getByRole("button", { name: "Retry failed (1)" }).click();
  await expect(page.getByRole("dialog", { name: "Publish: finished with problems" })).toContainText(`${stamp} unfinished`);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
  // The failure stays selected for follow-up.
  await expect(toolbar(page)).toContainText("1 document selected");
  await page.keyboard.press("Escape");
  await expect(toolbar(page)).toHaveCount(0);
});

test("permanent delete needs typed confirmation; activity log records the operations", async ({ page }) => {
  await login(page);
  await page.goto("/admin/trash");
  await page.getByRole("button", { name: `Delete ${stamp} bulk 02 permanently` }).click();
  const confirm = page.getByRole("dialog", { name: "Permanently delete 1 document?" });
  await expect(confirm).toContainText("This cannot be undone.");
  const go = confirm.getByRole("button", { name: "Permanently delete" });
  await expect(go).toBeDisabled();
  await confirm.getByLabel("Type 1 to confirm").fill("1");
  await go.click();
  const done = page.getByRole("dialog", { name: "Delete permanently: done" });
  await expect(done).toContainText("1 document permanently deleted.");
  await expect(done.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await done.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(page.getByRole("button", { name: `Delete ${stamp} bulk 02 permanently` })).toHaveCount(0);

  await page.goto("/admin/activity?scope=bulk");
  await expect(page.getByText("Move to Trash").first()).toBeVisible();
  await expect(page.getByText("54 requested").first()).toBeVisible();
  await expect(page.getByText("undone").first()).toBeVisible();
});

test("cleanup: delete every fixture", async ({ page }) => {
  await login(page);
  // Every fixture this spec has ever created here (an aborted run leaves its own behind), by the shared prefix, a page at a time.
  const page200 = (status: string) => call<{ items: Array<{ id: string }>; total: number }>(page, "GET", `/api/admin/documents?q=OpsQA&limit=200${status ? `&status=${status}` : ""}`);
  const run = async (ids: string[], action: Record<string, unknown>) => {
    const operationId = crypto.randomUUID();
    for (let i = 0; i < ids.length; i += 50) await call(page, "POST", "/api/admin/documents/bulk", { operationId, ids: ids.slice(i, i + 50), action });
  };
  for (let live = await page200(""); live.items.length; live = await page200("")) await run(live.items.map((i) => i.id), { action: "trash" });
  for (let bin = await page200("trashed"); bin.items.length; bin = await page200("trashed")) await run(bin.items.map((i) => i.id), { action: "delete", confirm: "permanently-delete" });
  expect((await page200("")).total + (await page200("trashed")).total).toBe(0);
});
