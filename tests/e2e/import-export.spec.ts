import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { approve, login, planHash, previewHeading, stagingSql, stat, writeTree } from "./support/helpers";

/**
 * Import/export through the real UI against an ISOLATED local stack
 * (own database, local media, no R2). Run by hand:
 *   E2E_BASE_URL=http://localhost:3300 E2E_BROWSER=msedge E2E_DATABASE_URL=postgres://…:54339/postgres \
 *     npx playwright test tests/e2e/import-export.spec.ts
 * Corpus first: npx tsx tests/e2e/support/make-corpus.ts .data/staging-corpus
 */
const CORPUS = resolve(".data/staging-corpus");
const WORK = resolve(".data/e2e-work");
const DOWNLOADS = resolve(".data/e2e-downloads");
test.describe.configure({ mode: "serial" });

const sql = stagingSql();
test.afterAll(async () => {
  await sql.end();
});

let folderHash = "";

test("isolation: the staging server uses local media and an isolated database", async ({ page }) => {
  await login(page);
  await page.goto("/admin/settings");
  // The settings group is collapsed, so check the page text rather than visibility.
  await expect(page.getByText("Local (.data/media) — development only")).toBeAttached();
  await expect(page.getByText("Cloudflare R2")).toHaveCount(0);
  const [row] = await sql`select count(*)::int as n from studio.import_jobs`;
  expect(row!.n).toBe(0);
});

test("ZIP upload: dry-run preview of the whole corpus, then discard (nothing written)", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  await page.goto("/admin/import");
  const before = (await sql`select count(*)::int as n from studio.documents`)[0]!.n;
  await page.getByLabel("Choose files or a ZIP").setInputFiles(resolve(CORPUS, "site.zip"));
  await expect(previewHeading(page)).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText("Dry run — nothing has been written")).toBeVisible();
  folderHash = await planHash(page);
  expect(Number((await stat(page, "New documents")).replace(/\D/g, ""))).toBeGreaterThan(20);
  expect((await sql`select count(*)::int as n from studio.documents`)[0]!.n).toBe(before);
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Drop a folder, files or a ZIP archive here")).toBeVisible();
  expect((await sql`select count(*)::int as n from studio.import_jobs`)[0]!.n).toBe(0);
});

test("folder: preview shows topics, collections, collisions, blocked files; approve; import completes with media", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose a folder").setInputFiles(resolve(CORPUS, "site"));
  await expect(previewHeading(page)).toBeVisible({ timeout: 240_000 });

  // Same files as the ZIP → byte-identical plan.
  expect(await planHash(page)).toBe(folderHash);
  await expect(page.getByRole("heading", { name: "Folders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Collections and order" })).toBeVisible();
  await expect(page.getByText("Java from scratch").first()).toBeVisible();
  await expect(page.getByText("Python in modules").first()).toBeVisible();
  // Existing topics are reused, new ones proposed; the Tamil folder has no URL-safe topic and says so.
  await expect(page.getByText("has no URL-safe form").first()).toBeVisible();
  // Malformed front matter is blocked rather than imported as text.
  await page.getByLabel("Search documents").fill("malformed");
  await expect(page.getByText("Blocked").first()).toBeVisible();
  await page.getByLabel("Search documents").fill("");
  // Collisions inside the import are reported and resolved with suffixes.
  expect(Number((await stat(page, "Slug collisions")).replace(/\D/g, ""))).toBeGreaterThan(0);
  expect(Number((await stat(page, "Media to upload")).split(" ")[0]!)).toBe(3);
  // New documents default to drafts: nothing is published unless the owner chooses it here.
  await expect(page.getByRole("group", { name: "Imported items become" }).getByRole("radio", { name: "Drafts" })).toBeChecked();
  // The corpus's "interviews" folder would take /interviews, which the Interview Experiences format owns: the owner decides.
  await expect(page.getByText(/1 decision needed before importing/)).toBeVisible();
  await page.getByLabel("Topic for Interviews").selectOption("skip");
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByRole("button", { name: "Approve and import" })).toBeEnabled({ timeout: 60_000 });

  await approve(page);
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 240_000 });
  await expect(page.getByRole("link", { name: "View report" })).toBeVisible();

  const [counts] = await sql`select count(*)::int as documents,
      count(*) filter (where status = 'draft')::int as drafts
    from studio.documents where id in (select document_id from studio.portable_identities where document_id is not null)`;
  expect(counts!.documents).toBeGreaterThan(20);
  expect(counts!.drafts).toBe(counts!.documents);
  const [m] = await sql`select count(*)::int as n from studio.media`;
  expect(m!.n).toBe(3);
  const courses = await sql`select d.title, count(ci.id)::int as items from studio.documents d join studio.collection_items ci on ci.collection_id = d.id group by d.title order by d.title`;
  expect(Object.fromEntries(courses.map((c) => [c.title, c.items]))).toMatchObject({ "Java from scratch": 5, "Python in modules": 4, "SQL basics": 3 });
  const [dupes] = await sql`select count(*)::int as n from (select type_id, slug from studio.documents group by 1, 2 having count(*) > 1) x`;
  expect(dupes!.n).toBe(0);
  const [problems] = await sql`select count(*)::int as n from studio.import_items where status = 'failed'`;
  expect(problems!.n).toBe(0);
  // Backlinks exist both ways between consecutive lessons.
  const [rel] = await sql`select count(*)::int as n from studio.document_relations where origin = 'content'`;
  expect(rel!.n).toBeGreaterThan(5);
  // Order inside the course follows the numbers in the file names.
  const [first] = await sql`select d.title from studio.collection_items ci join studio.documents d on d.id = ci.document_id join studio.documents c on c.id = ci.collection_id where c.title = 'Java from scratch' order by ci.position limit 1`;
  expect(first!.title).toBe("Java from scratch: lesson 1");
});

