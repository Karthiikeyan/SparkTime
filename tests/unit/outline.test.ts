import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadingLayout } from "@/components/content/reading-layout";
import { DocContent } from "@/components/content/renderer";
import { sanitizeDoc, type Doc } from "@/lib/content/blocks";
import { countWords, extractHeadings, extractPlainText, headingRanker } from "@/lib/content/derive";
import { activeHeadingIndex, buildOutline, OUTLINE_MIN_WORDS, outlineIds, readingOutline } from "@/lib/content/outline";

const heading = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const prose = (words: number) => paragraph(Array.from({ length: words }, (_, i) => `word${i}`).join(" "));
const docOf = (...nodes: unknown[]): Doc => sanitizeDoc({ type: "doc", content: nodes });

/** The /now page as the owner writes it: "Heading 1" sections (rendered <h2>), "Heading 2" subsections (<h3>). */
const NOW = docOf(
  prose(40),
  heading(1, "What I'm Working On"),
  heading(2, "Building at Work"),
  prose(50),
  heading(2, "Application Modernization"),
  prose(50),
  heading(2, "Engineering Beyond My Own Work"),
  prose(50),
  heading(3, "A detail too fine for the outline"),
  prose(30),
  heading(1, "What I'm Building Outside Work"),
  heading(2, "SparkTribe"),
  prose(50),
  heading(2, "Content"),
  prose(50),
  heading(1, "What I'm Learning"),
  heading(2, "AWS & Cloud"),
  prose(50),
  heading(2, "AI Agents"),
  prose(50),
  heading(2, "System Design"),
  prose(50),
  heading(1, "AI Is Becoming Leverage"),
  prose(60),
  heading(1, "Currently Reading"),
  prose(60),
  heading(1, "What I'm Figuring Out"),
  prose(60),
);
const nowWords = countWords(extractPlainText(NOW));

describe("reading outline", () => {
  it("nests subsections under their sections, in document order", () => {
    const outline = buildOutline(extractHeadings(NOW));
    expect(outline.map((e) => e.text)).toEqual(["What I'm Working On", "What I'm Building Outside Work", "What I'm Learning", "AI Is Becoming Leverage", "Currently Reading", "What I'm Figuring Out"]);
    expect(outline[0]!.children.map((e) => e.text)).toEqual(["Building at Work", "Application Modernization", "Engineering Beyond My Own Work"]);
    expect(outline[2]!.children.map((e) => e.id)).toEqual(["aws-and-cloud", "ai-agents", "system-design"]);
    expect(outline[3]!.children).toEqual([]);
  });

  it("leaves out <h4>s", () => {
    expect(outlineIds(buildOutline(extractHeadings(NOW)))).not.toContain("a-detail-too-fine-for-the-outline");
  });

  it("keeps a subsection that comes before any section at the top level", () => {
    const outline = buildOutline(extractHeadings(docOf(heading(2, "Preface"), heading(1, "One"), heading(2, "One A"))));
    expect(outline.map((e) => [e.text, e.children.map((c) => c.text)])).toEqual([
      ["Preface", []],
      ["One", ["One A"]],
    ]);
  });

  it("appears only on long, sectioned pages", () => {
    expect(nowWords).toBeGreaterThanOrEqual(OUTLINE_MIN_WORDS);
    expect(readingOutline(extractHeadings(NOW), nowWords)).not.toBeNull();
    // The title, an intro, one section and two paragraphs: just the words.
    const short = docOf(prose(40), heading(1, "Only section"), prose(60), prose(60));
    expect(readingOutline(extractHeadings(short), countWords(extractPlainText(short)))).toBeNull();
    // Plenty of headings but a three-minute page, or plenty of words with one heading: still no outline.
    expect(readingOutline(extractHeadings(NOW), OUTLINE_MIN_WORDS - 1)).toBeNull();
    // Fourth-level headings (<h4>) are noise in an outline: one section and one subsection is not enough.
    expect(readingOutline(extractHeadings(docOf(heading(1, "One"), heading(2, "Sub"), heading(3, "Deep"), heading(3, "Deeper"))), 5000)).toBeNull();
  });
});

describe("heading levels are ranked by what the piece uses", () => {
  it("a body written with Heading 2 and 3 reads as sections and subsections, not a jump from h1 to h3", () => {
    const doc = docOf(heading(2, "Building"), heading(3, "At work"), heading(2, "Learning"));
    expect(extractHeadings(doc).map((h) => h.level)).toEqual([1, 2, 1]);
    const rank = headingRanker(doc);
    expect([rank(2), rank(3)]).toEqual([1, 2]);
  });

  it("closes a skipped level, and leaves a piece that uses every level alone", () => {
    expect(extractHeadings(docOf(heading(1, "A"), heading(3, "B"))).map((h) => h.level)).toEqual([1, 2]);
    expect(extractHeadings(docOf(heading(1, "A"), heading(2, "B"), heading(3, "C"))).map((h) => h.level)).toEqual([1, 2, 3]);
    expect(extractHeadings(docOf(heading(3, "Only"))).map((h) => h.level)).toEqual([1]);
  });
});

