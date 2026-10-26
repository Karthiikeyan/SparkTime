import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { isValidSlug, RESERVED_ROOT_SLUGS, SYSTEM_PAGE_SLUGS } from "@/lib/slug";
import type { Db } from "../db/client";
import { categories, contentTypes, documents } from "../db/schema";
import { conflict, invalid } from "../errors";

/**
 * Categories (/money), content-type indexes (/article) and root pages
 * (/colophon) share the top-level URL namespace. This guard is the single
 * place that decides whether a slug is free there.
 */
export type RootOwner =
  | { kind: "category"; id?: string }
  | { kind: "type"; id?: string }
  | { kind: "page"; id?: string };

export async function assertRootSlugAvailable(db: Db, slug: string, owner: RootOwner): Promise<void> {
  if (!isValidSlug(slug)) throw invalid("Use lowercase letters, numbers and single hyphens (e.g. personal-finance).");
  if (RESERVED_ROOT_SLUGS.has(slug)) throw invalid(`"${slug}" is reserved by the site.`);
  if (SYSTEM_PAGE_SLUGS.has(slug) && owner.kind !== "page") throw invalid(`"${slug}" is reserved for a system page.`);

  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(owner.kind === "category" && owner.id ? and(eq(categories.slug, slug), ne(categories.id, owner.id)) : eq(categories.slug, slug))
    .limit(1);
  if (category) throw conflict(`A category already uses /${slug}.`);

  const [type] = await db
    .select({ id: contentTypes.id })
    .from(contentTypes)
    .where(owner.kind === "type" && owner.id ? and(eq(contentTypes.slug, slug), ne(contentTypes.id, owner.id)) : eq(contentTypes.slug, slug))
    .limit(1);
  if (type) throw conflict(`A content type already uses /${slug}.`);

  const [page] = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(contentTypes, eq(contentTypes.id, documents.typeId))
    .where(
      and(
        eq(contentTypes.routing, "root"),
        eq(documents.slug, slug),
        owner.kind === "page" && owner.id ? ne(documents.id, owner.id) : sql`true`,
      ),
    )
    .limit(1);
  if (page) throw conflict(`A page already uses /${slug}.`);
}
