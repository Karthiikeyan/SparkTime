import "server-only";
import { cache } from "react";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { isUuid, sanitizeDoc, type Doc } from "@/lib/content/blocks";
import { isAccent, TAXONOMY_ROBOTS, type Accent, type TaxonomyRobots } from "@/lib/content/model";
import { isValidSlug, slugify } from "@/lib/slug";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb, type Db } from "../db/client";
import { categories, documentCategories, documentTags, navigationItems, tags, type CategoryRow, type TagRow } from "../db/schema";
import { conflict, invalid, notFound } from "../errors";
import { recordAudit } from "./audit";
import { assertRootSlugAvailable } from "./namespace";
import { clearRedirectFrom, upsertRedirect } from "./redirects";
import { refreshSearchExtra } from "./search-index";

export type Category = Omit<CategoryRow, "accent" | "robotsIndex" | "intro"> & {
  accent: Accent | null;
  robotsIndex: TaxonomyRobots;
  intro: Doc | null;
};
export type Tag = Omit<TagRow, "robotsIndex"> & { robotsIndex: TaxonomyRobots };

const MAX_CATEGORY_DEPTH = 3;

function toCategory(row: CategoryRow): Category {
  return {
    ...row,
    accent: isAccent(row.accent) ? row.accent : null,
    robotsIndex: (TAXONOMY_ROBOTS as readonly string[]).includes(row.robotsIndex) ? (row.robotsIndex as TaxonomyRobots) : "auto",
    intro: row.intro ? sanitizeDoc(row.intro) : null,
  };
}

function toTag(row: TagRow): Tag {
  return { ...row, robotsIndex: (TAXONOMY_ROBOTS as readonly string[]).includes(row.robotsIndex) ? (row.robotsIndex as TaxonomyRobots) : "auto" };
}

/** Taxonomy is public metadata; archived categories are filtered by callers. */
export const listCategories = cache(async (): Promise<Category[]> => {
  const rows = await getDb().select().from(categories).orderBy(asc(categories.position), asc(categories.name));
  return rows.map(toCategory);
});

export const listTags = cache(async (): Promise<Tag[]> => {
  const rows = await getDb().select().from(tags).orderBy(asc(tags.name));
  return rows.map(toTag);
});

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  if (!isValidSlug(slug)) return null;
  return (await listCategories()).find((c) => c.slug === slug) ?? null;
}

export async function getTagBySlug(slug: string): Promise<Tag | null> {
  if (!isValidSlug(slug)) return null;
  return (await listTags()).find((t) => t.slug === slug) ?? null;
}

/** Ancestors from root to the category itself (for breadcrumbs). */
export function categoryTrail(all: Category[], category: Category): Category[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  const trail: Category[] = [category];
  let current = category;
  for (let i = 0; i < MAX_CATEGORY_DEPTH && current.parentId; i++) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    trail.unshift(parent);
    current = parent;
  }
  return trail;
}

// ---------------------------------------------------------------------------
// Category mutations
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  slug: z.string().trim().max(96).optional(),
  description: z.string().trim().max(320).default(""),
  intro: z.unknown().optional(),
  parentId: z.string().nullable().optional(),
  accent: z.string().nullable().optional(),
  featured: z.boolean().default(false),
  seoTitle: z.string().trim().max(120).nullable().optional(),
  seoDescription: z.string().trim().max(320).nullable().optional(),
  robotsIndex: z.enum(TAXONOMY_ROBOTS).default("auto"),
});

function parseCategory(input: unknown) {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    const details: Record<string, string> = {};
    for (const issue of parsed.error.issues) details[issue.path.join(".")] = issue.message;
    throw invalid("Please fix the highlighted fields.", details);
  }
  const d = parsed.data;
  return {
    ...d,
    slug: d.slug ? d.slug : slugify(d.name),
    parentId: d.parentId && isUuid(d.parentId) ? d.parentId : null,
    accent: isAccent(d.accent) ? d.accent : null,
    intro: d.intro ? sanitizeDoc(d.intro) : null,
    seoTitle: d.seoTitle || null,
    seoDescription: d.seoDescription || null,
  };
}

