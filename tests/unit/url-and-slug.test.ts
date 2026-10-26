import { describe, expect, it } from "vitest";
import { parsePageNumber } from "@/lib/content/paths";
import { isReservedRootSlug, isValidSlug, slugify } from "@/lib/slug";
import { isSafeInternalPath, normalizePath, safeExternalUrl, safeHref } from "@/lib/url";

const TAB = String.fromCharCode(9);
const NUL = String.fromCharCode(0);
const ZWSP = String.fromCharCode(0x200b);

describe("safeHref", () => {
  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    `java${TAB}script:alert(1)`,
    `java${NUL}script:alert(1)`,
    `${ZWSP}javascript:alert(1)`,
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example/path",
    "/\\evil.example",
    "https://user:pass@evil.example",
    "https://trusted.example@evil.example",
    "ftp://example.com",
    "",
    "   ",
  ])("rejects %j", (input) => {
    expect(safeHref(input)).toBeNull();
  });

  it("accepts ordinary links", () => {
    expect(safeHref("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
    expect(safeHref("/article/hello")).toBe("/article/hello");
    expect(safeHref("#section-2")).toBe("#section-2");
    expect(safeHref("mailto:hello@example.com")).toBe("mailto:hello@example.com");
  });

  it("honours options", () => {
    expect(safeHref("/about", { allowRelative: false })).toBeNull();
    expect(safeHref("#x", { allowHash: false })).toBeNull();
    expect(safeHref("mailto:a@b.co", { allowMailto: false })).toBeNull();
    expect(safeExternalUrl("/about")).toBeNull();
    expect(safeExternalUrl("https://example.com")).toBe("https://example.com/");
  });

  it("rejects non-strings and overly long values", () => {
    expect(safeHref(42)).toBeNull();
    expect(safeHref({ href: "https://x" })).toBeNull();
    expect(safeHref("https://example.com/" + "a".repeat(3000))).toBeNull();
  });
});

describe("isSafeInternalPath", () => {
  it("blocks open-redirect shapes", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "/%2f%2fevil.com", `/a${NUL}b`]) {
      expect(isSafeInternalPath(bad)).toBe(false);
    }
  });
  it("allows site paths", () => {
    expect(isSafeInternalPath("/article/x")).toBe(true);
    expect(isSafeInternalPath("/tag/fire?page=2")).toBe(true);
  });
  it("normalises paths for redirect keys", () => {
    expect(normalizePath("/a/b/?x=1#y")).toBe("/a/b");
    expect(normalizePath("//a///b")).toBe("/a/b");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("parsePageNumber", () => {
  it("accepts 2–9999 written plainly", () => {
    expect(parsePageNumber("2")).toBe(2);
    expect(parsePageNumber("10")).toBe(10);
    expect(parsePageNumber("9999")).toBe(9999);
  });
  it.each([undefined, "", "1", "0", "01", "02", "10000", "2.0", "1e3", "-2", " 2", "two", "2/"])("gives one URL per page: rejects %j", (v) => {
    expect(parsePageNumber(v)).toBeNull();
  });
});

describe("slugs", () => {
  it("slugifies titles", () => {
    expect(slugify("How I Built My First Product!")).toBe("how-i-built-my-first-product");
    expect(slugify("Café & Crème")).toBe("cafe-and-creme");
    expect(slugify("   ")).toBe("untitled");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
  });
  it.each(["../x", "a/b", "A", "a--b-", "-a", "a b", "%2e%2e", "a.b", "é", "a".repeat(97)])("rejects malicious or malformed slug %j", (s) => {
    expect(isValidSlug(s)).toBe(false);
  });
  it("accepts valid slugs", () => {
    expect(isValidSlug("financial-independence")).toBe(true);
    expect(isValidSlug("2026")).toBe(true);
  });
  it("reserves system routes", () => {
    for (const s of ["admin", "api", "search", "tag", "about", "now"]) expect(isReservedRootSlug(s)).toBe(true);
    expect(isReservedRootSlug("money")).toBe(false);
  });
});
