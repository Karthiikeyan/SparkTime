import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// Next evaluates header `source` patterns with its own bundled path-to-regexp.
const require = createRequire(import.meta.url);
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as { pathToRegexp: (source: string) => RegExp };

async function headersFor(path: string): Promise<Map<string, string>> {
  const rules = await nextConfig.headers!();
  const out = new Map<string, string>();
  for (const rule of rules) {
    if (!pathToRegexp(rule.source).test(path)) continue;
    for (const header of rule.headers) out.set(header.key, header.value);
  }
  return out;
}

describe("public Content-Security-Policy coverage", () => {
  // The studio is excluded because proxy.ts sends it a stricter, nonce-based policy.
  const STUDIO = ["/admin", "/admin/documents/1", "/api/admin/search"];
  // Public paths whose first segment merely STARTS with "admin" (a category, page or type) must keep the policy.
  const PUBLIC = ["/", "/about", "/article/x", "/api/search", "/administration", "/admin-notes", "/adminfoo/bar", "/api/administrator"];

  it.each(PUBLIC)("applies the public CSP to %s", async (path) => {
    expect((await headersFor(path)).get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it.each(STUDIO)("leaves %s to the studio's own policy", async (path) => {
    expect((await headersFor(path)).has("Content-Security-Policy")).toBe(false);
  });

  it("sends the baseline hardening headers everywhere, studio included", async () => {
    for (const path of [...PUBLIC, ...STUDIO]) {
      const headers = await headersFor(path);
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("X-Frame-Options")).toBe("DENY");
    }
  });
});
