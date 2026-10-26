import "server-only";
import { inProgressFilter } from "@/lib/content/sections";
import type { ContentType } from "./content-types";
import { getRootPage, listPublished, publicTypeCounts, typeListOrder, type Card, type PublicDocument } from "./public-content";
import { getSiteSections, type Hub } from "./sections";

export type TypeShelf = { type: ContentType; items: Card[]; total: number };

async function shelves(hub: Hub, perType: number, exclude: string[] = []): Promise<TypeShelf[]> {
  const counts = await publicTypeCounts();
  const withContent = hub.types.filter((t) => (counts.get(t.id) ?? 0) > 0);
  const lists = await Promise.all(
    withContent.map(async (type) => {
      const order = typeListOrder(type);
      const { items } = await listPublished({ typeIds: [type.id], limit: perType, excludeIds: exclude, ...(order ? { propertyOrder: order } : { order: "curated" as const }) });
      return { type, items, total: counts.get(type.id) ?? 0 };
    }),
  );
  return lists.filter((s) => s.items.length > 0);
}

export type WorkPageData = { hub: Hub; inProgress: Card[]; shelves: TypeShelf[]; sparktribe: PublicDocument | null };

/** Work: what's in progress first, then each kind of work (projects, experiments…) on its own shelf. */
export async function getWorkPage(): Promise<WorkPageData> {
  const hub = (await getSiteSections()).hub("work");
  const filter = inProgressFilter(hub.types);
  const [inProgress, sparktribe] = await Promise.all([
    filter.length ? listPublished({ propertyIn: filter, order: "curated", limit: 6 }).then((r) => r.items) : Promise.resolve([]),
    getRootPage("sparktribe"),
  ]);
  return { hub, inProgress, shelves: await shelves(hub, 6, inProgress.map((c) => c.id)), sparktribe };
}

export type SpeakingPageData = { hub: Hub; shelves: TypeShelf[] };

/** Speaking: past sessions first (what an organiser looks for), newest event first; then videos. */
export async function getSpeakingPage(): Promise<SpeakingPageData> {
  const hub = (await getSiteSections()).hub("speaking");
  const isEvent = (s: TypeShelf) => s.type.fields.some((f) => f.role === "eventName" || f.role === "eventDate");
  const all = await shelves(hub, 12);
  return { hub, shelves: [...all.filter(isEvent), ...all.filter((s) => !isEvent(s))] };
}
