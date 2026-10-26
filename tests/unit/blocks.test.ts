import { describe, expect, it } from "vitest";
import { ContentTooLargeError, LIMITS, sanitizeDoc, type BlockNode } from "@/lib/content/blocks";

const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (...c: unknown[]) => ({ type: "paragraph", content: c });
const doc = (...c: unknown[]) => ({ type: "doc", content: c });
const json = (v: unknown) => JSON.stringify(v);

describe("sanitizeDoc — XSS and injection", () => {
  it("drops javascript: links but keeps the text", () => {
    const out = sanitizeDoc(doc(para(text("click", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))));
    expect(json(out)).not.toContain("javascript");
    expect(out.content[0]!.content![0]).toEqual({ type: "text", text: "click" });
  });

  it("keeps safe links and strips extra link attributes", () => {
    const out = sanitizeDoc(doc(para(text("x", [{ type: "link", attrs: { href: "https://ok.example", target: "_self", onclick: "evil()" } }]))));
    expect(out.content[0]!.content![0]!.marks).toEqual([{ type: "link", attrs: { href: "https://ok.example/" } }]);
  });

  it("removes unknown node types such as <script>-like payloads, preserving readable text", () => {
    const out = sanitizeDoc(doc({ type: "script", content: [text("alert(1)")] }, { type: "iframe", attrs: { src: "https://evil" } }));
    expect(json(out)).not.toMatch(/script"|iframe/);
    expect(out.content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "alert(1)" }] }]);
  });

  it("never lets unknown attributes through", () => {
    const out = sanitizeDoc(doc({ type: "paragraph", attrs: { style: "x", onmouseover: "evil()" }, content: [text("hi")] }, { type: "heading", attrs: { level: 2, class: "x", dangerouslySetInnerHTML: { __html: "<img onerror>" } }, content: [text("h")] }));
    expect(out.content[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "hi" }] });
    expect(out.content[1]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "h" }] });
  });

  it.each(["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "/etc/passwd", "//evil.example/x.png", "http://insecure.example/x.png"])(
    "drops images with unsafe src %j",
    (src) => {
      expect(sanitizeDoc(doc({ type: "image", attrs: { src, alt: "x" } })).content).toEqual([]);
    },
  );

  it("accepts media from our paths and https hosts", () => {
    const out = sanitizeDoc(doc({ type: "image", attrs: { src: "/media/2026/09/x.webp", alt: "Alt", width: "800", height: 600, size: "huge" } }));
    expect(out.content[0]!.attrs).toMatchObject({ src: "/media/2026/09/x.webp", alt: "Alt", width: 800, height: 600, size: "content" });
  });

  it("validates YouTube ids and embed providers", () => {
    expect(sanitizeDoc(doc({ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } })).content).toHaveLength(1);
    expect(sanitizeDoc(doc({ type: "youtube", attrs: { videoId: "../../evil" } })).content).toEqual([]);
    expect(sanitizeDoc(doc({ type: "youtube", attrs: { src: "https://youtu.be/dQw4w9WgXcQ?t=30" } })).content[0]!.attrs!.videoId).toBe("dQw4w9WgXcQ");
    expect(sanitizeDoc(doc({ type: "embed", attrs: { provider: "evil", embedId: "x" } })).content).toEqual([]);
    expect(sanitizeDoc(doc({ type: "embed", attrs: { provider: "vimeo", embedId: "76979871" } })).content).toHaveLength(1);
    expect(sanitizeDoc(doc({ type: "embed", attrs: { provider: "vimeo", embedId: "1\"><script>" } })).content).toEqual([]);
  });

  it("drops buttons with unsafe hrefs and bookmarks with relative URLs", () => {
    expect(sanitizeDoc(doc({ type: "button", attrs: { label: "Go", href: "javascript:void(0)" } })).content).toEqual([]);
    expect(sanitizeDoc(doc({ type: "bookmark", attrs: { url: "/internal" } })).content).toEqual([]);
  });

  it("filters forged ids in related-content blocks and mentions", () => {
    const out = sanitizeDoc(
      doc(
        { type: "relatedContent", attrs: { documentIds: ["not-a-uuid", "11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111"] } },
        para({ type: "docRef", attrs: { documentId: "' OR 1=1 --", label: "x" } }),
      ),
    );
    expect(out.content[0]!.attrs!.documentIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(out.content[1]).toEqual({ type: "paragraph" });
  });

  it("sanitises code block languages", () => {
    const out = sanitizeDoc(doc({ type: "codeBlock", attrs: { language: "ts\" onload=\"x" }, content: [text("const a = 1;", [{ type: "bold" }])] }));
    expect(out.content[0]!.attrs!.language).toBeNull();
    expect(out.content[0]!.content![0]).toEqual({ type: "text", text: "const a = 1;" });
  });

  it("strips control characters from text", () => {
    const out = sanitizeDoc(doc(para(text(`a${String.fromCharCode(0)}b${String.fromCharCode(7)}c`))));
    expect(out.content[0]!.content![0]!.text).toBe("abc");
  });
});