async function assertValidParent(db: Db, id: string | null, parentId: string | null): Promise<void> {
  if (!parentId) return;
  if (parentId === id) throw invalid("A category cannot be its own parent.");
  const rows = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
  const byId = new Map(rows.map((r) => [r.id, r.parentId]));
  if (!byId.has(parentId)) throw invalid("Parent category does not exist.");
  let depth = 1;
  let cursor: string | null | undefined = parentId;
  while (cursor) {
    if (cursor === id) throw invalid("That would create a loop in the category tree.");
    cursor = byId.get(cursor);
    depth++;
    if (depth > MAX_CATEGORY_DEPTH) throw invalid(`Categories can be nested at most ${MAX_CATEGORY_DEPTH} levels deep.`);
  }
}

export async function createCategory(actor: Actor, input: unknown): Promise<Category> {
  assertAdmin(actor);
  const data = parseCategory(input);
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    await assertRootSlugAvailable(tx, data.slug, { kind: "category" });
    await assertValidParent(tx, null, data.parentId);
    await clearRedirectFrom(tx, `/${data.slug}`);
    const [{ maxPos } = { maxPos: 0 }] = await tx.select({ maxPos: sql<number>`coalesce(max(${categories.position}), 0)` }).from(categories);
    const [created] = await tx
      .insert(categories)
      .values({ ...data, position: Number(maxPos) + 1 })
      .returning();
    return created!;
  });
  await recordAudit(actor, "category.create", "category", row.id, data.name);
  return toCategory(row);
}

export async function updateCategory(actor: Actor, id: string, input: unknown): Promise<Category> {
  assertAdmin(actor);
  const db = getDb();
  const [current] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!current) throw notFound("Category");
  const data = parseCategory(input);
  const row = await db.transaction(async (tx) => {
    if (data.slug !== current.slug) {
      await assertRootSlugAvailable(tx, data.slug, { kind: "category", id });
      // Prefix, like content types: the topic's paginated pages (/old/page/2) move with it.
      await upsertRedirect(tx, { fromPath: `/${current.slug}`, toPath: `/${data.slug}`, matchType: "prefix", source: "slug-change" });
    }
    await assertValidParent(tx, id, data.parentId);
    const [updated] = await tx
      .update(categories)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .returning();
    if (data.name !== current.name) {
      const docs = await tx.select({ id: documentCategories.documentId }).from(documentCategories).where(eq(documentCategories.categoryId, id));
      await refreshSearchExtra(tx, docs.map((d) => d.id));
    }
    return updated!;
  });
  await recordAudit(actor, "category.update", "category", id, data.name);
  return toCategory(row);
}

export async function setCategoryArchived(actor: Actor, id: string, archived: boolean): Promise<void> {
  assertAdmin(actor);
  const updated = await getDb()
    .update(categories)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  if (!updated.length) throw notFound("Category");
  await recordAudit(actor, archived ? "category.archive" : "category.restore", "category", id);
}

export async function deleteCategory(actor: Actor, id: string): Promise<void> {
  assertAdmin(actor);
  const db = getDb();
  await db.transaction(async (tx) => {
    const docs = await tx.select({ id: documentCategories.documentId }).from(documentCategories).where(eq(documentCategories.categoryId, id));
    const deleted = await tx.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id, name: categories.name });
    if (!deleted.length) throw notFound("Category");
    await refreshSearchExtra(tx, docs.map((d) => d.id));
  });
  await recordAudit(actor, "category.delete", "category", id);
}

/**
 * Merge topic `sourceId` into `targetId`. Every document in the source gains
 * the target (keeping it primary where the source was primary), sub-topics
 * move under the target, navigation links follow, the old URL (and its
 * paginated pages) redirect to the target, and the source is removed.
 * Nothing is left pointing at a topic that no longer exists.
 */
