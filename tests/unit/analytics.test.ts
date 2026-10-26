import { describe, expect, it } from "vitest";
import { analyticsAllowed, analyticsDecision, classifyLink, gaMeasurementId, newThresholds, readingPercent, track, vercelAnalyticsEvent, type AnalyticsContext } from "@/lib/analytics";

describe("when analytics runs", () => {
  const live: AnalyticsContext = {
    gaId: "G-ABC123XYZ",
    nodeEnv: "production",
    siteUrl: "https://karthikeyan.example",
    origin: "https://karthikeyan.example",
    pathname: "/article/x",
    globalPrivacyControl: false,
  };

  it("only in production, on the canonical https origin, with a measurement id", () => {
    expect(analyticsDecision(live)).toBe(true);
    expect(analyticsDecision({ ...live, gaId: null })).toBe(false);
    expect(analyticsDecision({ ...live, nodeEnv: "development" })).toBe(false);
    expect(analyticsDecision({ ...live, nodeEnv: "test" })).toBe(false);
    // Localhost, Vercel preview deployments and a non-https site URL never report.
    expect(analyticsDecision({ ...live, origin: "http://localhost:3000" })).toBe(false);
    expect(analyticsDecision({ ...live, origin: "https://portfolio-git-branch.vercel.app" })).toBe(false);
    expect(analyticsDecision({ ...live, siteUrl: "http://localhost:3000", origin: "http://localhost:3000" })).toBe(false);
    expect(analyticsDecision({ ...live, siteUrl: undefined })).toBe(false);
  });

  it("never on admin previews, and not when the browser sends Global Privacy Control", () => {
    expect(analyticsDecision({ ...live, pathname: "/preview/3f0c" })).toBe(false);
    expect(analyticsDecision({ ...live, pathname: "/admin" })).toBe(false);
    expect(analyticsDecision({ ...live, pathname: "/previewing-the-future" })).toBe(true);
    expect(analyticsDecision({ ...live, globalPrivacyControl: true })).toBe(false);
  });

  it("accepts only GA4 measurement ids", () => {
    expect(gaMeasurementId(" g-abc123xyz ")).toBe("G-ABC123XYZ");
    for (const bad of [undefined, "", "   ", "UA-12345-1", "GTM-ABC123", "G-<script>", "G-abc');alert(1)//"]) expect(gaMeasurementId(bad)).toBeNull();
  });

  it("is off, silently, outside a browser (server rendering, tests)", () => {
    expect(analyticsAllowed()).toBe(false);
    expect(() => track({ name: "contact_submit", params: {} })).not.toThrow();
  });
});

describe("Vercel Web Analytics filter", () => {
  const view = (path: string) => ({ type: "pageview" as const, url: `https://karthikeyan.example${path}?token=1` });

  it("keeps public page views", () => {
    expect(vercelAnalyticsEvent(view("/article/x"), false)).toEqual(view("/article/x"));
    expect(vercelAnalyticsEvent(view("/previewing-the-future"), false)).not.toBeNull();
  });

  it("drops admin previews, the studio, malformed urls and Global Privacy Control", () => {
    expect(vercelAnalyticsEvent(view("/preview/3f0c"), false)).toBeNull();
    expect(vercelAnalyticsEvent(view("/admin/content"), false)).toBeNull();
    expect(vercelAnalyticsEvent({ type: "pageview", url: "not a url" }, false)).toBeNull();
    expect(vercelAnalyticsEvent(view("/article/x"), true)).toBeNull();
  });
});

describe("link clicks", () => {
  const click = (href: string, extra: Partial<Parameters<typeof classifyLink>[0]> = {}) =>
    classifyLink({ href, pageUrl: "https://karthikeyan.example/article/x", rel: "", context: null, sparktribeHost: "sparktribe.example.org", ...extra });

  it("records the destination's origin and path only — no query string or fragment", () => {
    expect(click("https://sre.google/sre-book/?utm_source=x&token=secret#part")).toEqual({
      name: "outbound_click",
      params: { link_domain: "sre.google", link_url: "https://sre.google/sre-book/" },
    });
  });

  it("names the meaningful ones", () => {
    expect(click("https://www.linkedin.com/in/someone", { rel: "me noopener noreferrer" })).toMatchObject({ name: "social_profile_click", params: { link_domain: "linkedin.com" } });
    expect(click("https://sparktribe.example.org/courses?ref=site")).toEqual({ name: "sparktribe_click", params: { link_url: "https://sparktribe.example.org/courses" } });
    expect(click("https://www.sparktribe.example.org/")).toMatchObject({ name: "sparktribe_click" });
    expect(click("https://github.com/example/studio", { context: "project" })).toMatchObject({ name: "project_link_click", params: { link_domain: "github.com" } });
    expect(click("https://leetcode.com/problems/two-sum/", { context: "practice" })).toEqual({ name: "practice_link_click", params: { link_domain: "leetcode.com", link_url: "https://leetcode.com/problems/two-sum/" } });
    // Without the project context the same link is an ordinary outbound click.
    expect(click("https://github.com/example/studio")).toMatchObject({ name: "outbound_click" });
  });

  it("counts contact intent without the address", () => {
    const email = click("mailto:hello@example.org?subject=Hi");
    expect(email).toEqual({ name: "contact_click", params: { method: "email" } });
    expect(JSON.stringify(email)).not.toContain("hello@");
    expect(click("tel:+911234567890")).toEqual({ name: "contact_click", params: { method: "phone" } });
    expect(click("/contact")).toEqual({ name: "contact_click", params: { method: "contact_page" } });
    expect(click("/contact", { pageUrl: "https://karthikeyan.example/contact" })).toBeNull();
  });

  it("leaves internal navigation and non-web links to page views", () => {
    for (const href of ["/about", "/article/y#section", "https://karthikeyan.example/explore", "#top", "javascript:void(0)", "ftp://files.example/x"]) expect(click(href), href).toBeNull();
  });
});

describe("reading progress", () => {
  it("is the share of the text scrolled past the bottom of the screen", () => {
    expect(readingPercent(800, 4000, 800)).toBe(0);
    expect(readingPercent(-200, 4000, 800)).toBe(25);
    expect(readingPercent(-3800, 4000, 800)).toBe(100);
    expect(readingPercent(-9000, 4000, 800)).toBe(100);
    expect(readingPercent(0, 0, 800)).toBe(0);
  });

  it("fires each threshold once, even when a jump passes several", () => {
    const fired = new Set<number>();
    const reach = (percent: number) => newThresholds(percent, fired).map((t) => (fired.add(t), t));
    expect(reach(10)).toEqual([]);
    expect(reach(60)).toEqual([25, 50]);
    expect(reach(55)).toEqual([]);
    expect(reach(95)).toEqual([75, 90]);
    expect(reach(100)).toEqual([]);
  });
});
