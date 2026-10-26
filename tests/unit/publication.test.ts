import { describe, expect, it } from "vitest";
import { defaultIndexingLabel, publicationFields, publicationOutcome, publishPreview } from "@/lib/content/publication";
import { parsePackage } from "@/lib/portability/parse";
import { planImport } from "@/lib/portability/plan";
import type { DestinationSnapshot, ImportDecisions } from "@/lib/portability/plan-types";
import { sniffType } from "@/server/media/validation";

const o = (status: string, visibility: string, robotsIndex = "default", typeIndexable = true) => publicationOutcome({ status, visibility, robotsIndex, typeIndexable });

describe("publication outcome (the words every Studio screen uses)", () => {
  it("names every combination by what readers and search engines get", () => {
    expect(o("draft", "public")).toMatchObject({ label: "Draft", live: false, listed: false, indexed: false });
    expect(o("idea", "private")).toMatchObject({ label: "Idea", live: false });
    expect(o("published", "public")).toMatchObject({ label: "Published", live: true, listed: true, indexed: true });
    expect(o("published", "public", "noindex")).toMatchObject({ label: "Published", indexed: false });
    expect(o("published", "public", "default", false)).toMatchObject({ indexed: false });
    expect(o("published", "public", "index", false)).toMatchObject({ indexed: true });
    expect(o("published", "unlisted")).toMatchObject({ label: "Unlisted", live: true, listed: false, indexed: false });
    expect(o("published", "unlisted", "index")).toMatchObject({ indexed: true });
    expect(o("published", "private", "index")).toMatchObject({ label: "Private", live: false, indexed: false });
    expect(o("archived", "public", "index")).toMatchObject({ label: "Archived", live: true, listed: false, indexed: false });
    expect(o("trashed", "public")).toMatchObject({ label: "Trashed", live: false });
  });

  it("says what Publish will do, so a private draft never silently publishes into nothing", () => {
    expect(publishPreview({ visibility: "public", robotsIndex: "default", typeIndexable: true }).summary).toBe("Live and listed across the site; indexed by search engines.");
    expect(publishPreview({ visibility: "private", robotsIndex: "default", typeIndexable: true }).summary).toMatch(/only you can see it/);
    expect(publishPreview({ visibility: "unlisted", robotsIndex: "default", typeIndexable: true }).summary).toMatch(/anyone with the link; not listed; not indexed/);
  });

  it("maps import choices to stored fields: drafts are stored public, so publishing one later makes it live", () => {
    expect(publicationFields("draft")).toEqual({ status: "draft", visibility: "public" });
    expect(publicationFields("published")).toEqual({ status: "published", visibility: "public" });
    expect(publicationFields("unlisted")).toEqual({ status: "published", visibility: "unlisted" });
  });

  it("labels the robots default by the format, not just the visibility", () => {
    expect(defaultIndexingLabel("public", true)).toBe("index");
    expect(defaultIndexingLabel("public", false)).toBe("noindex");
    expect(defaultIndexingLabel("unlisted", true)).toBe("noindex");
  });
});

const snapshot: DestinationSnapshot = {
  types: [{ id: "00000000-0000-4000-8000-000000000001", slug: "article", name: "Article", pluralName: "Articles", template: "editorial", routing: "type", fields: [] }],
  categories: [],
  tags: [],
  documents: [],
  identities: [],
  media: [],
  collectionItems: [],
  rootSlugs: ["article"],
  redirectPaths: [],
  fingerprint: "f",
};

async function plan(files: Record<string, string>, decisions: ImportDecisions = {}) {
  const pkg = await parsePackage(
    Object.entries(files).map(([path, text]) => ({ path, size: text.length, text, sha256: null, head: null })),
    { siteOrigin: "https://site.example", mediaOrigin: "https://media.example" },
  );
  const p = await planImport(pkg, snapshot, decisions, { maxUploadBytes: 1024 * 1024, sniffMedia: sniffType });
  return Object.fromEntries(p.documents.map((d) => [d.sourcePath, d]));
}

describe("import indexing: a file can keep a page out of search engines, never put one in", () => {
  const files = { "asks-index.md": "---\ntitle: A\nrobots: index\n---\nBody", "asks-noindex.md": "---\ntitle: B\nrobots: noindex\n---\nBody", "silent.md": "---\ntitle: C\n---\nBody" };

  it("Automatic ignores a file's index (and says so) and keeps its noindex", async () => {
    const d = await plan(files);
    expect([d["asks-index.md"]!.robotsIndex, d["asks-index.md"]!.robotsFrom]).toEqual([null, "default"]);
    expect(d["asks-index.md"]!.issues.some((i) => i.code === "robots.not_applied")).toBe(true);
    expect([d["asks-noindex.md"]!.robotsIndex, d["asks-noindex.md"]!.robotsFrom]).toEqual(["noindex", "source"]);
    expect(d["silent.md"]!.robotsIndex).toBeNull();
  });

  it("an explicit choice, import-wide or per document, wins", async () => {
    const d = await plan(files, { indexing: "noindex", documents: { "asks-index.md": { indexing: "index" } } });
    expect([d["asks-index.md"]!.robotsIndex, d["asks-index.md"]!.robotsFrom]).toEqual(["index", "decision"]);
    expect([d["asks-noindex.md"]!.robotsIndex, d["silent.md"]!.robotsIndex]).toEqual(["noindex", "noindex"]);
  });

  it("publishes only on an explicit choice; the file's own status is followed only when asked to", async () => {
    const published = { "p.md": "---\ntitle: P\nstatus: published\n---\nBody" };
    expect((await plan(published))["p.md"]).toMatchObject({ status: "draft", visibility: "public", statusFrom: "default" });
    expect((await plan(published, { status: { mode: "source" } }))["p.md"]).toMatchObject({ status: "published", visibility: "public", statusFrom: "source" });
    expect((await plan(published, { status: { mode: "set", status: "published", visibility: "unlisted" } }))["p.md"]).toMatchObject({ status: "published", visibility: "unlisted" });
  });
});
