import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, homeSchema, siteSchema } from "@/lib/settings";
import { isNotesTopic, siteConfig } from "@/lib/site-config";

describe("site settings", () => {
  it("is named SparkTime and reads the defaults when nothing was saved", () => {
    expect(siteConfig.name).toBe("SparkTime");
    expect(DEFAULT_SETTINGS.site.name).toBe("SparkTime");
    expect(DEFAULT_SETTINGS.site.social.map((s) => s.label)).toEqual(["YouTube", "LinkedIn", "GitHub"]);
    expect(siteSchema.parse({})).toEqual(DEFAULT_SETTINGS.site);
  });

  it("keeps what was saved and restores the default for a name or line cleared on purpose", () => {
    const saved = siteSchema.parse({ name: "  Spark Studio ", tagline: "", homeTitle: "Learn here" });
    expect(saved.name).toBe("Spark Studio");
    expect(saved.tagline).toBe(siteConfig.tagline);
    expect(saved.homeTitle).toBe("Learn here");
    expect(siteSchema.parse({ name: "   " }).name).toBe("SparkTime");
  });

  it("rejects a social link that is not an https URL", () => {
    const bad = siteSchema.safeParse({ social: [{ id: "x", platform: "website", label: "Me", url: "javascript:alert(1)" }] });
    expect(bad.success).toBe(false);
  });
});

describe("home page settings", () => {
  it("reads the previous section-list layout as the default home page", () => {
    const legacy = homeSchema.parse({ sections: [{ id: "hero", kind: "hero", enabled: true, title: "", headline: "Old headline" }] });
    expect(legacy).toEqual(DEFAULT_SETTINGS.home);
    expect(legacy.hero.headline).toBe("Get hired. Then keep growing as an engineer.");
  });

  it("defaults to the approved design's wording and the three main topics", () => {
    const { home } = DEFAULT_SETTINGS;
    expect(home.hero.eyebrow).toBe("Free · Practical · Written for engineers in India");
    expect(home.hero.popular.map((p) => p.label)).toEqual(["Amazon SDE 1", "Zoho interview", "Spring Boot", "System design", "Fresher CTC"]);
    expect(home.topics.slugs).toEqual(["technology", "career", "money"]);
    expect(home.interviews.count).toBe(3);
    expect(home.latest.count).toBe(4);
    expect(home.interviews.shareCard.href).toBe("/contact?reason=Interview");
  });

  it("keeps edits, lets optional text be cleared, and never leaves a heading blank", () => {
    const home = homeSchema.parse({
      hero: { headline: "Learn well", eyebrow: "", popular: [{ label: "Go", href: "/library", query: "" }, { label: "", href: "", query: "x" }] },
      courses: { enabled: false, title: " " },
      latest: { count: 99 },
    });
    expect(home.hero.headline).toBe("Learn well");
    expect(home.hero.eyebrow).toBe("");
    // A shortcut with no label is dropped; one with no search text searches for its label.
    expect(home.hero.popular).toEqual([{ label: "Go", href: "/library", query: "Go" }]);
    expect(home.courses.enabled).toBe(false);
    expect(home.courses.title).toBe("Start with your goal");
    expect(home.latest.count).toBe(DEFAULT_SETTINGS.home.latest.count);
  });

  it("reports a link that is not a site path or http(s) URL instead of replacing it", () => {
    expect(homeSchema.safeParse({ tribe: { href: "javascript:alert(1)" } }).success).toBe(false);
    expect(homeSchema.safeParse({ hero: { popular: [{ label: "x", href: "ftp://x", query: "x" }] } }).success).toBe(false);
    expect(homeSchema.safeParse({ tribe: { href: "https://example.com/tribe" } }).success).toBe(true);
  });

  it("limits the main topics to six valid slugs", () => {
    expect(homeSchema.safeParse({ topics: { slugs: ["a", "b", "c", "d", "e", "f", "g"] } }).success).toBe(false);
    expect(homeSchema.safeParse({ topics: { slugs: ["Not A Slug"] } }).success).toBe(false);
    expect(homeSchema.parse({ topics: { slugs: ["technology"] } }).topics.slugs).toEqual(["technology"]);
  });
});

describe("notes follow the featured topics", () => {
  const travel = { slug: "travel", parentId: null, count: 3 };
  it("treats a topic as a note unless the home page features it", () => {
    expect(isNotesTopic(travel)).toBe(true);
    expect(isNotesTopic(travel, ["technology", "travel"])).toBe(false);
    expect(isNotesTopic({ slug: "money", parentId: null, count: 4 }, ["technology"])).toBe(true);
  });
});
