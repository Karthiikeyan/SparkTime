import "server-only";
import { createHash } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { documentPath } from "@/lib/content/paths";
import { fieldByRole, type Properties } from "@/lib/content/properties";
import { INDEXINGS, PUBLICATIONS, publicationFields, publicationOutcome, type Indexing, type Outcome, type Publication } from "@/lib/content/publication";
import { interviewFacts, nameKey } from "@/lib/interviews/directory";
import { analyzeImportPackage, indexFloor, type ImportPackage, type PlannedPage } from "@/lib/interviews/import-package";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb, type Db } from "../db/client";
import { documents } from "../db/schema";
import { conflict, invalid } from "../errors";
import { recordAudit } from "./audit";
import { loadContentTypes, type ContentType } from "./content-types";
import { importCreateDocument, runDocumentAction, saveDocument } from "./documents";

/**
 * Studio → Import, for a company's interview research (import.json): the only
 * way research reaches the CMS. It shares the publishing layer with every
 * other import (docs/content-publishing-redesign.md):
 *
 *   preview — validates the package, compares every page with what exists and
 *             shows each page's RESULT under the chosen options (publication,
 *             indexing, which pages to include). Reads only.
 *   import  — re-plans with the same options and requires the preview's token
 *             (package + options + every target's version), so what is
 *             imported is exactly what was previewed. New pages are created,
 *             existing ones get their guide replaced (staged on a live page),
 *             then pages chosen as Published/Unlisted are published through
 *             the normal publish checks. A file never decides any of this.
 */

export type ImportAction = "create" | "update" | "blocked" | "skipped";

export type ImportResultState = Outcome & {
  status: string;
  visibility: string;
  robotsIndex: string;
  /** An existing live page whose new guide waits in a staged revision. */
  staged: boolean;
};

export type ImportItem = {
  role: string | null;
  title: string;
  /** The package's slug for the page (the key for per-page choices). */
  slug: string;
  /** The page's actual address after the import: the existing page's, or the one a new page will get. */
  path: string;
  action: ImportAction;
  /** The owner's choices for this page (defaults applied). */
  include: boolean;
  publication: Publication;
  indexing: Indexing;
  /** What the page will be after the import. Null when it isn't imported. */
  result: ImportResultState | null;
  /** Why it will (or won't) be indexed. */
  indexNote: string;
  target: { id: string; title: string; status: string; visibility: string; robotsIndex: string; path: string; staged: boolean } | null;
  advice: PlannedPage["advice"];
  accounts: number;
  period: string;
  rounds: Array<{ name: string; reports: number; questions: number; review: number }>;
  questions: number;
  /** Questions held back from the public page until reviewed. */
  review: number;
  byCategory: Array<{ label: string; count: number }>;
  official: number;
  /** Questions still waiting for a decision, with the research's reason. */
  reviewItems: PlannedPage["review"];
  /** For an update: questions added, removed and kept, by round and research key. */
  diff: { added: number; removed: number; kept: number } | null;
  /** Problems that stop this page (and only this page) from being imported. */
  errors: string[];
};

export type InterviewImportPreview = {
  /** Something can be imported and nothing stops the package as a whole. */
  ok: boolean;
  /** Package-level problems: nothing can be imported. */
  errors: string[];
  warnings: string[];
  company: string;
  researchRun: string;
  typeIndexable: boolean;
  options: ImportOptions;
  items: ImportItem[];
  notIncluded: ImportPackage["notIncluded"];
  /** indexed: live and indexed after the import; indexWhenLive: drafts that will be indexed once published. */
  totals: { create: number; update: number; blocked: number; skipped: number; publish: number; unlisted: number; draft: number; indexed: number; indexWhenLive: number; questions: number; review: number };
  token: string;
};

export type InterviewImportResult = {
  imported: Array<{ id: string; title: string; created: boolean; staged: boolean; outcome: string; note: string | null }>;
  failed: Array<{ title: string; message: string }>;
  skipped: number;
  affectsPublic: boolean;
};

type Existing = { id: string; title: string; status: string; visibility: string; robotsIndex: string; version: number; slug: string; company: string; role: string; staged: boolean; keys: Set<string> };