export async function mergeCategories(actor: Actor, sourceId: string, targetId: string): Promise<{ documents: number; subtopics: number }> {
  assertAdmin(actor);
  if (!isUuid(sourceId) || !isUuid(targetId) || sourceId === targetId) throw invalid("Choose two different topics.");
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const all = await tx.select({ id: categories.id, parentId: categories.parentId, slug: categories.slug, name: categories.name }).from(categories);
    const byId = new Map(all.map((c) => [c.id, c]));
    const source = byId.get(sourceId);
    const target = byId.get(targetId);
    if (!source || !target) throw notFound("Topic");
    // The target can't sit inside the source: its sub-topics would be moved under themselves.
    const depthOf = (id: string | null): number => {
      let depth = 0;
      for (let cursor = id; cursor; cursor = byId.get(cursor)?.parentId ?? null) {
        if (cursor === sourceId && id !== sourceId) throw invalid(`“${target.name}” is inside “${source.name}”. Merge into a topic outside it.`);
        depth++;
      }
      return depth;
    };
    const height = (id: string): number => 1 + Math.max(0, ...all.filter((c) => c.parentId === id).map((c) => height(c.id)));
    const children = all.filter((c) => c.parentId === sourceId);
    const targetDepth = depthOf(targetId);
    for (const child of children) {
      if (targetDepth + height(child.id) > MAX_CATEGORY_DEPTH) throw invalid(`Moving “${child.name}” under “${target.name}” would nest topics more than ${MAX_CATEGORY_DEPTH} levels deep. Move it first.`);
    }

    const links = await tx.select().from(documentCategories).where(eq(documentCategories.categoryId, sourceId));
    const docIds = links.map((l) => l.documentId);
    const already = new Set(
      docIds.length
        ? (await tx.select({ id: documentCategories.documentId }).from(documentCategories).where(and(eq(documentCategories.categoryId, targetId), inArray(documentCategories.documentId, docIds)))).map((r) => r.id)
        : [],
    );
    const adding = links.filter((l) => !already.has(l.documentId));
    if (adding.length) await tx.insert(documentCategories).values(adding.map((l) => ({ documentId: l.documentId, categoryId: targetId, isPrimary: l.isPrimary })));
    const promote = links.filter((l) => l.isPrimary && already.has(l.documentId)).map((l) => l.documentId);
    if (promote.length) await tx.update(documentCategories).set({ isPrimary: true }).where(and(eq(documentCategories.categoryId, targetId), inArray(documentCategories.documentId, promote)));

    if (children.length) await tx.update(categories).set({ parentId: targetId, updatedAt: new Date() }).where(eq(categories.parentId, sourceId));
    await tx.update(navigationItems).set({ refId: targetId, updatedAt: new Date() }).where(and(eq(navigationItems.linkType, "category"), eq(navigationItems.refId, sourceId)));
    await tx.delete(categories).where(eq(categories.id, sourceId));
    await upsertRedirect(tx, { fromPath: `/${source.slug}`, toPath: `/${target.slug}`, matchType: "prefix", source: "slug-change" });
    await refreshSearchExtra(tx, docIds);
    return { documents: docIds.length, subtopics: children.length, source, target };
  });
  await recordAudit(actor, "category.merge", "category", targetId, `Merged “${result.source.name}” into “${result.target.name}”`, {
    sourceId,
    sourceSlug: result.source.slug,
    documents: result.documents,
    subtopics: result.subtopics,
  });
  return { documents: result.documents, subtopics: result.subtopics };
}

export async function reorderCategories(actor: Actor, orderedIds: string[]): Promise<void> {
  assertAdmin(actor);
  if (!Array.isArray(orderedIds) || !orderedIds.every(isUuid)) throw invalid("Invalid order.");
  await getDb().transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) await tx.update(categories).set({ position: index }).where(eq(categories.id, id));
  });
}

// ---------------------------------------------------------------------------
// Tag mutations
// ---------------------------------------------------------------------------

const tagSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(60),
  slug: z.string().trim().max(96).optional(),
  description: z.string().trim().max(500).default(""),
  robotsIndex: z.enum(TAXONOMY_ROBOTS).default("auto"),
});

function parseTag(input: unknown) {
  const parsed = tagSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid tag.");
  const slug = parsed.data.slug || slugify(parsed.data.name);
  if (!isValidSlug(slug)) throw invalid("Use lowercase letters, numbers and single hyphens.");
  return { ...parsed.data, slug };
}

export async function createTag(actor: Actor, input: unknown): Promise<Tag> {
  assertAdmin(actor);
  const data = parseTag(input);
  const db = getDb();
  const [existing] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, data.slug)).limit(1);
  if (existing) throw conflict(`A tag with the URL /tag/${data.slug} already exists.`);
  const [row] = await db.insert(tags).values(data).returning();
  await recordAudit(actor, "tag.create", "tag", row!.id, data.name);
  return toTag(row!);
}

