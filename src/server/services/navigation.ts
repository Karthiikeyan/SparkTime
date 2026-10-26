import "server-only";
import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { isUuid } from "@/lib/content/blocks";
import { categoryPath, typeIndexPath } from "@/lib/content/paths";
import type { FeatureSettings } from "@/lib/settings";
import { replacementFor } from "@/lib/legacy-paths";
import { isSafeInternalPath, safeExternalUrl } from "@/lib/url";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb } from "../db/client";
import { navigationItems, type NavigationItemRow } from "../db/schema";
import { invalid } from "../errors";
import { recordAudit } from "./audit";
import { listContentTypes } from "./content-types";
import { cardsByIds, publicTypeCounts, visibleCategories } from "./public-content";
import { isLivePath, sectionMatches } from "./sections";
import { loadAllSettings } from "./settings";

export type NavLocation = "primary" | "footer";
export type NavLinkType = "internal" | "external" | "content_type" | "category" | "document" | "group";

/**
 * `description` is borrowed from what the link points to (a content type's
 * description, a page's excerpt, a topic's description), so dropdowns can say
 * what's behind each link with nothing extra to maintain in the studio.
 * `match`: other path prefixes where this link is "you are here" — Writing on
 * /article/…, About on /now, Explore on a topic page (services/sections.ts).
 */
export type NavItem = { id: string; label: string; href: string | null; external: boolean; description: string | null; match: string[]; children: NavItem[] };

/** Every link in a menu, groups opened up: [About, Journey, Now, Projects…]. */
export function navLinks(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [...(item.href ? [item] : []), ...item.children.filter((child) => child.href)]);
}

/** Site paths that only exist while their feature is on (Settings → Features). */
export function disabledFeaturePaths(features: FeatureSettings): Set<string> {
  const off = new Set<string>();
  // The public graph was retired; saved menus that still link to it drop the link.
  off.add("/graph");
  if (!features.search) off.add("/search");
  if (!features.rss) off.add("/feed.xml");
  return off;
}

/** "/search?q=x#top" → "/search", so query strings and fragments can't sneak a link past the check. */
export function featurePath(href: string): string {
  return href.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
}

/**
 * Public navigation. Items that reference content resolve their URL at read
 * time; if the target is gone, archived or not public the item disappears.
 */