const pageOptions = z.strictObject({ include: z.boolean().optional(), publication: z.enum(PUBLICATIONS).optional(), indexing: z.enum(INDEXINGS).optional() });
const optionsSchema = z.strictObject({
  publication: z.enum(PUBLICATIONS).default("draft"),
  indexing: z.enum(INDEXINGS).default("auto"),
  /** Per-page overrides, keyed by the package page's slug. */
  pages: z.record(z.string().max(96), pageOptions).default({}),
});
export type ImportOptions = z.infer<typeof optionsSchema>;

export async function interviewType(db: Db): Promise<ContentType> {
  const type = (await loadContentTypes(db)).find((t) => t.template === "interview" && !t.archivedAt);
  if (!type) throw invalid("There is no Interview Experiences content type yet. Install it once with `npm run interviews:install -- --apply`.");
  return type;
}

export function fieldKeys(type: ContentType) {
  const company = fieldByRole(type.fields, "interviewCompany")?.key;
  const role = fieldByRole(type.fields, "interviewRole")?.key;
  const guide = type.fields.find((f) => f.type === "interview_guide");
  if (!company || !role || !guide) throw invalid(`The "${type.name}" type needs Company and Role fields (with their interview roles) and an interview guide. Run \`npm run interviews:install\` to upgrade it.`);
  return { company, role, guide };
}

const questionKeys = (rounds: Array<{ id: string; questions: Array<{ id: string }> }>) => new Set(rounds.flatMap((r) => r.questions.map((q) => `${r.id}/${q.id}`)));

/** Every slug the type holds, the Trash included — exactly what uniqueSlug() checks — with the title holding it. */
async function slugHolders(db: Db, type: ContentType): Promise<Map<string, { title: string; trashed: boolean }>> {
  const rows = await db.select({ slug: documents.slug, title: documents.title, status: documents.status }).from(documents).where(eq(documents.typeId, type.id));
  return new Map(rows.map((r) => [r.slug, { title: r.title || "Untitled", trashed: r.status === "trashed" }]));
}

/** The slug uniqueSlug() will give a new page: the package's, or the first free numbered one. */
function predictSlug(base: string, taken: Map<string, unknown>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 90)}-${attempt + 1}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

/** Every interview page outside the Trash, read as the editor sees it (staged edits and held questions included). */
async function existingPages(db: Db, type: ContentType): Promise<Existing[]> {
  const rows = await db
    .select({ id: documents.id, title: documents.title, status: documents.status, visibility: documents.visibility, robotsIndex: documents.robotsIndex, version: documents.version, slug: documents.slug, properties: documents.properties, workingCopy: documents.workingCopy })
    .from(documents)
    .where(and(eq(documents.typeId, type.id), ne(documents.status, "trashed")));
  return rows.map((row) => {
    const staged = row.workingCopy && typeof row.workingCopy === "object" ? (row.workingCopy as { properties?: Properties }).properties : undefined;
    const facts = interviewFacts(type.fields, (staged ?? row.properties ?? {}) as Properties, { includeHeld: true });
    return { id: row.id, title: row.title || "Untitled", status: row.status, visibility: row.visibility, robotsIndex: row.robotsIndex, version: row.version, slug: row.slug, company: facts.company, role: facts.role, staged: row.workingCopy !== null, keys: questionKeys(facts.guide.rounds) };
  });
}

/** Indexing for a page: an explicit choice wins; Automatic applies research advice only above the quality floor, and never changes an existing page. */
function resolveRobots(page: PlannedPage, indexing: Indexing, target: Existing | null): { robotsIndex: string; note: string } {
  if (indexing === "index") return { robotsIndex: "index", note: "Search engines: Index, your choice." };
  if (indexing === "noindex") return { robotsIndex: "noindex", note: "Search engines: Noindex, your choice." };
  const floor = indexFloor(page);
  const wouldIndex = page.advice.indexing === "INDEX" && floor.ok;
  if (target) {
    const current = target.robotsIndex === "index" ? "index" : "noindex";
    const differs = wouldIndex !== (current === "index");
    return { robotsIndex: target.robotsIndex, note: differs ? `Search engines: Automatic keeps the page's current setting (${current}); the research now suggests ${wouldIndex ? "index" : "noindex"}. Choose it explicitly to change.` : `Search engines: Automatic keeps the page's current setting (${current}).` };
  }
  if (page.advice.indexing === "HOLD") return { robotsIndex: "noindex", note: "Search engines: kept out (Automatic follows the advice)." };
  if (!floor.ok) return { robotsIndex: "noindex", note: `Search engines: kept out — the INDEX advice isn't applied automatically because the page has ${floor.reason}. Choose Index to override.` };
  return { robotsIndex: "index", note: "Search engines: indexed once live (Automatic follows the advice)." };
}