test("resume: an import interrupted by a closed tab continues from Import history", async ({ page }) => {
  test.setTimeout(300_000);
  const root = resolve(WORK, "resume");
  rmSync(root, { recursive: true, force: true });
  const lessons = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`rs/courses/resume-course/0${i + 1}-part.md`, `# Resume part ${i + 1}\n\nBody ${i + 1} ${"வணக்கம் ".repeat(20)}`]));
  writeTree(root, { "rs/courses/resume-course/README.md": "---\ntitle: Resume Course\n---\nIntro", ...lessons });
  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose a folder").setInputFiles(resolve(root, "rs"));
  await expect(previewHeading(page)).toBeVisible({ timeout: 120_000 });
  // The browser "closes" before the first run request reaches the server.
  await page.route("**/api/admin/import/jobs/*/run", (route) => route.abort());
  await approve(page);
  await expect(page.getByText("Importing…")).toBeVisible();
  const jobId = new URL(page.url()).searchParams.get("job")!;
  await expect.poll(async () => (await sql`select status from studio.import_jobs where id = ${jobId}`)[0]!.status).toBe("running");
  expect((await sql`select count(*)::int as n from studio.documents where title like 'Resume part%'`)[0]!.n).toBe(0);
  await page.unroute("**/api/admin/import/jobs/*/run");
  await page.goto("/admin/import/history");
  await page.getByRole("row", { name: /rs|resume/i }).first().getByRole("link", { name: "Resume" }).click();
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 120_000 });
  expect((await sql`select count(*)::int as n from studio.documents where title like 'Resume part%'`)[0]!.n).toBe(6);
  const [course] = await sql`select count(ci.id)::int as n from studio.documents d join studio.collection_items ci on ci.collection_id = d.id where d.title = 'Resume Course'`;
  expect(course!.n).toBe(6);
});

