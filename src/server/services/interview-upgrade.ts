import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { documentPath } from "@/lib/content/paths";
import type { FieldDefinition, SelectOption } from "@/lib/content/model";
import type { Properties } from "@/lib/content/properties";
import { nameKey } from "@/lib/interviews/directory";
import { DEFAULT_INTERVIEW_CATEGORIES, isDifficulty, QUESTION_ID_PATTERN, roundId, type GuideRound, type InterviewGuide } from "@/lib/interviews/guide";
import { slugify } from "@/lib/slug";
import type { AdminActor } from "../auth/actor";
import { getDb, type Db } from "../db/client";
import { documents } from "../db/schema";
import { recordAudit } from "./audit";
import { loadContentTypes, updateContentType, type ContentType } from "./content-types";
import { importCreateDocument, loadRow, trashRow } from "./documents";
import { upsertRedirect } from "./redirects";

/**
 * Upgrades an Interview Experiences type from the earlier one-page-per-round
 * format (fields Round, Round order and a question list) to one page per
 * company × role with an interview guide:
 *
 *  1. the type's fields become Company, Role (optional: empty = the company's
 *     page) and Interview guide; the question categories carry over;
 *  2. each company × role's round pages become ONE draft holding
 *     those rounds and their questions (counts that only the research knows
 *     start at 0 — re-import the company's research to fill them);
 *  3. the round pages move to the Trash (restorable), and a published one's
 *     address redirects to its role's new page.
 *
 * Nothing is published. Stored values of removed fields stay in the
 * documents' JSON. `plan` reads only; `apply` does it.
 */

type LegacyQuestion = { id?: unknown; text?: unknown; category?: unknown; difficulty?: unknown; practiceUrl?: unknown; reports?: unknown; review?: unknown };
type LegacyRound = { id: string; title: string; status: string; slug: string; path: string; round: string; order: number | null; questions: LegacyQuestion[] };

export type UpgradePlan = {
  type: ContentType | null;
  /** The type still has the earlier fields. */
  needsFields: boolean;
  categories: SelectOption[];
  groups: Array<{ company: string; role: string; title: string; slug: string; rounds: LegacyRound[]; questions: number }>;
  /** Pages of the earlier format that can't be placed (no company or role). Left alone. */
  unplaced: Array<{ id: string; title: string }>;
};

const isLegacyField = (f: FieldDefinition) => (f.type as string) === "question_list" || (f.role as string | null) === "interviewRound" || (f.role as string | null) === "interviewRoundOrder";

