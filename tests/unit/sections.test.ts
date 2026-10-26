import { describe, expect, it } from "vitest";
import { barePath, HUB_PATHS, hubForPath, inProgressFilter, resolveHubTypeIds, type SectionableType } from "@/lib/content/sections";
import { isReservedRootSlug } from "@/lib/slug";

/**
 * Which content types each public section gathers. The rule is data-driven —
 * template and field roles, never names — so types the owner creates later
 * land in the right section, and explicit choices in Settings always win.
 */

const type = (id: string, template: string, roles: string[] = [], extra: Partial<SectionableType> = {}): SectionableType => ({
  id,
  template,
  routing: "type",
  archivedAt: null,
  fields: roles.map((role) => ({ role })),
  ...extra,
});

const seeded = [
  type("article", "editorial"),
  type("guide", "editorial"),
  type("note", "minimal"),
  type("review", "editorial", ["itemName", "rating"]),
  type("project", "project", ["projectStatus"]),
  type("experiment", "story", ["projectStatus"]),
  type("journey", "story", ["period"]),
  type("video", "media", ["videoUrl"]),
  type("talk", "media", ["eventName", "eventDate"]),
  type("course", "collection"),
  type("collection", "collection"),
  type("resource", "resource", ["primaryUrl"]),
  type("page", "minimal", [], { routing: "root" }),
];
const none = { writing: [], work: [], speaking: [] };

describe("site sections", () => {
  it("gathers the seeded types by template and role", () => {
    expect(resolveHubTypeIds(seeded, none, ["journey"])).toEqual({
      writing: ["article", "guide", "note", "review"],
      work: ["project", "experiment"],
      speaking: ["video", "talk"],
    });
  });

  it("leaves standalone pages, the journey, curation and resources to About and Explore", () => {
    const all = Object.values(resolveHubTypeIds(seeded, none, ["journey"])).flat();
    for (const id of ["page", "journey", "course", "collection", "resource"]) expect(all).not.toContain(id);
  });

  it("places types invented later without a code change", () => {
    const later = [...seeded, type("newsletter", "editorial"), type("case-study", "project"), type("interview", "media"), type("meetup", "resource", ["eventDate"])];
    const ids = resolveHubTypeIds(later, none);
    expect(ids.writing).toContain("newsletter");
    expect(ids.work).toContain("case-study");
    expect(ids.speaking).toEqual(expect.arrayContaining(["interview", "meetup"]));
  });

  it("lets an explicit choice win, and never places one type in two sections", () => {
    // The owner files book reviews under Work; Writing's automatic rule must not also claim them.
    const ids = resolveHubTypeIds(seeded, { writing: [], work: ["project", "review"], speaking: [] });
    // In studio order, whatever order they were picked in.
    expect(ids.work).toEqual(["review", "project"]);
    expect(ids.writing).not.toContain("review");
    // Work's choice was explicit, so experiments are no longer in it automatically.
    expect(ids.work).not.toContain("experiment");
  });

  it("ignores archived types and ids that are not types", () => {
    const withArchived = [...seeded, type("old", "editorial", [], { archivedAt: "2026-01-01" })];
    expect(resolveHubTypeIds(withArchived, none).writing).not.toContain("old");
    expect(resolveHubTypeIds(seeded, { writing: ["not-a-type"], work: [], speaking: [] }).writing).toEqual([]);
  });

  it("recognises section paths however they are written", () => {
    expect(hubForPath("/blog")).toBe("writing");
    expect(hubForPath("/blog/?ref=nav#top")).toBe("writing");
    expect(hubForPath("/work")).toBe("work");
    expect(hubForPath("/blogs")).toBeNull();
    expect(barePath("/speaking?x=1")).toBe("/speaking");
  });

  it("reserves every section path so no topic, type or page can claim it", () => {
    for (const path of Object.values(HUB_PATHS)) expect(isReservedRootSlug(path.slice(1))).toBe(true);
  });

  it("finds 'in progress' through each type's status field", () => {
    const project = { id: "p", fields: [{ key: "status", role: "projectStatus", options: { choices: [{ value: "idea" }, { value: "building" }, { value: "live" }] } }] };
    const experiment = { id: "e", fields: [{ key: "state", role: "projectStatus", options: { choices: [{ value: "running" }, { value: "concluded" }] } }] };
    const plain = { id: "a", fields: [{ key: "x", role: null, options: {} }] };
    expect(inProgressFilter([project, experiment, plain])).toEqual([
      { typeId: "p", key: "status", values: ["building"] },
      { typeId: "e", key: "state", values: ["running"] },
    ]);
  });
});
