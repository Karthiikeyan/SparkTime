import { describe, expect, it } from "vitest";
import { sanitizeDoc } from "@/lib/content/blocks";
import { autoExcerpt, deriveContent, extractHeadings, extractReferences, extractSnapshot } from "@/lib/content/derive";
import { docToMarkdown } from "@/lib/content/markdown";
import type { FieldDefinition } from "@/lib/content/model";
import { normalizeFieldDefinitions, propertySearchText, validateProperties } from "@/lib/content/properties";

const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...c: unknown[]) => ({ type: "paragraph", content: c });
const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [t(text)] });
const DOC_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "22222222-2222-4222-8222-222222222222";

describe("derivations", () => {
  const doc = sanitizeDoc({
    type: "doc",
    content: [
      h(1, "Why FIRE?"),
      p(t("Financial independence is "), t("freedom", [{ type: "bold" }]), t(". See "), { type: "docRef", attrs: { documentId: DOC_ID, label: "my plan" } }),
      h(1, "Why FIRE?"),
      { type: "image", attrs: { src: "/media/2026/09/a.webp", mediaId: MEDIA_ID, alt: "A chart" } },
      p(t("internal", [{ type: "link", attrs: { href: "/article/savings-rate" } }]), t(" and "), t("absolute", [{ type: "link", attrs: { href: "https://karthikeyan.example/project/tracker?x=1" } }])),
      { type: "codeBlock", attrs: { language: "ts" }, content: [t("const rate = 0.5;")] },
    ],
  });

  it("extracts plain text, words and reading time", () => {
    const d = deriveContent(doc);
    expect(d.plainText).toContain("Financial independence is freedom. See my plan");
    expect(d.plainText).toContain("const rate = 0.5;");
    expect(d.wordCount).toBeGreaterThan(10);
    expect(d.readingMinutes).toBe(1);
  });

  it("builds unique heading anchors", () => {
    expect(extractHeadings(doc).map((x) => x.id)).toEqual(["why-fire", "why-fire-2"]);
  });

  it("extracts references for backlinks and media protection", () => {
    const refs = extractReferences(doc, "https://karthikeyan.example");
    expect(refs.documentIds).toEqual([DOC_ID]);
    expect(refs.mediaIds).toEqual([MEDIA_ID]);
    expect(refs.internalPaths.sort()).toEqual(["/article/savings-rate", "/project/tracker"]);
  });

  it("creates readable auto-excerpts", () => {
    expect(autoExcerpt("Short.")).toBe("Short.");
    const long = autoExcerpt("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(181);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("snapshot (the home page's glimpse of /now)", () => {
  const li = (text: string) => ({ type: "listItem", content: [p(t(text))] });
  const todo = (text: string) => ({ type: "callout", attrs: { variant: "important" }, content: [p(t(`[TODO] ${text}`))] });

  it("pairs each heading with the first thing written under it", () => {
    const doc = sanitizeDoc({
      type: "doc",
      content: [
        p(t("A snapshot of what has my attention.")),
        h(2, "Building"),
        p(t("A  personal   site.")),
        p(t("Second paragraph is not part of the glimpse.")),
        h(2, "Learning"),
        { type: "bulletList", content: [li("Rust"), li("System design"), li("Tamil typography"), li("A fourth thing")] },
        h(2, "Reading"),
        p(t("A book")),
      ],
    });
    expect(extractSnapshot(doc)).toEqual([
      { label: "Building", text: "A personal site." },
      { label: "Learning", text: "Rust, System design, Tamil typography" },
      { label: "Reading", text: "A book" },
    ]);
    expect(extractSnapshot(doc, 1)).toHaveLength(1);
  });

  it("skips headings that still hold only [TODO] prompts", () => {
    const doc = sanitizeDoc({ type: "doc", content: [h(2, "Building"), todo("What are you building?"), h(2, "Learning"), p(t("[TODO] later")), h(2, "Reading"), p(t("Deep Work"))] });
    expect(extractSnapshot(doc)).toEqual([{ label: "Reading", text: "Deep Work" }]);
    expect(extractSnapshot(sanitizeDoc({ type: "doc", content: [p(t("No headings at all."))] }))).toEqual([]);
  });
});

describe("markdown export", () => {
  it("serialises every common block type", () => {
    const doc = sanitizeDoc({
      type: "doc",
      content: [
        h(1, "Title"),
        p(t("a "), t("b", [{ type: "bold" }]), t(" "), t("c", [{ type: "italic" }]), t(" "), t("d", [{ type: "link", attrs: { href: "https://x.example" } }])),
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("one"))] }, { type: "listItem", content: [p(t("two"))] }] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("three"))] }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] }] },
        { type: "blockquote", content: [p(t("quoted"))] },
        { type: "callout", attrs: { variant: "tip" }, content: [p(t("hint"))] },
        { type: "codeBlock", attrs: { language: "js" }, content: [t("x()")] },
        { type: "horizontalRule" },
        { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ", title: "Talk" } },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p(t("H"))] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [p(t("v|x"))] }] }] },
      ],
    });
    const md = docToMarkdown(doc);
    expect(md).toContain("# Title");
    expect(md).toContain("a **b** _c_ [d](https://x.example/)");
    expect(md).toContain("- one\n- two");
    expect(md).toContain("3. three");
    expect(md).toContain("- [x] done");
    expect(md).toContain("> quoted");
    expect(md).toContain("> [!TIP]\n> hint");
    expect(md).toContain("```js\nx()\n```");
    expect(md).toContain("---");
    expect(md).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(md).toContain("| H |");
    expect(md).toContain("v\\|x");
  });

  it("escapes markdown control characters in text", () => {
    const md = docToMarkdown(sanitizeDoc({ type: "doc", content: [p(t("*not bold* [x](y) <b>"))] }));
    expect(md).toContain("\\*not bold\\* \\[x\\](y) \\<b\\>");
  });
});