describe("sanitizeDoc — structure", () => {
  it("wraps stray inline content and lifts misplaced list items", () => {
    const out = sanitizeDoc(doc(text("loose"), { type: "listItem", content: [para(text("orphan"))] }));
    expect(out.content[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "loose" }] });
    expect(out.content[1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "orphan" }] });
  });

  it("normalises columns: 1 column unwraps, >3 truncates, no nesting", () => {
    const col = (t: string) => ({ type: "column", content: [para(text(t))] });
    expect(sanitizeDoc(doc({ type: "columns", content: [col("only")] })).content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "only" }] }]);
    const four = sanitizeDoc(doc({ type: "columns", content: [col("a"), col("b"), col("c"), col("d")] }));
    expect(four.content[0]!.content).toHaveLength(3);
    const nested = sanitizeDoc(doc({ type: "columns", content: [{ type: "column", content: [{ type: "columns", content: [col("x"), col("y")] }] }, col("z")] }));
    expect(json(nested.content[0]!.content![0])).not.toContain('"columns"');
  });

  it("repairs details blocks and fills empty containers", () => {
    const out = sanitizeDoc(doc({ type: "details", content: [] }, { type: "blockquote", content: [] }));
    expect(out.content[0]!.content!.map((c: BlockNode) => c.type)).toEqual(["detailsSummary", "detailsContent"]);
    expect(out.content[1]).toEqual({ type: "blockquote", content: [{ type: "paragraph" }] });
  });

  it("clamps heading levels and ordered list starts", () => {
    const out = sanitizeDoc(doc({ type: "heading", attrs: { level: 9 }, content: [text("x")] }, { type: "orderedList", attrs: { start: -5 }, content: [{ type: "listItem", content: [para(text("i"))] }] }));
    expect(out.content[0]!.attrs!.level).toBe(3);
    expect(out.content[1]!.attrs!.start).toBe(1);
  });

  it("returns an empty doc for garbage input", () => {
    for (const bad of [null, 42, "doc", { type: "paragraph" }, { type: "doc", content: "x" }]) {
      expect(sanitizeDoc(bad)).toEqual({ type: "doc", content: [] });
    }
  });
});

describe("sanitizeDoc — limits", () => {
  it("rejects documents with too many nodes", () => {
    const many = Array.from({ length: LIMITS.maxNodes + 10 }, () => ({ type: "horizontalRule" }));
    expect(() => sanitizeDoc({ type: "doc", content: many })).toThrow(ContentTooLargeError);
  });

  it("truncates depth bombs instead of recursing forever", () => {
    let node: Record<string, unknown> = para(text("deep"));
    for (let i = 0; i < 200; i++) node = { type: "blockquote", content: [node] };
    const out = sanitizeDoc(doc(node));
    expect(json(out).length).toBeLessThan(5000);
  });
});