export async function planInterviewUpgrade(db: Db): Promise<UpgradePlan> {
  const type = (await loadContentTypes(db)).find((t) => t.template === "interview" && !t.archivedAt) ?? null;
  if (!type) return { type: null, needsFields: false, categories: DEFAULT_INTERVIEW_CATEGORIES, groups: [], unplaced: [] };
  const legacyList = type.fields.find((f) => (f.type as string) === "question_list");
  const roundField = type.fields.find((f) => (f.role as string | null) === "interviewRound");
  const orderField = type.fields.find((f) => (f.role as string | null) === "interviewRoundOrder");
  const companyField = type.fields.find((f) => f.role === "interviewCompany");
  const roleField = type.fields.find((f) => f.role === "interviewRole");
  const needsFields = type.fields.some(isLegacyField) || !type.fields.some((f) => f.type === "interview_guide") || Boolean(roleField?.required);
  const categories = legacyList?.options.choices?.length ? legacyList.options.choices : (type.fields.find((f) => f.type === "interview_guide")?.options.choices ?? DEFAULT_INTERVIEW_CATEGORIES);
  if (!roundField) return { type, needsFields, categories, groups: [], unplaced: [] };

  const rows = await db
    .select({ id: documents.id, title: documents.title, status: documents.status, slug: documents.slug, properties: documents.properties, workingCopy: documents.workingCopy })
    .from(documents)
    .where(and(eq(documents.typeId, type.id), ne(documents.status, "trashed")));
  const groups = new Map<string, UpgradePlan["groups"][number]>();
  const unplaced: UpgradePlan["unplaced"] = [];
  for (const row of rows) {
    const props = (((row.workingCopy as { properties?: Properties } | null)?.properties ?? row.properties) ?? {}) as Record<string, unknown>;
    const round = typeof props[roundField.key] === "string" ? String(props[roundField.key]).trim() : "";
    if (!round) continue; // already a company or role page
    const company = companyField && typeof props[companyField.key] === "string" ? String(props[companyField.key]).trim() : "";
    const role = roleField && typeof props[roleField.key] === "string" ? String(props[roleField.key]).trim() : "";
    if (!nameKey(company) || !nameKey(role)) {
      unplaced.push({ id: row.id, title: row.title });
      continue;
    }
    const key = `${nameKey(company)}/${nameKey(role)}`;
    const group = groups.get(key) ?? { company, role, title: `${company} ${role} Interview Experiences`, slug: slugify(`${company} ${role}`), rounds: [], questions: 0 };
    const questions = legacyList && Array.isArray(props[legacyList.key]) ? (props[legacyList.key] as LegacyQuestion[]) : [];
    const order = orderField && typeof props[orderField.key] === "number" ? (props[orderField.key] as number) : null;
    group.rounds.push({ id: row.id, title: row.title, status: row.status, slug: row.slug, path: documentPath(type, row.slug), round, order, questions });
    group.questions += questions.length;
    groups.set(key, group);
  }
  for (const g of groups.values()) g.rounds.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.round.localeCompare(b.round, "en", { numeric: true }));
  return { type, needsFields, categories, groups: [...groups.values()], unplaced };
}

function toGuide(rounds: LegacyRound[], categories: Set<string>): InterviewGuide {
  const used = new Set<string>();
  const guideRounds: GuideRound[] = [];
  for (const r of rounds) {
    let id = roundId(r.round) || "round";
    for (let n = 2; used.has(id); n++) id = `${roundId(r.round) || "round"}-${n}`;
    used.add(id);
    const ids = new Set<string>();
    guideRounds.push({
      id,
      name: r.round.slice(0, 80),
      reports: 0,
      summary: "",
      questions: r.questions.flatMap((q, i) => {
        const text = typeof q.text === "string" ? q.text.trim() : "";
        if (!text) return [];
        let qid = typeof q.id === "string" && QUESTION_ID_PATTERN.test(q.id) ? q.id : `q${String(i + 1).padStart(2, "0")}`;
        while (ids.has(qid)) qid = `${qid.slice(0, 36)}-${ids.size}`;
        ids.add(qid);
        return [
          {
            id: qid,
            text: text.slice(0, 500),
            category: typeof q.category === "string" && categories.has(q.category) ? q.category : categories.has("other") ? "other" : [...categories][0]!,
            difficulty: isDifficulty(q.difficulty) ? q.difficulty : null,
            practiceUrl: typeof q.practiceUrl === "string" && q.practiceUrl.startsWith("https://") ? q.practiceUrl : null,
            reports: typeof q.reports === "number" && Number.isInteger(q.reports) && q.reports >= 0 ? Math.min(q.reports, 9999) : 0,
            review: q.review === true,
          },
        ];
      }),
    });
  }
  return { accounts: 0, period: "", researched: "", highlights: [], preparation: [], official: [], sequences: [], rounds: guideRounds };
}

export type UpgradeResult = { fieldsUpdated: boolean; created: Array<{ id: string; title: string }>; trashed: number; redirected: number };