export async function updateTag(actor: Actor, id: string, input: unknown): Promise<Tag> {
  assertAdmin(actor);
  const db = getDb();
  const [current] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  if (!current) throw notFound("Tag");
  const data = parseTag(input);
  const row = await db.transaction(async (tx) => {
    if (data.slug !== current.slug) {
      const [clash] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.slug, data.slug)).limit(1);
      if (clash) throw conflict(`A tag with the URL /tag/${data.slug} already exists.`);
      await upsertRedirect(tx, { fromPath: `/tag/${current.slug}`, toPath: `/tag/${data.slug}`, source: "slug-change" });
    }
    const [updated] = await tx.update(tags).set({ ...data, updatedAt: new Date() }).where(eq(tags.id, id)).returning();
    if (data.name !== current.name) {
      const docs = await tx.select({ id: documentTags.documentId }).from(documentTags).where(eq(documentTags.tagId, id));
      await refreshSearchExtra(tx, docs.map((d) => d.id));
    }
    return updated!;
  });
  await recordAudit(actor, "tag.update", "tag", id, data.name);
  return toTag(row);
}

export async function deleteTag(actor: Actor, id: string): Promise<void> {
  assertAdmin(actor);
  await getDb().transaction(async (tx) => {
    const docs = await tx.select({ id: documentTags.documentId }).from(documentTags).where(eq(documentTags.tagId, id));
    const deleted = await tx.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id });
    if (!deleted.length) throw notFound("Tag");
    await refreshSearchExtra(tx, docs.map((d) => d.id));
  });
  await recordAudit(actor, "tag.delete", "tag", id);
}

/** Merge `sourceId` into `targetId`: documents are retagged and the old URL redirects. */
export async function mergeTags(actor: Actor, sourceId: string, targetId: string): Promise<void> {
  assertAdmin(actor);
  if (sourceId === targetId) throw invalid("Choose two different tags.");
  const db = getDb();
  await db.transaction(async (tx) => {
    const found = await tx.select().from(tags).where(inArray(tags.id, [sourceId, targetId]));
    const source = found.find((t) => t.id === sourceId);
    const target = found.find((t) => t.id === targetId);
    if (!source || !target) throw notFound("Tag");
    const docs = await tx.select({ id: documentTags.documentId }).from(documentTags).where(eq(documentTags.tagId, sourceId));
    for (const doc of docs) {
      await tx.insert(documentTags).values({ documentId: doc.id, tagId: targetId }).onConflictDoNothing();
    }
    await tx.delete(tags).where(eq(tags.id, sourceId));
    await upsertRedirect(tx, { fromPath: `/tag/${source.slug}`, toPath: `/tag/${target.slug}`, source: "slug-change" });
    await refreshSearchExtra(tx, docs.map((d) => d.id));
  });
  await recordAudit(actor, "tag.merge", "tag", targetId, `Merged ${sourceId} into ${targetId}`);
}

/** Find-or-create tags by display name (inline tag entry in the editor). */
export async function ensureTags(actor: Actor, db: Db, names: string[]): Promise<string[]> {
  assertAdmin(actor);
  const ids: string[] = [];
  for (const raw of names.slice(0, 50)) {
    const name = raw.trim().slice(0, 60);
    if (!name) continue;
    const slug = slugify(name);
    if (!isValidSlug(slug)) continue;
    const [existing] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).limit(1);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const [created] = await db.insert(tags).values({ name, slug }).onConflictDoNothing().returning({ id: tags.id });
    if (created) ids.push(created.id);
    else {
      const [again] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).limit(1);
      if (again) ids.push(again.id);
    }
  }
  return [...new Set(ids)];
}

export type TaxonomyUsage = { categories: Record<string, number>; tags: Record<string, number> };

/** Document counts per category/tag across ALL documents (admin view). */
export async function taxonomyUsage(actor: Actor): Promise<TaxonomyUsage> {
  assertAdmin(actor);
  const db = getDb();
  const [catCounts, tagCounts] = await Promise.all([
    db.select({ id: documentCategories.categoryId, n: count() }).from(documentCategories).groupBy(documentCategories.categoryId),
    db.select({ id: documentTags.tagId, n: count() }).from(documentTags).groupBy(documentTags.tagId),
  ]);
  return {
    categories: Object.fromEntries(catCounts.map((r) => [r.id, Number(r.n)])),
    tags: Object.fromEntries(tagCounts.map((r) => [r.id, Number(r.n)])),
  };
}

export async function rootCategories(): Promise<Category[]> {
  return (await listCategories()).filter((c) => !c.parentId && !c.archivedAt);
}