/** The page's state after the import, under the chosen publication. */
function resultState(publication: Publication, robotsIndex: string, target: Existing | null, typeIndexable: boolean): ImportResultState {
  let status: string;
  let visibility: string;
  let staged = false;
  if (publication === "draft") {
    // A draft choice never touches what is live: a published page gets a staged revision.
    status = target ? target.status : "draft";
    visibility = target ? target.visibility : "public";
    staged = target?.status === "published";
  } else {
    ({ status, visibility } = publicationFields(publication));
  }
  return { ...publicationOutcome({ status, visibility, robotsIndex, typeIndexable }), status, visibility, robotsIndex, staged };
}

async function plan(db: Db, input: unknown) {
  const body = z.object({ package: z.unknown(), options: z.unknown().optional() }).safeParse(input);
  if (!body.success) throw invalid("Choose a company's import.json.");
  const parsedOptions = optionsSchema.safeParse(body.data.options ?? {});
  if (!parsedOptions.success) throw invalid("Invalid import options.");
  const options = parsedOptions.data;
  const type = await interviewType(db);
  const keys = fieldKeys(type);
  const analysis = analyzeImportPackage(body.data.package, keys.guide.options.choices ?? []);
  const errors = [...analysis.errors];
  const warnings = [...analysis.warnings];
  const pkg = analysis.pkg;
  const all = pkg ? await existingPages(db, type) : [];
  const holders = pkg ? await slugHolders(db, type) : new Map<string, { title: string; trashed: boolean }>();
  const sameCompany = pkg ? all.filter((p) => nameKey(p.company) === nameKey(pkg.company)) : [];
  if (pkg) {
    for (const name of new Set(sameCompany.map((p) => p.company))) if (name !== pkg.company) warnings.push(`Existing pages spell the company "${name}"; this package says "${pkg.company}". Use one spelling.`);
  }

  const items: Array<ImportItem & { page: PlannedPage; targetVersion: number | null; newSlug: string }> = analysis.pages.map((page) => {
    const matches = sameCompany.filter((p) => nameKey(p.role) === nameKey(page.role ?? ""));
    const itemErrors = [...(analysis.pageErrors[page.slug] ?? [])];
    let target: Existing | null = null;
    if (matches.length > 1) {
      itemErrors.push(`${matches.length} pages already exist for ${page.role ?? "the company page"} (${matches.map((m) => `"${m.title}"`).join(", ")}). Keep one; move the others to the Trash, or run \`npm run interviews:install\` if they are rounds from the earlier format.`);
    } else if (matches.length === 1) {
      target = matches[0]!;
      if (target.status === "archived") itemErrors.push(`"${target.title}" is archived (and still public). Set it back to draft first.`);
    }
    const own = options.pages[page.slug] ?? {};
    const include = own.include ?? true;
    const publication = own.publication ?? options.publication;
    const indexing = own.indexing ?? options.indexing;
    const action: ImportAction = itemErrors.length ? "blocked" : !include ? "skipped" : target ? "update" : "create";
    // The address a new page will really get (the preview never shows one it won't have).
    let slug = target?.slug ?? page.slug;
    if (!target) {
      slug = predictSlug(page.slug, holders);
      const holder = holders.get(page.slug);
      if (slug !== page.slug && holder) {
        warnings.push(
          holder.trashed
            ? `${page.title}: /${type.slug}/${page.slug} still belongs to "${holder.title}" in the Trash, so a new page would be created at /${type.slug}/${slug}. To keep the address, restore that page from the Trash and import again (it is then updated), or delete it permanently first.`
            : `${page.title}: /${type.slug}/${page.slug} is taken by "${holder.title}", so the new page will be at /${type.slug}/${slug}.`,
        );
      }
      if (action === "create") holders.set(slug, { title: page.title, trashed: false });
    }
    const robots = resolveRobots(page, indexing, target);
    const incoming = questionKeys(page.guide.rounds);
    return {
      role: page.role,
      title: page.title,
      slug: page.slug,
      path: documentPath(type, slug),
      action,
      include,
      publication,
      indexing,
      result: action === "create" || action === "update" ? resultState(publication, robots.robotsIndex, target, type.indexable) : null,
      indexNote: robots.note,
      target: target ? { id: target.id, title: target.title, status: target.status, visibility: target.visibility, robotsIndex: target.robotsIndex, path: documentPath(type, target.slug), staged: target.staged } : null,
      advice: page.advice,
      accounts: page.guide.accounts,
      period: page.guide.period,
      rounds: page.guide.rounds.map((r) => ({ name: r.name, reports: r.reports, questions: r.questions.length, review: r.questions.filter((q) => q.review).length })),
      questions: page.stats.questions,
      review: page.stats.review,
      byCategory: page.stats.byCategory.map((c) => ({ label: c.label, count: c.count })),
      official: page.guide.official.length,
      reviewItems: page.review,
      diff: target ? { added: [...incoming].filter((k) => !target.keys.has(k)).length, removed: [...target.keys].filter((k) => !incoming.has(k)).length, kept: [...incoming].filter((k) => target.keys.has(k)).length } : null,
      errors: itemErrors,
      page,
      targetVersion: target?.version ?? null,
      newSlug: slug,
    };
  });

  const importing = items.filter((i) => i.action === "create" || i.action === "update");
  const token = createHash("sha256")
    .update(JSON.stringify(body.data.package ?? null))
    .update(JSON.stringify(options))
    .update(JSON.stringify(items.map((i) => [i.slug, i.path, i.action, i.target?.id ?? null, i.targetVersion])))
    .digest("hex");
  const preview: InterviewImportPreview = {
    ok: errors.length === 0 && importing.length > 0,
    errors,
    warnings,
    company: pkg?.company ?? "",
    researchRun: pkg?.researchRun ?? "",
    typeIndexable: type.indexable,
    options,
    items: items.map(({ page: _page, targetVersion: _version, newSlug: _slug, ...item }) => item),
    notIncluded: pkg?.notIncluded ?? [],
    totals: {
      create: items.filter((i) => i.action === "create").length,
      update: items.filter((i) => i.action === "update").length,
      blocked: items.filter((i) => i.action === "blocked").length,
      skipped: items.filter((i) => i.action === "skipped").length,
      publish: importing.filter((i) => i.publication === "published").length,
      unlisted: importing.filter((i) => i.publication === "unlisted").length,
      draft: importing.filter((i) => i.publication === "draft").length,
      indexed: importing.filter((i) => i.result?.indexed).length,
      indexWhenLive: importing.filter((i) => i.result && !i.result.live && i.result.indexedWhenLive).length,
      questions: importing.reduce((n, i) => n + i.questions, 0),
      review: importing.reduce((n, i) => n + i.review, 0),
    },
    token,
  };
  return { preview, items, type, keys, pkg };
}

