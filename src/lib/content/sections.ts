/**
 * Public site sections. Visitors navigate by intent — something to read,
 * what's been built, speaking — not by content type. A section gathers the
 * content types that answer one intent; the types keep their own templates,
 * fields, URLs and index pages, which become filtered views of the section.
 *
 * Which types a section holds is CMS data (Settings → Site sections). When a
 * section has none chosen it falls back to a rule based on template and field
 * roles — never on names — so a type the owner creates later ("Newsletter",
 * "Case study", "Interview") joins the right section without a code change.
 * Pure: shared by the public site, the studio's live preview and the tests.
 */

export const HUB_KEYS = ["writing", "work", "speaking"] as const;
export type HubKey = (typeof HUB_KEYS)[number];

/**
 * Fixed, reserved paths (see RESERVED_ROOT_SLUGS). "/blog", not "/writing":
 * a topic already lives at /writing, and a section must never shadow a URL
 * that is already out in the world.
 */
export const HUB_PATHS: Record<HubKey, string> = { writing: "/blog", work: "/work", speaking: "/speaking" };

/** Where a visitor lands for each section now: Writing is the Library, Speaking is part of About (the old paths redirect there). */
export const PUBLIC_HUB_PATHS: Record<HubKey, string> = { writing: "/library", work: "/work", speaking: "/about#speaking" };

export type SectionableType = {
  id: string;
  template: string;
  routing: string;
  archivedAt?: Date | string | null;
  fields: Array<{ role: string | null }>;
};

const hasRole = (t: SectionableType, ...roles: string[]) => t.fields.some((f) => f.role !== null && roles.includes(f.role));

/** The automatic rule for a section with no types chosen. Order matters: a type joins the first section that claims it. */
export const HUB_DEFAULT_RULES: Record<HubKey, (t: SectionableType) => boolean> = {
  // Everything read as text: essays, guides, notes, reviews.
  writing: (t) => t.template === "editorial" || t.template === "minimal",
  // Things built, and things tried with a status (Project: Building, Experiment: Running).
  work: (t) => t.template === "project" || (t.template === "story" && hasRole(t, "projectStatus")),
  // Talks and videos: anything with an event or a player.
  speaking: (t) => t.template === "media" || hasRole(t, "eventName", "eventDate"),
};

/**
 * Content type ids per section. Explicit choices win, and a type chosen for
 * one section is never also claimed automatically by another. `exclude`
 * holds types that belong elsewhere (the journey belongs to About).
 */
export function resolveHubTypeIds(
  types: SectionableType[],
  chosen: Record<HubKey, string[]>,
  exclude: Iterable<string> = [],
): Record<HubKey, string[]> {
  const skip = new Set(exclude);
  const pool = types.filter((t) => t.routing === "type" && !t.archivedAt && !skip.has(t.id));
  const claimed = new Set(HUB_KEYS.flatMap((k) => chosen[k].filter((id) => pool.some((t) => t.id === id))));
  const out = {} as Record<HubKey, string[]>;
  for (const key of HUB_KEYS) {
    if (chosen[key].length) {
      out[key] = pool.filter((t) => chosen[key].includes(t.id)).map((t) => t.id);
      continue;
    }
    out[key] = pool.filter((t) => !claimed.has(t.id) && HUB_DEFAULT_RULES[key](t)).map((t) => t.id);
    for (const id of out[key]) claimed.add(id);
  }
  return out;
}

/** "/blog?x#y" → "/blog" — for comparing links with section paths. */
export function barePath(href: string): string {
  return href.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
}

export function hubForPath(href: string): HubKey | null {
  const path = barePath(href);
  return HUB_KEYS.find((k) => HUB_PATHS[k] === path) ?? null;
}

/** Status choices that mean "being worked on now" (Project: Building, Experiment: Running). */
const IN_PROGRESS = new Set(["building", "running", "in-progress", "active", "ongoing"]);

type StatusField = { key: string; role: string | null; options: { choices?: Array<{ value: string }> } };

/** listPublished's `propertyIn` for "in progress": each type's status field and the choices that mean it. */
export function inProgressFilter(types: Array<{ id: string; fields: StatusField[] }>): Array<{ typeId: string; key: string; values: string[] }> {
  return types.flatMap((t) => {
    const field = t.fields.find((f) => f.role === "projectStatus");
    const values = (field?.options.choices ?? []).map((c) => c.value).filter((v) => IN_PROGRESS.has(v));
    return field && values.length ? [{ typeId: t.id, key: field.key, values }] : [];
  });
}
