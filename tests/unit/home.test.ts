import { describe, expect, it } from "vitest";
import { firstSentence, hoursLabel, roleLine, shortTitle } from "@/lib/home";
import { applyTitleTemplate } from "@/lib/settings";
import { isNotesTopic, siteConfig } from "@/lib/site-config";

describe("home page text helpers", () => {
  it("shortens a course title to the part before its colon", () => {
    expect(shortTitle("Java From Zero to Job-Ready: A Practical Path from First Program to a Tested Spring Boot Backend")).toBe("Java From Zero to Job-Ready");
    expect(shortTitle("System Design From Zero to Interview-Ready")).toBe("System Design From Zero to Interview-Ready");
  });

  it("takes the first sentence of an excerpt", () => {
    expect(firstSentence("A free 41-article course that takes you to a backend. Modern Java 21 and later.")).toBe("A free 41-article course that takes you to a backend.");
    expect(firstSentence("Java 21. Then Spring.")).toBe("Java 21.");
    expect(firstSentence("No full stop at all")).toBe("No full stop at all");
  });

  it("formats reading time the way course pages do", () => {
    expect(hoursLabel(45)).toBe("45 min");
    expect(hoursLabel(420)).toBe("7 h");
  });

  it("leads a company's role line with named roles and says when there are more", () => {
    expect(roleLine(["SDE 1", "SDE 2"])).toEqual({ shown: ["SDE 1", "SDE 2"], more: false });
    expect(roleLine(["Member Technical Staff", "Software Developer", "Software Engineer (Level Unspecified)"])).toEqual({ shown: ["Member Technical Staff", "Software Developer"], more: true });
    expect(roleLine(["Associate Software Engineer", "Software Engineer (Level Unspecified)"])).toEqual({ shown: ["Associate Software Engineer"], more: true });
  });
});

describe("site identity", () => {
  it("titles pages with the product name and leaves a title that already names it", () => {
    const template = `%s · ${siteConfig.name}`;
    const homeTitle = `${siteConfig.name} — Free guides, courses and interview experiences for engineers in India`;
    expect(applyTitleTemplate(template, "Topics", siteConfig.name)).toBe("Topics · SparkTime");
    expect(applyTitleTemplate(template, homeTitle, siteConfig.name)).toBe(homeTitle);
  });

  it("lists every non-featured top-level topic with pieces on /notes", () => {
    expect(isNotesTopic({ slug: "travel", parentId: null, count: 3 })).toBe(true);
    expect(isNotesTopic({ slug: "money", parentId: null, count: 23 })).toBe(false);
    expect(isNotesTopic({ slug: "youtube", parentId: "x", count: 2 })).toBe(false);
    expect(isNotesTopic({ slug: "life", parentId: null, count: 0 })).toBe(false);
  });
});
