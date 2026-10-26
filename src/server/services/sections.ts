import "server-only";
import { cache } from "react";
import { typeIndexPath } from "@/lib/content/paths";
import { barePath, HUB_KEYS, HUB_PATHS, hubForPath, PUBLIC_HUB_PATHS, resolveHubTypeIds, type HubKey } from "@/lib/content/sections";
import { isNotesTopic } from "@/lib/site-config";
import { isSafeInternalPath } from "@/lib/url";
import { listContentTypes, type ContentType } from "./content-types";
import { getDocumentByTypeAndSlug, getRootPage, publicTypeCounts, visibleCategories } from "./public-content";
import { resolveSegment } from "./segment";
import { loadAllSettings } from "./settings";

export type Hub = {
  key: HubKey;
  path: string;
  title: string;
  intro: string;
  /** Every type in the section, in studio order — including ones with nothing published yet. */
  types: ContentType[];
  /** Published, listed pieces across the section. */
  count: number;
  /** Worth a menu link: something published, or (Speaking) an invitation that stands on its own. */
  live: boolean;
  topics: string[];
  cta: { label: string; href: string } | null;
  /** "All · Articles · Guides" — the section's formats that have something published. */
  tabs: SectionTab[];
};

/** A link in a section's tab row ("All · Articles · Guides"). */
export type SectionTab = { label: string; href: string; count?: number };

/** Where a content type lives in the public IA: the section it belongs to, and its siblings. */
export type TypeSection = { label: string; href: string; tabs: SectionTab[] };

export type SiteSections = {
  hubs: Hub[];
  hub: (key: HubKey) => Hub;
  hubOfType: (typeId: string) => Hub | null;
  sectionOfType: (typeId: string) => TypeSection;
  /** About · Journey · Now · Uses — whichever are published. */
  aboutTabs: SectionTab[];
  journeyType: ContentType | null;
  /** Listed types that belong to no section (resources, courses, collections…): Explore holds them. */
  libraryTypes: ContentType[];
};

export const getSiteSections = cache(async (): Promise<SiteSections> => {
  const [types, counts, settings, about, now, uses] = await Promise.all([
    listContentTypes(),
    publicTypeCounts(),
    loadAllSettings(),
    getRootPage("about"),
    getRootPage("now"),
    getRootPage("uses"),
  ]);
  const { hubs: config, pages } = settings;
  const journeyType = types.find((t) => t.id === pages.journeyTypeId && t.routing === "type" && !t.archivedAt) ?? null;
  const ids = resolveHubTypeIds(types, { writing: config.writing.typeIds, work: config.work.typeIds, speaking: config.speaking.typeIds }, journeyType ? [journeyType.id] : []);
  const countOf = (t: ContentType) => counts.get(t.id) ?? 0;
  const typeTab = (t: ContentType): SectionTab => ({ label: t.pluralName, href: typeIndexPath(t), count: countOf(t) });

  const hubs: Hub[] = HUB_KEYS.map((key) => {
    const hubTypes = types.filter((t) => ids[key].includes(t.id));
    const count = hubTypes.reduce((sum, t) => sum + countOf(t), 0);
    const cta = key === "speaking" ? config.speaking.cta ?? null : null;
    return {
      key,
      path: HUB_PATHS[key],
      title: config[key].title || key[0]!.toUpperCase() + key.slice(1),
      intro: config[key].intro,
      types: hubTypes,
      count,
      live: count > 0 || Boolean(cta),
      topics: key === "speaking" ? config.speaking.topics : [],
      cta,
      tabs: [{ label: "All", href: PUBLIC_HUB_PATHS[key], count }, ...hubTypes.filter((t) => countOf(t) > 0).map(typeTab)],
    };
  });
  const byType = new Map(hubs.flatMap((h) => h.types.map((t) => [t.id, h] as const)));
  const libraryTypes = types.filter((t) => t.routing === "type" && !t.archivedAt && !byType.has(t.id) && t.id !== journeyType?.id);

  const aboutTabs: SectionTab[] = [
    ...(about ? [{ label: "About", href: "/about" }] : []),
    ...(journeyType && countOf(journeyType) > 0 ? [{ label: journeyType.pluralName, href: typeIndexPath(journeyType) }] : []),
    ...(now ? [{ label: "Now", href: "/now" }] : []),
    ...(uses ? [{ label: "Uses", href: "/uses" }] : []),
  ];

  return {
    hubs,
    hub: (key) => hubs.find((h) => h.key === key)!,
    hubOfType: (typeId) => byType.get(typeId) ?? null,
    sectionOfType: (typeId) => {
      const hub = byType.get(typeId);
      if (hub) return { label: hub.key === "writing" ? "Library" : hub.title, href: PUBLIC_HUB_PATHS[hub.key], tabs: hub.tabs };
      if (typeId === journeyType?.id) return { label: "About", href: "/about", tabs: aboutTabs };
      return { label: "Library", href: "/library", tabs: [{ label: "All pieces", href: "/library" }, ...libraryTypes.filter((t) => countOf(t) > 0).map(typeTab)] };
    },
    aboutTabs,
    journeyType,
    libraryTypes,
  };
});