test("cancel: cancelling an approved import before it runs writes nothing", async ({ page }) => {
  test.setTimeout(300_000);
  const root = resolve(WORK, "cancel");
  rmSync(root, { recursive: true, force: true });
  writeTree(root, { "cx/notes/cancel-one.md": "# Cancel one\n\nBody", "cx/notes/cancel-two.md": "# Cancel two\n\nBody" });
  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose a folder").setInputFiles(resolve(root, "cx"));
  await expect(previewHeading(page)).toBeVisible({ timeout: 120_000 });
  await page.route("**/api/admin/import/jobs/*/run", (route) => route.abort());
  await approve(page);
  await expect(page.getByText("Importing…")).toBeVisible();
  const jobId = new URL(page.url()).searchParams.get("job")!;
  await page.unroute("**/api/admin/import/jobs/*/run");
  await page.goto(`/admin/import/history/${jobId}`);
  await page.getByRole("button", { name: "Cancel import" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel import" }).click();
  // The request compiles on first use, so wait for the state rather than assuming it.
  await expect.poll(async () => (await sql`select status from studio.import_jobs where id = ${jobId}`)[0]!.status, { timeout: 60_000 }).toBe("cancelled");
  await page.reload();
  // Exact, case-sensitive: the status badge, not the "Cancelled" filter link.
  await expect(page.getByText("cancelled", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("cancelled", { exact: true })).toHaveCount(6); // the job and its five steps
  await expect(page.getByRole("button", { name: "Cancel import" })).toHaveCount(0);
  expect((await sql`select count(*)::int as n from studio.documents where title like 'Cancel %'`)[0]!.n).toBe(0);
  expect((await sql`select count(*)::int as n from studio.import_items where job_id = ${jobId} and status <> 'cancelled'`)[0]!.n).toBe(0);
});

test("retry: a failed publish is reported, retried without duplicates, and succeeds once fixed", async ({ page }) => {
  test.setTimeout(300_000);
  const root = resolve(WORK, "retry");
  rmSync(root, { recursive: true, force: true });
  writeTree(root, { "rt/notes/retry-ok.md": "# Retry ok\n\nFine.", "rt/notes/retry-todo.md": "# Retry todo\n\n[TODO] write this part" });
  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose a folder").setInputFiles(resolve(root, "rt"));
  await expect(previewHeading(page)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("group", { name: "Imported items become" }).getByText("Published", { exact: true }).click();
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByRole("button", { name: "Approve and import" })).toBeEnabled({ timeout: 60_000 });
  await approve(page);
  await expect(page.getByText("Import finished with problems")).toBeVisible({ timeout: 120_000 });
  const jobId = new URL(page.url()).searchParams.get("job")!;
  const docs = async () => (await sql`select count(*)::int as n from studio.documents where title like 'Retry %'`)[0]!.n;
  expect(await docs()).toBe(2);
  expect((await sql`select status from studio.documents where title = 'Retry ok'`)[0]!.status).toBe("published");
  expect((await sql`select status from studio.documents where title = 'Retry todo'`)[0]!.status).toBe("draft");
  // The failure stays visible in history.
  await page.goto(`/admin/import/history/${jobId}?status=failed`);
  await expect(page.getByText(/ready to publish/i).first()).toBeVisible();
  // Retry while still broken: same failure, no new documents.
  await page.getByRole("button", { name: /Retry 1 failed step/ }).click();
  await expect(page.getByText("Import finished with problems")).toBeVisible({ timeout: 120_000 });
  expect(await docs()).toBe(2);
  // Fix the content outside the import, retry again.
  await sql`update studio.documents set content = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Written now."}]}]}'::jsonb, plain_text = 'Written now.' where title = 'Retry todo'`;
  await page.goto(`/admin/import/history/${jobId}`);
  await page.getByRole("button", { name: /Retry 1 failed step/ }).click();
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 120_000 });
  expect(await docs()).toBe(2);
  expect((await sql`select status from studio.documents where title = 'Retry todo'`)[0]!.status).toBe("published");
  expect((await sql`select count(*)::int as n from studio.import_items where job_id = ${jobId} and status = 'failed'`)[0]!.n).toBe(0);
});

test("update: only the ticked field changes; everything else is preserved", async ({ page }) => {
  test.setTimeout(300_000);
  const root = resolve(WORK, "update");
  rmSync(root, { recursive: true, force: true });
  const v1 = { "up/gardening/roses/update-me.md": "---\ntitle: Update me\nexcerpt: Original excerpt\nseoTitle: Original SEO\ntags: [original-tag]\n---\nOriginal body text", "up/gardening/roses/leave-me.md": "---\ntitle: Leave me\n---\nUnchanged" };
  writeTree(resolve(root, "v1"), v1);
  writeTree(resolve(root, "v2"), { ...v1, "up/gardening/roses/update-me.md": "---\ntitle: Update me — new title\nexcerpt: New excerpt\nseoTitle: New SEO\ntags: [new-tag]\n---\nCompletely new body text" });
  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose a folder").setInputFiles(resolve(root, "v1/up"));
  await expect(previewHeading(page)).toBeVisible({ timeout: 120_000 });
  await approve(page);
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 120_000 });

  await page.goto("/admin/import");
  await page.getByLabel("Choose a folder").setInputFiles(resolve(root, "v2/up"));
  await expect(previewHeading(page)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/decisions? needed before importing/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and import" })).toBeDisabled();
  await page.getByRole("button", { name: "Skip all" }).click();
  await page.getByRole("button", { name: "Details for Update me — new title" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Update selected fields").check();
  await dialog.getByLabel("Update Excerpt", { exact: true }).check();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByRole("button", { name: "Approve and import" })).toBeEnabled({ timeout: 60_000 });
  await approve(page);
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 120_000 });

  const [d] = await sql`select title, excerpt, seo_title, plain_text, status, visibility, id from studio.documents where slug = 'update-me'`;
  expect(d).toMatchObject({ title: "Update me", excerpt: "New excerpt", seo_title: "Original SEO", status: "draft", visibility: "public" });
  expect(d!.plain_text).toContain("Original body text");
  const tags = await sql`select t.name from studio.document_tags dt join studio.tags t on t.id = dt.tag_id where dt.document_id = ${d!.id}`;
  expect(tags.map((t) => t.name)).toEqual(["original-tag"]);
  expect((await sql`select count(*)::int as n from studio.documents where slug like 'update-me%' or slug like 'leave-me%'`)[0]!.n).toBe(2);
});