/** Validate a company's import.json and show what each page would become under the chosen options. Reads only. */
export async function previewInterviewImport(actor: Actor, input: unknown): Promise<InterviewImportPreview> {
  assertAdmin(actor);
  return (await plan(getDb(), input)).preview;
}

/**
 * Re-plans with the same options and requires the preview's token, then
 * imports page by page: the company page first, then each role. A page that
 * fails is reported and the rest continue; previewing again offers what's
 * left as updates.
 */
export async function runInterviewImport(actor: Actor, input: unknown): Promise<InterviewImportResult> {
  assertAdmin(actor);
  const token = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(input);
  if (!token.success) throw invalid("Preview the package first.");
  const db = getDb();
  const { preview, items, type, keys, pkg } = await plan(db, input);
  if (!preview.ok || !pkg) throw invalid(`The package isn't ready to import: ${preview.errors[0] ?? "nothing selected to import"}`);
  if (token.data.token !== preview.token) throw conflict("The package, your choices or the existing pages changed since the preview. Preview again.");

  const day = new Date().toISOString().slice(0, 10);
  const result: InterviewImportResult = { imported: [], failed: [], skipped: items.filter((i) => i.action === "skipped").length, affectsPublic: false };
  for (const item of items) {
    if (item.action !== "create" && item.action !== "update") continue;
    const { page } = item;
    const robotsIndex = item.result!.robotsIndex as "default" | "index" | "noindex";
    const note = `Imported ${day} from research run ${pkg.researchRun} (research/interviews/${nameKey(pkg.company)}/): ${page.stats.questions} questions in ${page.stats.rounds} rounds, ${page.stats.review} held for review. Advice: ${page.advice.indexing} — ${page.advice.reason}`;
    let id: string;
    let staged = false;
    try {
      if (item.action === "create") {
        const created = await db.transaction((tx) =>
          importCreateDocument(actor, tx, {
            typeId: type.id,
            title: page.title,
            slug: item.newSlug,
            status: "draft",
            visibility: item.result!.visibility as "public" | "unlisted",
            excerpt: page.excerpt,
            content: { type: "doc", content: [] },
            properties: { [keys.company]: pkg.company, ...(page.role ? { [keys.role]: page.role } : {}), [keys.guide.key]: page.guide },
            featuredMediaId: null,
            seoTitle: page.seoTitle,
            seoDescription: page.seoDescription,
            canonicalUrl: null,
            robotsIndex,
            notes: note,
            featured: false,
            priority: 0,
            createdAt: null,
            publishedAt: null,
            modifiedAt: null,
            categoryIds: [],
            tagIds: [],
          }),
        );
        id = created.id;
      } else {
        id = item.target!.id;
        const [row] = await db.select({ properties: documents.properties, workingCopy: documents.workingCopy, notes: documents.notes }).from(documents).where(eq(documents.id, id));
        const base = ((row?.workingCopy as { properties?: Properties } | null)?.properties ?? row?.properties ?? {}) as Properties;
        // Only the guide is replaced; title, text, company, role and SEO text stay as edited.
        const saved = await saveDocument(actor, id, {
          expectedVersion: item.targetVersion ?? undefined,
          body: { properties: { ...base, [keys.guide.key]: page.guide } },
          settings: {
            notes: [row?.notes, note].filter(Boolean).join("\n\n").slice(-20000),
            ...(robotsIndex !== item.target!.robotsIndex ? { robotsIndex } : {}),
            ...(item.publication !== "draft" && item.result!.visibility !== item.target!.visibility ? { visibility: item.result!.visibility as "public" | "unlisted" } : {}),
          },
        });
        staged = saved.stagedChanges;
        if (saved.affectsPublic) result.affectsPublic = true;
      }
    } catch (error) {
      result.failed.push({ title: page.title, message: error instanceof Error ? error.message : "Import failed." });
      continue;
    }

    // Publishing is a separate step through the normal checks, so a page that isn't ready stays a draft and says why.
    let publishNote: string | null = null;
    if (item.publication !== "draft") {
      try {
        await runDocumentAction(actor, id, { action: "publish" });
        staged = false;
        result.affectsPublic = true;
      } catch (error) {
        publishNote = `Imported but not published: ${error instanceof Error ? error.message : "publishing failed"}`;
      }
    }
    const outcome = staged ? "Live page unchanged; update staged" : publishNote ? "Draft" : item.result!.label;
    const summary = `${item.action === "create" ? "Imported" : "Updated"} ${page.title}: ${outcome.toLowerCase()}${item.result!.indexed && !publishNote ? ", indexed" : ""}`;
    await recordAudit(actor, "interview.import", "document", id, summary, { researchRun: pkg.researchRun, questions: page.stats.questions, held: page.stats.review, advice: page.advice.indexing, publication: item.publication, robotsIndex, published: item.publication !== "draft" && !publishNote });
    result.imported.push({ id, title: item.target?.title ?? page.title, created: item.action === "create", staged, outcome, note: publishNote });
  }
  await recordAudit(actor, "interview.import-company", "interview_company", nameKey(pkg.company) || null, `Imported ${pkg.company}: ${result.imported.length} of ${items.length} pages${result.failed.length ? `, ${result.failed.length} failed` : ""}`, {
    company: pkg.company,
    researchRun: pkg.researchRun,
    created: result.imported.filter((i) => i.created).length,
    updated: result.imported.filter((i) => !i.created).length,
    published: result.imported.filter((i) => i.outcome === "Published" || i.outcome === "Unlisted").length,
    skipped: result.skipped,
    failed: result.failed.map((f) => f.title),
  });
  return result;
}