export const getNavigation = cache(async (location: NavLocation): Promise<NavItem[]> => {
  const rows = await getDb().select().from(navigationItems).where(eq(navigationItems.location, location)).orderBy(asc(navigationItems.position));
  const [types, cats, typeCounts, settings] = await Promise.all([listContentTypes(), visibleCategories(), publicTypeCounts(), loadAllSettings()]);
  const docIds = rows.filter((r) => r.linkType === "document" && r.refId).map((r) => r.refId!);
  const docs = new Map((await cardsByIds(docIds, "accessible")).map((c) => [c.id, c]));
  const disabled = disabledFeaturePaths(settings.features);
  // Internal links follow the same progressive rule as type and topic links: a
  // section with nothing in it, or a page that isn't published, hides itself.
  // A link saved before its path was retired (/explore) points at the replacement, not through a redirect.
  const internal = rows.filter((r) => r.linkType === "internal" && r.href && isSafeInternalPath(r.href)).map((r) => replacementFor(r.href!));
  const live = new Map(await Promise.all([...new Set(internal)].map(async (href) => [href, await isLivePath(href)] as const)));
  const hrefs = [...new Set([...internal, ...[...docs.values()].map((d) => d.path)])];
  const matches = new Map(await Promise.all(hrefs.map(async (href) => [href, await sectionMatches(href)] as const)));

  const resolve = (row: NavigationItemRow): { href: string | null; external: boolean; description?: string | null } | null => {
    switch (row.linkType) {
      case "internal":
        // A link to a feature switched off in Settings → Features would 404, so it disappears like any missing target.
        if (!row.href || !isSafeInternalPath(row.href) || disabled.has(featurePath(row.href))) return null;
        return live.get(replacementFor(row.href)) ? { href: replacementFor(row.href), external: false } : null;
      case "external": {
        const url = safeExternalUrl(row.href);
        return url ? { href: url, external: true } : null;
      }
      case "content_type": {
        // Progressive discovery: a section appears once it has published content.
        const type = types.find((t) => t.id === row.refId && !t.archivedAt);
        return type && (typeCounts.get(type.id) ?? 0) > 0 ? { href: typeIndexPath(type), external: false, description: type.description } : null;
      }
      case "category": {
        // Same progressive rule as content types: a menu never offers a topic
        // whose page would say "Nothing published here yet". The count includes
        // sub-topics, so a parent appears as soon as anything beneath it does.
        const cat = cats.find((c) => c.id === row.refId && !c.archivedAt);
        return cat && cat.count > 0 ? { href: categoryPath(cat.slug), external: false, description: cat.description } : null;
      }
      case "document": {
        const doc = row.refId ? docs.get(row.refId) : undefined;
        return doc ? { href: doc.path, external: false, description: doc.excerpt } : null;
      }
      case "group":
        return { href: null, external: false };
      default:
        return null;
    }
  };

  const visible = rows.filter((r) => r.visible);
  const build = (parentId: string | null): NavItem[] =>
    visible
      .filter((r) => r.parentId === parentId)
      .flatMap((row) => {
        const target = resolve(row);
        if (!target) return [];
        const children = build(row.id);
        if (row.linkType === "group" && !children.length) return [];
        // A dropdown holding one link is just that link (sections appear as they get content, so this happens early on).
        if (location === "primary" && row.linkType === "group" && children.length === 1) return children;
        const match = target.href && !target.external ? matches.get(target.href) ?? [] : [];
        return [{ id: row.id, label: row.label, href: target.href, external: target.external, description: target.description?.trim() || null, match, children }];
      });
  return build(null);
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

const itemSchema: z.ZodType<NavInput> = z.lazy(() =>
  z.object({
    label: z.string().trim().min(1).max(60),
    linkType: z.enum(["internal", "external", "content_type", "category", "document", "group"]),
    href: z.string().trim().max(2048).nullable().optional(),
    refId: z.string().nullable().optional(),
    visible: z.boolean().default(true),
    children: z.array(itemSchema).max(20).optional(),
  }),
);

export type NavInput = {
  label: string;
  linkType: NavLinkType;
  href?: string | null;
  refId?: string | null;
  visible?: boolean;
  children?: NavInput[];
};

export async function listNavigationItems(actor: Actor): Promise<NavigationItemRow[]> {
  assertAdmin(actor);
  return getDb().select().from(navigationItems).orderBy(asc(navigationItems.location), asc(navigationItems.position));
}

function validateItem(item: NavInput, depth: number): void {
  if (depth > 1) throw invalid("Menus support one level of nesting.");
  if (item.linkType === "internal" && !isSafeInternalPath(item.href)) throw invalid(`"${item.label}": internal links must start with “/”.`);
  if (item.linkType === "external" && !safeExternalUrl(item.href)) throw invalid(`"${item.label}": enter a full https:// URL.`);
  if (["content_type", "category", "document"].includes(item.linkType) && !isUuid(item.refId)) throw invalid(`"${item.label}": choose what it links to.`);
  for (const child of item.children ?? []) validateItem(child, depth + 1);
}

export async function replaceNavigation(actor: Actor, location: NavLocation, input: unknown): Promise<void> {
  assertAdmin(actor);
  if (location !== "primary" && location !== "footer") throw invalid("Unknown menu.");
  const parsed = z.array(itemSchema).max(30).safeParse(input);
  if (!parsed.success) throw invalid("Invalid menu items.");
  for (const item of parsed.data) validateItem(item, 0);
  if (location === "primary" && parsed.data.filter((i) => i.visible !== false).length > 7) {
    throw invalid("Keep the primary menu to seven items or fewer — use groups or the Explore page for the rest.");
  }

  await getDb().transaction(async (tx) => {
    await tx.delete(navigationItems).where(eq(navigationItems.location, location));
    const insert = async (items: NavInput[], parentId: string | null) => {
      for (const [position, item] of items.entries()) {
        const [row] = await tx
          .insert(navigationItems)
          .values({
            location,
            label: item.label,
            linkType: item.linkType,
            href: item.linkType === "internal" || item.linkType === "external" ? item.href ?? null : null,
            refId: ["content_type", "category", "document"].includes(item.linkType) ? item.refId ?? null : null,
            parentId,
            position,
            visible: item.visible !== false,
          })
          .returning({ id: navigationItems.id });
        if (item.children?.length) await insert(item.children, row!.id);
      }
    };
    await insert(parsed.data, null);
  });
  await recordAudit(actor, "navigation.replace", "navigation", location);
}