describe("heading anchors", () => {
  it("are readable, URL-safe and unchanged for existing pages", () => {
    const ids = extractHeadings(docOf(heading(1, "What I'm Working On"), heading(2, "AI-Assisted Engineering"), heading(2, "AWS & Cloud"), heading(1, "Café — “Déjà vu”?"), heading(1, "🚀"))).map((h) => h.id);
    expect(ids).toEqual(["what-i-m-working-on", "ai-assisted-engineering", "aws-and-cloud", "cafe-deja-vu", "section"]);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("stay unique when headings repeat or collide with ids the page already uses", () => {
    const ids = extractHeadings(docOf(heading(1, "Summary"), heading(2, "Summary"), heading(1, "Summary 2"), heading(1, "Summary"), heading(1, "Main"))).map((h) => h.id);
    expect(ids).toEqual(["summary", "summary-2", "summary-2-2", "summary-3", "main-2"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("active section", () => {
  const view = { line: 300, height: 900, atEnd: false };

  it("is nothing before the first heading, then the last heading at or above the reading line", () => {
    expect(activeHeadingIndex([400, 1200, 2000], view)).toBe(-1);
    expect(activeHeadingIndex([-800, 120, 700], view)).toBe(1);
    expect(activeHeadingIndex([-800, -20, 300], view)).toBe(2);
  });

  it("picks the later of two headings that sit close together once both have passed the line", () => {
    expect(activeHeadingIndex([-400, 250, 290, 900], view)).toBe(2);
  });

  it("reaches short closing sections at the end of the page", () => {
    expect(activeHeadingIndex([-600, 100, 520, 760], view)).toBe(1);
    expect(activeHeadingIndex([-600, 100, 520, 760], { ...view, atEnd: true })).toBe(3);
    // Nothing below the screen counts, even at the end.
    expect(activeHeadingIndex([-600, 100, 520, 960], { ...view, atEnd: true })).toBe(2);
  });
});

describe("reading layout", () => {
  const outline = readingOutline(extractHeadings(NOW), nowWords)!;
  const render = (props: Partial<Omit<Parameters<typeof ReadingLayout>[0], "children">> = {}) =>
    renderToStaticMarkup(createElement(ReadingLayout, { outline, wordCount: nowWords, container: "container-narrow", ...props }, createElement("p", null, "Body")));

  it("renders the outline as a labelled landmark: a rail from xl up, a collapsed list below", () => {
    const html = render();
    expect(html.match(/<nav aria-label="On this page" data-toc="true">/g)).toHaveLength(2);
    expect(html).toMatch(/<div class="hidden xl:block"><div data-toc-scroll="true"[^>]*><nav aria-label="On this page"/);
    expect(html).toMatch(/<details class="[^"]*xl:hidden[^"]*"><summary[^>]*>On this page<svg[^>]*aria-hidden="true"/);
    // The rail's visible label is not read out a second time.
    expect(html).toContain('<p aria-hidden="true" class="eyebrow mb-3">On this page</p>');
    // Links only — no headings of its own, so the page's heading outline is untouched.
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it("nests subsections in real lists, with anchors matching the rendered headings", async () => {
    const html = render();
    expect(html).toMatch(/<li><a href="#what-i-m-working-on"[^>]*>What I&#x27;m Working On<\/a><ol class="pb-1"><li><a href="#building-at-work"/);
    expect(html).toMatch(/<li><a href="#ai-is-becoming-leverage"[^>]*>AI Is Becoming Leverage<\/a><\/li>/);

    const content = await DocContent({ doc: NOW, context: { refs: new Map(), media: new Map() } });
    const body = renderToStaticMarkup(content!);
    for (const id of outlineIds(outline)) {
      expect(body.match(new RegExp(`id="${id}"`, "g"))).toHaveLength(1);
      expect(html.match(new RegExp(`href="#${id}"`, "g"))).toHaveLength(2);
    }
    expect(body).toMatch(/<h2 id="what-i-m-working-on">/);
    expect(body).toMatch(/<h3 id="building-at-work">/);
    expect(body).toMatch(/<h4 id="a-detail-too-fine-for-the-outline">/);
  });

  it("shows the progress bar only on long reads", () => {
    expect(render({ wordCount: 1200 })).toContain('class="reading-progress"');
    expect(render({ wordCount: 900 })).not.toContain("reading-progress");
  });

  it("leaves a page without an outline exactly in the template's own container", () => {
    const html = render({ outline: null, container: "container-narrow", className: "mt-8", columnClassName: "space-y-8", wordCount: 200 });
    expect(html).toBe('<div class="container-narrow mt-8"><div class="min-w-0 xl:col-start-2 space-y-8"><p>Body</p></div></div>');
  });
});