describe("custom properties", () => {
  const fields: FieldDefinition[] = [
    { key: "rating", label: "Rating", type: "number", role: "rating", required: false, helpText: "", options: { min: 0, max: 5 }, showInFacts: true, position: 0 },
    { key: "bookTitle", label: "Book title", type: "text", role: "itemName", required: true, helpText: "", options: {}, showInFacts: true, position: 1 },
    { key: "site", label: "Site", type: "url", role: "primaryUrl", required: false, helpText: "", options: {}, showInFacts: true, position: 2 },
    { key: "kind", label: "Kind", type: "select", role: null, required: false, helpText: "", options: { choices: [{ value: "book", label: "Book" }] }, showInFacts: true, position: 3 },
    { key: "stack", label: "Stack", type: "multi_select", role: null, required: false, helpText: "", options: { choices: [], allowCustom: true }, showInFacts: true, position: 4 },
    { key: "when", label: "When", type: "date", role: null, required: false, helpText: "", options: {}, showInFacts: true, position: 5 },
  ];

  it("coerces and validates values, dropping unknown keys", () => {
    const { values, errors } = validateProperties(fields, { rating: "4", bookTitle: " Atomic Habits ", site: "https://x.example", kind: "book", stack: ["Java", "Java", "AWS"], when: "2026-02-28", evil: "<script>" }, "draft");
    expect(errors).toEqual({});
    expect(values).toEqual({ rating: 4, bookTitle: "Atomic Habits", site: "https://x.example/", kind: "book", stack: ["Java", "AWS"], when: "2026-02-28" });
  });

  it("rejects invalid values", () => {
    const { errors } = validateProperties(fields, { rating: 9, site: "javascript:alert(1)", kind: "movie", when: "2026-02-30" }, "draft");
    expect(Object.keys(errors).sort()).toEqual(["kind", "rating", "site", "when"]);
  });

  it("enforces required fields only when publishing", () => {
    expect(validateProperties(fields, {}, "draft").errors).toEqual({});
    expect(validateProperties(fields, {}, "publish").errors).toHaveProperty("bookTitle");
  });

  it("feeds searchable text from properties", () => {
    expect(propertySearchText(fields, { bookTitle: "Atomic Habits", kind: "book", stack: ["Java"] })).toBe("Atomic Habits Book Java");
  });

  it("validates field definitions for the type builder", () => {
    const bad = normalizeFieldDefinitions([
      { key: "Bad Key", label: "x", type: "text" },
      { key: "a", label: "A", type: "text", role: "rating" },
      { key: "a", label: "Dup", type: "text" },
      { key: "s", label: "S", type: "select", options: { choices: [] } },
      { key: "z", label: "Z", type: "exec" },
    ]);
    expect(bad.errors.length).toBeGreaterThanOrEqual(5);
    const good = normalizeFieldDefinitions([{ key: "isbn", label: "ISBN", type: "text", role: "isbn", options: { choices: [{ value: "x" }] } }]);
    expect(good.errors).toEqual([]);
    expect(good.fields[0]).toMatchObject({ key: "isbn", role: "isbn", options: {} });
  });
});