test("export: published-only totals, selection by topic, and ZIP downloads (portable + Markdown)", async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(DOWNLOADS, { recursive: true });
  await login(page);
  await page.goto("/admin/export");

  // Published-only: nothing private or unpublished is counted.
  await expect(page.getByText("Counting…")).toHaveCount(0, { timeout: 30_000 });
  await page.getByLabel(/Include drafts, ideas, private and unlisted documents/).uncheck();
  await expect(page.locator("dt", { hasText: "Private or unpublished" }).locator("xpath=following-sibling::dd[1]")).toHaveText("0", { timeout: 30_000 });
  const publicCount = Number((await sql`select count(*)::int as n from studio.documents where status = 'published' and visibility = 'public'`)[0]!.n);
  expect(Number(await page.locator("dt", { hasText: /^Documents$/ }).locator("xpath=following-sibling::dd[1]").innerText())).toBe(publicCount);
  await page.getByLabel(/Include drafts, ideas, private and unlisted documents/).check();

  // Selection by topic shows its own count.
  await page.getByRole("radio", { name: "Topics (with sub-topics)" }).click();
  await page.getByRole("checkbox", { name: /Gardening/ }).first().check();
  await expect(page.locator("dt", { hasText: /^Documents$/ }).locator("xpath=following-sibling::dd[1]")).not.toHaveText("0", { timeout: 30_000 });
  await page.getByRole("radio", { name: "Entire site", exact: true }).click();

  // Portable package.
  await expect(page.getByRole("button", { name: "Export" })).toBeEnabled({ timeout: 30_000 });
  let [download] = await Promise.all([page.waitForEvent("download", { timeout: 300_000 }), page.getByRole("button", { name: "Export", exact: true }).click()]);
  await download.saveAs(resolve(DOWNLOADS, "portable.zip"));
  expect(download.suggestedFilename()).toMatch(/^studio-portable-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(page.getByText(/Downloaded studio-portable-/)).toBeVisible();

  // Readable Markdown.
  await page.getByRole("radio", { name: /Readable Markdown/ }).check();
  [download] = await Promise.all([page.waitForEvent("download", { timeout: 300_000 }), page.getByRole("button", { name: "Export", exact: true }).click()]);
  await download.saveAs(resolve(DOWNLOADS, "markdown.zip"));
  await expect(page.getByText(/Downloaded studio-markdown-/)).toBeVisible();

  // Record what the source site contains, for the re-import comparison.
  const stats = {
    documents: await sql`select t.slug as type, count(*)::int as n from studio.documents d join studio.content_types t on t.id = d.type_id where d.id in (select document_id from studio.portable_identities where document_id is not null) group by 1 order by 1`,
    media: (await sql`select count(*)::int as n from studio.media`)[0]!.n,
    courses: await sql`select c.title, count(ci.id)::int as items from studio.documents c join studio.collection_items ci on ci.collection_id = c.id group by c.title order by c.title`,
    firstLessons: await sql`select d.title from studio.collection_items ci join studio.documents d on d.id = ci.document_id join studio.documents c on c.id = ci.collection_id where c.title = 'Python in modules' order by ci.position limit 30`,
    tags: (await sql`select count(*)::int as n from studio.tags`)[0]!.n,
    manualRelations: (await sql`select count(*)::int as n from studio.document_relations where origin = 'manual'`)[0]!.n,
    contentRelations: (await sql`select count(*)::int as n from studio.document_relations where origin = 'content'`)[0]!.n,
    pids: (await sql`select portable_id from studio.portable_identities where entity = 'document' and portable_id like 'path:site/%' order by 1`).map((r) => r.portable_id),
  };
  writeFileSync(resolve(DOWNLOADS, "source-stats.json"), JSON.stringify(stats, null, 2));
});
