import { and, eq } from "drizzle-orm";
import { deriveContent } from "@/lib/content/derive";
import type { Db } from "../db/client";
import { categories, contentTypeFields, contentTypes, documents, navigationItems, siteSettings } from "../db/schema";
import { RECOMMENDED_FOOTER, RECOMMENDED_PRIMARY } from "@/lib/navigation-presets";
import { SEED_CATEGORIES, SEED_JOURNEY, SEED_PAGES, SEED_TYPES, doc, p, type SeedCategory } from "./data";

/**
 * Idempotent: every entity is inserted only if its slug/key is absent, so
 * re-running never overwrites edits made in the CMS.
 */
export async function seedDatabase(db: Db, log: (message: string) => void = () => undefined): Promise<void> {
  // Content types + fields
  const typeIds = new Map<string, string>();
  for (const [position, t] of SEED_TYPES.entries()) {
    const [existing] = await db.select({ id: contentTypes.id }).from(contentTypes).where(eq(contentTypes.slug, t.slug)).limit(1);
    if (existing) {
      typeIds.set(t.slug, existing.id);
      continue;
    }
    const [row] = await db
      .insert(contentTypes)
      .values({
        name: t.name,
        pluralName: t.pluralName,
        slug: t.slug,
        description: t.description,
        template: t.template,
        schemaType: t.schemaType,
        icon: t.icon,
        routing: t.routing ?? "type",
        isSystem: t.isSystem ?? false,
        indexable: t.indexable ?? true,
        inFeeds: t.inFeeds ?? true,
        showInQuickCreate: t.showInQuickCreate ?? true,
        position,
      })
      .returning({ id: contentTypes.id });
    typeIds.set(t.slug, row!.id);
    if (t.fields.length) {
      await db.insert(contentTypeFields).values(
        t.fields.map((f, i) => ({
          contentTypeId: row!.id,
          key: f.key,
          label: f.label,
          type: f.type,
          role: f.role ?? null,
          required: f.required ?? false,
          helpText: f.helpText ?? "",
          options: f.options ?? {},
          showInFacts: f.showInFacts ?? true,
          position: i,
        })),
      );
    }
    log(`content type: ${t.name}`);
  }

  // Categories (two levels)
  const insertCategory = async (c: SeedCategory, parentId: string | null, position: number) => {
    const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, c.slug)).limit(1);
    let id = existing?.id;
    if (!id) {
      const [row] = await db
        .insert(categories)
        .values({ name: c.name, slug: c.slug, description: c.description, parentId, position, featured: c.featured ?? false, accent: c.accent ?? null })
        .returning({ id: categories.id });
      id = row!.id;
      log(`category: ${c.name}`);
    }
    for (const [i, child] of (c.children ?? []).entries()) await insertCategory(child, id, i);
  };
  for (const [i, c] of SEED_CATEGORIES.entries()) await insertCategory(c, null, i);

  // Pages
  const pageTypeId = typeIds.get("page")!;
  const pageIds = new Map<string, string>();
  for (const page of SEED_PAGES) {
    const [existing] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.typeId, pageTypeId), eq(documents.slug, page.slug))).limit(1);
    if (existing) {
      pageIds.set(page.slug, existing.id);
      continue;
    }
    const derived = deriveContent(page.content);
    const now = new Date();
    const [row] = await db
      .insert(documents)
      .values({
        typeId: pageTypeId,
        title: page.title,
        slug: page.slug,
        status: page.status,
        visibility: "public",
        excerpt: page.excerpt,
        content: page.content,
        notes: page.notes,
        ...derived,
        publishedAt: page.status === "published" ? now : null,
      })
      .returning({ id: documents.id });
    pageIds.set(page.slug, row!.id);
    log(`page: /${page.slug} (${page.status})`);
  }

  // Journey chapters (drafts until filled in)
  const journeyTypeId = typeIds.get("journey")!;
  for (const chapter of SEED_JOURNEY) {
    const [existing] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.typeId, journeyTypeId), eq(documents.slug, chapter.slug))).limit(1);
    if (existing) continue;
    await db.insert(documents).values({
      typeId: journeyTypeId,
      title: chapter.title,
      slug: chapter.slug,
      status: "draft",
      visibility: "public",
      excerpt: chapter.excerpt,
      content: chapter.content,
      ...deriveContent(chapter.content),
    });
    log(`journey chapter (draft): ${chapter.title}`);
  }

  // Curated collections bound to /start-here and /uses (drafts, empty).
  const collectionTypeId = typeIds.get("collection")!;
  const ensureCollection = async (slug: string, title: string, excerpt: string) => {
    const [existing] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.typeId, collectionTypeId), eq(documents.slug, slug))).limit(1);
    if (existing) return existing.id;
    const content = doc(p(excerpt));
    const [row] = await db
      .insert(documents)
      .values({ typeId: collectionTypeId, title, slug, status: "draft", visibility: "public", excerpt, content, ...deriveContent(content) })
      .returning({ id: documents.id });
    log(`collection (draft): ${title}`);
    return row!.id;
  };
  const startHereId = await ensureCollection("start-here-path", "Start here", "A guided path through the essentials.");
  const toolkitId = await ensureCollection("toolkit", "Toolkit", "The tools and resources I actually use.");

  // Settings that bind structure together (only if never set).
  const [pagesRow] = await db.select().from(siteSettings).where(eq(siteSettings.key, "pages")).limit(1);
  if (!pagesRow) {
    await db.insert(siteSettings).values({
      key: "pages",
      value: { journeyTypeId, usesCollectionId: toolkitId, startHereCollectionId: startHereId, sparktribe: { url: "", tagId: null, categoryId: null } },
    });
    log("settings: pages bindings");
  }

  // Navigation (only if empty): the recommended menus (lib/navigation-presets.ts).
  // Links to an empty section or an unpublished page hide themselves, so the
  // menu grows with the site.
  const [anyNav] = await db.select({ id: navigationItems.id }).from(navigationItems).limit(1);
  if (!anyNav) {
    for (const [position, item] of RECOMMENDED_PRIMARY.entries()) {
      await db.insert(navigationItems).values({ location: "primary", position, label: item.label, linkType: "internal", href: item.href });
    }
    for (const [gi, group] of RECOMMENDED_FOOTER.entries()) {
      const [g] = await db.insert(navigationItems).values({ location: "footer", position: gi, label: group.label, linkType: "group" }).returning({ id: navigationItems.id });
      for (const [position, item] of group.children.entries()) {
        await db.insert(navigationItems).values({ location: "footer", parentId: g!.id, position, label: item.label, linkType: "internal", href: item.href });
      }
    }
    log("navigation: primary + footer");
  }
}