export async function applyInterviewUpgrade(actor: AdminActor, db: Db = getDb()): Promise<UpgradeResult> {
  const plan = await planInterviewUpgrade(db);
  const result: UpgradeResult = { fieldsUpdated: false, created: [], trashed: 0, redirected: 0 };
  if (!plan.type) return result;
  let type = plan.type;

  if (plan.needsFields) {
    const company = type.fields.find((f) => f.role === "interviewCompany");
    const role = type.fields.find((f) => f.role === "interviewRole");
    const guide = type.fields.find((f) => f.type === "interview_guide");
    // An existing field keeps its id (and so its stored values); its definition is brought up to date.
    const keep = (f: FieldDefinition | undefined, next: Partial<FieldDefinition>) => ({ ...next, id: f?.id });
    type = await updateContentType(actor, type.id, {
      name: type.name === "Interview collection" ? "Interview page" : type.name,
      pluralName: type.pluralName,
      slug: type.slug,
      description: type.description,
      template: type.template,
      schemaType: type.schemaType,
      icon: type.icon,
      indexable: type.indexable,
      inFeeds: type.inFeeds,
      showInQuickCreate: type.showInQuickCreate,
      fields: [
        keep(company, { key: company?.key ?? "company", label: company?.label ?? "Company", type: "text", role: "interviewCompany", required: true, showInFacts: false, helpText: "As candidates name it, e.g. Amazon. Use the same spelling on every page.", options: {} }),
        keep(role, { key: role?.key ?? "jobRole", label: role?.label ?? "Role", type: "text", role: "interviewRole", required: false, showInFacts: false, helpText: "e.g. SDE 1. Leave empty on the company's own page.", options: {} }),
        keep(guide, { key: guide?.key ?? "guide", label: guide?.label ?? "Interview guide", type: "interview_guide", role: null, required: false, showInFacts: false, helpText: "Edited below the body.", options: { choices: plan.categories } }),
      ],
    });
    result.fieldsUpdated = true;
  }

  const companyKey = type.fields.find((f) => f.role === "interviewCompany")!.key;
  const roleKey = type.fields.find((f) => f.role === "interviewRole")!.key;
  const guideKey = type.fields.find((f) => f.type === "interview_guide")!.key;
  const categories = new Set((type.fields.find((f) => f.type === "interview_guide")?.options.choices ?? plan.categories).map((c) => c.value));

  for (const group of plan.groups) {
    await db.transaction(async (tx) => {
      const created = await importCreateDocument(actor, tx, {
        typeId: type.id,
        title: group.title,
        slug: group.slug,
        status: "draft",
        visibility: "public",
        excerpt: `Interview rounds and questions candidates have reported for ${group.company} ${group.role}.`,
        content: { type: "doc", content: [] },
        properties: { [companyKey]: group.company, [roleKey]: group.role, [guideKey]: toGuide(group.rounds, categories) },
        featuredMediaId: null,
        seoTitle: null,
        seoDescription: null,
        canonicalUrl: null,
        robotsIndex: "noindex",
        notes: `Converted ${new Date().toISOString().slice(0, 10)} from ${group.rounds.length} round pages (${group.rounds.map((r) => r.title).join("; ")}), now in the Trash. Candidate counts, round summaries and official sources come from the research: re-import the company's import.json to fill them.`,
        featured: false,
        priority: 0,
        createdAt: null,
        publishedAt: null,
        modifiedAt: null,
        categoryIds: [],
        tagIds: [],
      });
      result.created.push({ id: created.id, title: group.title });
      for (const r of group.rounds) {
        // A published round's address leads to its role's page (live once that page is published).
        if (r.status === "published" || r.status === "archived") {
          await upsertRedirect(tx, { fromPath: r.path, toPath: created.path, matchType: "exact", statusCode: 308, source: "manual" });
          result.redirected++;
        }
        await trashRow(tx, await loadRow(tx, r.id, { lock: true }), actor);
        result.trashed++;
      }
    });
  }
  await recordAudit(actor, "interview.upgrade", "content_type", type.id, `Upgraded ${type.pluralName}: ${result.created.length} role pages from ${result.trashed} round pages`, { ...result, created: result.created.length });
  return result;
}
