import { afterEach, describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { applyTitleTemplate } from "@/lib/settings";
import { buildEmbedSrc, parseEmbedUrl, parseYouTubeId, parseYouTubeStart } from "@/lib/embeds";
import { documentSchema, personSchema, serializeJsonLd, toIsoDuration } from "@/lib/seo/json-ld";
import { documentRobots, taxonomyRobots } from "@/lib/seo/robots";
import { isAllowedAdmin, isDevLoginEnabled } from "@/server/auth/allowlist";
import { resetEnvCache } from "@/server/env";
import { escapeXml, renderRss } from "@/server/seo/discovery";
import { issueContactToken, verifyContactToken } from "@/server/services/contact";
import { toPrefixTsQuery } from "@/server/services/search";

describe("JSON-LD", () => {
  it("cannot be broken out of with </script>", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>", x: "a & b" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>", x: "a & b" });
  });

  it("builds a Person entity without inventing absent facts", () => {
    const person = personSchema({ siteUrl: "https://k.example", name: "Karthikeyan A", alternateNames: [], description: "", jobTitle: "", worksFor: "", knowsAbout: [], imageUrl: null, sameAs: [] });
    expect(person).toEqual({ "@type": "Person", "@id": "https://k.example/#person", name: "Karthikeyan A", url: "https://k.example/about" });
  });

  it("maps schema types and degrades gracefully when facts are missing", () => {
    const base = { siteUrl: "https://k.example", url: "https://k.example/video/x", authorName: "Karthikeyan A", title: "T", description: "D", publishedAt: "2026-01-01T00:00:00.000Z", modifiedAt: null, imageUrl: null, section: null, keywords: [], wordCount: 0 };
    expect(documentSchema({ ...base, schemaType: "VideoObject", facts: { videoId: "dQw4w9WgXcQ", duration: "12:40" } })).toMatchObject({ "@type": "VideoObject", duration: "PT12M40S" });
    expect(documentSchema({ ...base, schemaType: "VideoObject", facts: {} })["@type"]).toBe("CreativeWork");
    expect(documentSchema({ ...base, schemaType: "Event", facts: {} })["@type"]).toBe("CreativeWork");
    expect(documentSchema({ ...base, schemaType: "Review", facts: { itemName: "Atomic Habits", itemAuthor: "James Clear", rating: 4 } })).toMatchObject({
      "@type": "Review",
      itemReviewed: { "@type": "Book", name: "Atomic Habits" },
      reviewRating: { ratingValue: 4 },
    });
    expect(toIsoDuration("1:02:03")).toBe("PT1H2M3S");
  });

  it("names the author on the page itself, since an @id on another page isn't followed", () => {
    const base = { siteUrl: "https://k.example", url: "https://k.example/article/x", authorName: "Karthikeyan A", title: "T", description: "D", publishedAt: "2026-01-01T00:00:00.000Z", modifiedAt: null, imageUrl: null, section: null, keywords: [], wordCount: 900 };
    const author = { "@type": "Person", "@id": "https://k.example/#person", name: "Karthikeyan A", url: "https://k.example/about" };
    expect(documentSchema({ ...base, schemaType: "BlogPosting", facts: {} })).toMatchObject({ author, publisher: author });
    expect(documentSchema({ ...base, schemaType: "Review", facts: { itemName: "Atomic Habits" } })).toMatchObject({ author });
    expect(documentSchema({ ...base, schemaType: "Event", facts: { eventDate: "2026-03-10" } })).toMatchObject({ performer: author });
  });
});

describe("robots.txt", () => {
  // Google's matching: a rule is a path prefix; "*" matches anything and a trailing "$" anchors the end.
  const blocks = (rule: string, path: string) => new RegExp(`^${rule.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}`).test(path);
  const blocked = (disallow: string[], path: string) => disallow.some((rule) => blocks(rule, path));

  it("keeps internal routes out without blocking public slugs that merely start the same way", () => {
    const { rules, sitemap } = robots();
    const disallow = [(Array.isArray(rules) ? rules[0]! : rules).disallow ?? []].flat();
    for (const path of ["/admin", "/admin/login", "/api/search", "/preview/abc", "/search", "/search?q=x"]) expect(blocked(disallow, path), path).toBe(true);
    for (const path of ["/", "/administration", "/search-engines", "/search-engines/page/2", "/article/searching-for-bugs", "/tag/search"]) expect(blocked(disallow, path), path).toBe(false);
    expect(sitemap).toBe("https://karthikeyan.example/sitemap.xml");
  });
});

describe("title template", () => {
  it("adds the name once, and never to a title that already carries it", () => {
    expect(applyTitleTemplate("%s — Karthikeyan A", "Now", "Karthikeyan A")).toBe("Now — Karthikeyan A");
    expect(applyTitleTemplate("%s — Karthikeyan A", "About Karthikeyan A", "Karthikeyan A")).toBe("About Karthikeyan A");
    expect(applyTitleTemplate("%s — Karthikeyan A", "Karthikeyan A — Software engineer", "Karthikeyan A")).toBe("Karthikeyan A — Software engineer");
    // Only the name as a whole phrase counts.
    expect(applyTitleTemplate("%s — Karthikeyan A", "Karthikeyan Always Ships", "Karthikeyan A")).toBe("Karthikeyan Always Ships — Karthikeyan A");
    expect(applyTitleTemplate("%s — Karthikeyan A", "", "Karthikeyan A")).toBe("Karthikeyan A");
  });
});