/**
 * Whether an internal link leads somewhere worth going yet: a section with
 * something in it, a published page, a type or topic with published pieces,
 * a feature that's switched on. Menus, home-page buttons and Start here use
 * it so a new site never offers a link to "Nothing published here yet" — or
 * to a 404. Deep paths it can't judge cheaply are given the benefit of the doubt.
 */
export async function isLivePath(href: string): Promise<boolean> {
  if (!isSafeInternalPath(href)) return false;
  const path = barePath(href);
  if (path === "/" || path === "/library" || path === "/explore" || path === "/contact") return true;
  if (path === "/topics") return (await visibleCategories()).some((c) => c.count > 0);
  if (path === "/notes") {
    const [categories, { home }] = await Promise.all([visibleCategories(), loadAllSettings()]);
    return categories.some((c) => isNotesTopic(c, home.topics.slugs));
  }
  const hub = hubForPath(path);
  if (hub) return (await getSiteSections()).hub(hub).live;
  const { features } = await loadAllSettings();
  if (path === "/graph") return false;
  if (path === "/search") return features.search;
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 1) {
    const target = await resolveSegment(parts[0]!);
    if (target.kind === "page") return true;
    if (target.kind === "type") return ((await publicTypeCounts()).get(target.type.id) ?? 0) > 0;
    if (target.kind === "category") return ((await visibleCategories()).find((c) => c.id === target.category.id)?.count ?? 0) > 0;
    return false;
  }
  if (parts.length === 2 && parts[0] !== "tag") return Boolean(await getDocumentByTypeAndSlug(parts[0]!, parts[1]!));
  return true;
}

/**
 * Extra path prefixes that mark a menu link as "you are here": Writing is
 * current on /article/…, About on /now, Library on search and formats,
 * Topics on every topic page.
 */
export async function sectionMatches(href: string): Promise<string[]> {
  const path = barePath(href);
  const sections = await getSiteSections();
  const hub = hubForPath(path);
  if (hub) return sections.hub(hub).types.map(typeIndexPath);
  if (path === "/about") return ["/now", "/uses", ...(sections.journeyType ? [typeIndexPath(sections.journeyType)] : [])];
  if (path === "/topics") return ["/tag", ...(await visibleCategories()).map((c) => `/${c.slug}`)];
  if (path === "/library" || path === "/explore") {
    return ["/library", "/search", "/blog", "/speaking", ...sections.libraryTypes.map(typeIndexPath), ...sections.hub("writing").types.map(typeIndexPath), ...sections.hub("speaking").types.map(typeIndexPath)];
  }
  return [];
}
