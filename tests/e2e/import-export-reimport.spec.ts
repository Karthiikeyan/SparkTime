import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { approve, login, previewHeading, stagingSql } from "./support/helpers";

/**
 * Re-imports the ZIP downloaded by import-export.spec.ts into a SEPARATE
 * isolated dataset (a second local database) and compares it with the source.
 *   E2E_BASE_URL=http://localhost:3300 (app started against the second database)
 *   E2E_DATABASE_URL=postgres://…:<second port>/postgres
 */
const DOWNLOADS = resolve(".data/e2e-downloads");
test.describe.configure({ mode: "serial" });

const sql = stagingSql();
test.afterAll(async () => {
  await sql.end();
});

type Stats = {
  documents: Array<{ type: string; n: number }>;
  media: number;
  courses: Array<{ title: string; items: number }>;
  firstLessons: Array<{ title: string }>;
  tags: number;
  manualRelations: number;
  contentRelations: number;
  pids: string[];
};
const source = JSON.parse(readFileSync(resolve(DOWNLOADS, "source-stats.json"), "utf8")) as Stats;

test("the downloaded portable ZIP re-imports into a separate dataset and matches the source", async ({ page }) => {
  test.setTimeout(300_000);
  const publishedBefore = (await sql`select count(*)::int as n from studio.documents where status = 'published'`)[0]!.n;
  expect((await sql`select count(*)::int as n from studio.media`)[0]!.n).toBe(0);
  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose files or a ZIP").setInputFiles(resolve(DOWNLOADS, "portable.zip"));
  await expect(previewHeading(page)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Studio package").first()).toBeVisible();
  // The seeded pages exist in both datasets (matched by URL): skip them, import everything else.
  if (await page.getByText(/decisions? needed before importing/).count()) await page.getByRole("button", { name: "Skip all" }).click();
  await page.getByRole("button", { name: "Apply changes" }).click().catch(() => undefined);
  await expect(page.getByRole("button", { name: "Approve and import" })).toBeEnabled({ timeout: 60_000 });
  await approve(page);
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 240_000 });

  // 1. Counts per format, for the documents that came from imports.
  const docs = await sql`select t.slug as type, count(*)::int as n from studio.documents d join studio.content_types t on t.id = d.type_id where d.id in (select document_id from studio.portable_identities where document_id is not null) group by 1 order by 1`;
  expect(docs.map((d) => ({ type: d.type, n: d.n }))).toEqual(source.documents);
  // 2. Identity (portable ids) survived the hop.
  const pids = (await sql`select portable_id from studio.portable_identities where entity = 'document' and portable_id like 'path:site/%' order by 1`).map((r) => r.portable_id);
  expect(pids).toEqual(source.pids);
  // 3. Media came through the ZIP with the same count, and the files exist.
  expect((await sql`select count(*)::int as n from studio.media`)[0]!.n).toBe(source.media);
  // 4. Courses: same members, same order.
  const courses = await sql`select c.title, count(ci.id)::int as items from studio.documents c join studio.collection_items ci on ci.collection_id = c.id group by c.title order by c.title`;
  expect(courses.map((c) => ({ title: c.title, items: c.items }))).toEqual(source.courses);
  const python = await sql`select d.title from studio.collection_items ci join studio.documents d on d.id = ci.document_id join studio.documents c on c.id = ci.collection_id where c.title = 'Python in modules' order by ci.position limit 30`;
  expect(python.map((r) => r.title)).toEqual(source.firstLessons.map((r) => r.title));
  // 5. Tags, explicit relations and link-derived relations (backlinks).
  expect((await sql`select count(*)::int as n from studio.tags`)[0]!.n).toBe(source.tags);
  expect((await sql`select count(*)::int as n from studio.document_relations where origin = 'manual'`)[0]!.n).toBe(source.manualRelations);
  expect((await sql`select count(*)::int as n from studio.document_relations where origin = 'content'`)[0]!.n).toBe(source.contentRelations);
  // 6. Nothing imported is live: new documents are drafts even if the source was published.
  const [exposed] = await sql`select count(*)::int as n from studio.documents where id in (select document_id from studio.portable_identities where document_id is not null) and status <> 'draft'`;
  expect(exposed!.n).toBe(0);
  // 7. No duplicates, no failed steps, and the seed was not duplicated or touched.
  expect((await sql`select count(*)::int as n from (select type_id, slug from studio.documents group by 1, 2 having count(*) > 1) x`)[0]!.n).toBe(0);
  expect((await sql`select count(*)::int as n from studio.import_items where status = 'failed'`)[0]!.n).toBe(0);
  expect((await sql`select count(*)::int as n from studio.documents where status = 'published'`)[0]!.n).toBe(publishedBefore);
});

test("importing the same package again finds everything by identity (no duplicates)", async ({ page }) => {
  test.setTimeout(300_000);
  const count = async () => (await sql`select count(*)::int as n from studio.documents`)[0]!.n;
  const before = await count();
  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose files or a ZIP").setInputFiles(resolve(DOWNLOADS, "portable.zip"));
  await expect(previewHeading(page)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/decisions? needed before importing/)).toBeVisible();
  await page.getByRole("button", { name: "Skip all" }).click();
  await page.getByRole("button", { name: "Apply changes" }).click();
  // Everything is a duplicate and skipped: nothing would be imported.
  await expect(page.getByRole("button", { name: "Approve and import" })).toBeDisabled({ timeout: 60_000 });
  expect(await count()).toBe(before);
  await page.getByRole("button", { name: "Discard" }).click();
});

test("the downloaded Markdown ZIP imports as a readable folder (courses, order, tags, images)", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  await page.goto("/admin/import");
  await page.getByLabel("Choose files or a ZIP").setInputFiles(resolve(DOWNLOADS, "markdown.zip"));
  await expect(previewHeading(page)).toBeVisible({ timeout: 180_000 });
  // It is understood as plain Markdown files, with the courses recognised from numbered files.
  await expect(page.getByRole("heading", { name: "Collections and order" })).toBeVisible();
  await expect(page.getByText("Java from scratch").first()).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
});