describe("robots decisions", () => {
  it.each([
    [{ status: "draft", visibility: "public", robotsIndex: "default", typeIndexable: true }, false],
    [{ status: "published", visibility: "private", robotsIndex: "index", typeIndexable: true }, false],
    [{ status: "published", visibility: "unlisted", robotsIndex: "default", typeIndexable: true }, false],
    [{ status: "published", visibility: "unlisted", robotsIndex: "index", typeIndexable: true }, true],
    [{ status: "published", visibility: "public", robotsIndex: "default", typeIndexable: true }, true],
    [{ status: "published", visibility: "public", robotsIndex: "noindex", typeIndexable: true }, false],
    [{ status: "published", visibility: "public", robotsIndex: "default", typeIndexable: false }, false],
    [{ status: "published", visibility: "public", robotsIndex: "default", typeIndexable: true, canonicalElsewhere: true }, false],
    [{ status: "archived", visibility: "public", robotsIndex: "index", typeIndexable: true }, false],
  ])("%j → index=%s", (input, expected) => {
    expect(documentRobots(input).index).toBe(expected);
  });

  it("avoids thin tag pages", () => {
    expect(taxonomyRobots("auto", 2, 3).index).toBe(false);
    expect(taxonomyRobots("auto", 3, 3).index).toBe(true);
    expect(taxonomyRobots("index", 0, 3).index).toBe(false);
    expect(taxonomyRobots("noindex", 50, 3).index).toBe(false);
  });
});

describe("embeds", () => {
  it("parses YouTube URLs strictly", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeId("javascript:alert(1)")).toBeNull();
    expect(parseYouTubeStart("https://youtu.be/x?t=1m30s")).toBe(90);
  });
  it("only builds iframe URLs for allowlisted providers", () => {
    const vimeo = parseEmbedUrl("https://vimeo.com/76979871");
    expect(vimeo).toEqual({ provider: "vimeo", id: "76979871" });
    expect(buildEmbedSrc(vimeo!)).toBe("https://player.vimeo.com/video/76979871?dnt=1");
    expect(parseEmbedUrl("https://evil.example/embed")).toBeNull();
    expect(parseEmbedUrl("http://vimeo.com/76979871")).toBeNull();
    expect(buildEmbedSrc({ provider: "codepen", id: "a/b/../../x" })).toBeNull();
  });
});

describe("search query building", () => {
  it.each([
    ["financial independence", "financial:* & independence:*"],
    ["foo & !bar | (baz)", "foo:* & bar:* & baz:*"],
    ["'; DROP TABLE studio.documents; --", "drop:* & table:* & studio:* & documents:*"],
    [":*:*", null],
    ["", null],
  ])("%j → %j", (input, expected) => {
    expect(toPrefixTsQuery(input)).toBe(expected);
  });
  it("caps the number of tokens", () => {
    expect(toPrefixTsQuery("a b c d e f g h i j k")!.split("&")).toHaveLength(8);
  });
});

describe("contact timing token", () => {
  it("accepts a real submission window and rejects tampering", () => {
    const now = Date.now();
    const token = issueContactToken(now - 10_000);
    expect(verifyContactToken(token, now)).toBe("ok");
    expect(verifyContactToken(issueContactToken(now - 500), now)).toBe("too-fast");
    expect(verifyContactToken(issueContactToken(now - 3 * 3600_000), now)).toBe("expired");
    const [issued, sig] = token.split(".");
    expect(verifyContactToken(`${Number(issued) - 1000}.${sig}`, now)).toBe("invalid");
    expect(verifyContactToken("garbage", now)).toBe("invalid");
    expect(verifyContactToken(undefined, now)).toBe("invalid");
  });
});

describe("admin allowlist", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    resetEnvCache();
  });

  it("denies everyone when nothing is configured", () => {
    delete process.env.ADMIN_GITHUB_ID;
    delete process.env.ADMIN_GITHUB_LOGIN;
    resetEnvCache();
    expect(isAllowedAdmin({ githubId: 1, login: "anyone" })).toBe(false);
  });

  it("prefers the immutable numeric id over the login", () => {
    process.env.ADMIN_GITHUB_ID = "4242";
    process.env.ADMIN_GITHUB_LOGIN = "karthik";
    resetEnvCache();
    expect(isAllowedAdmin({ githubId: 4242, login: "renamed" })).toBe(true);
    // Someone who claims the old username after a rename must not get in.
    expect(isAllowedAdmin({ githubId: 9999, login: "karthik" })).toBe(false);
  });

  it("falls back to a case-insensitive login match", () => {
    delete process.env.ADMIN_GITHUB_ID;
    process.env.ADMIN_GITHUB_LOGIN = "Karthik";
    resetEnvCache();
    expect(isAllowedAdmin({ githubId: 1, login: "karthik" })).toBe(true);
    expect(isAllowedAdmin({ githubId: 1, login: "karthik2" })).toBe(false);
  });

  it("never enables the dev login outside development", () => {
    process.env.AUTH_DEV_LOGIN = "true";
    resetEnvCache();
    expect(process.env.NODE_ENV).toBe("test");
    expect(isDevLoginEnabled()).toBe(false);
  });
});

describe("RSS", () => {
  it("escapes XML", () => {
    expect(escapeXml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
    const xml = renderRss({ title: "K & A", description: "d", siteUrl: "https://k.example", items: [{ title: "<b>x</b>", url: "https://k.example/article/x", description: "]]>", publishedAt: new Date("2026-01-01"), categories: ["Article"], typeName: "Article" }] });
    expect(xml).toContain("<title>K &amp; A</title>");
    expect(xml).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(xml).not.toContain("<b>");
  });
});
