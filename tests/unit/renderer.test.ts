import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocContent } from "@/components/content/renderer";
import { sanitizeDoc } from "@/lib/content/blocks";

const heading = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

async function render(...nodes: unknown[]): Promise<string> {
  const element = await DocContent({ doc: sanitizeDoc({ type: "doc", content: nodes }), context: { refs: new Map(), media: new Map() } });
  return element ? renderToStaticMarkup(element) : "";
}

describe("linkable headings", () => {
  it("keep the permalink outside the heading so its accessible name is just its text", async () => {
    const html = await render(heading(1, "Why I started"), paragraph("…"));
    expect(html).toContain('<h2 id="why-i-started">Why I started</h2>');
    expect(html).toMatch(/<\/h2> <a href="#why-i-started" class="heading-anchor" aria-label="Link to section: Why I started">#<\/a>/);
    expect(html).not.toMatch(/<h2[^>]*>[^<]*<a/);
  });

  it("give repeated headings unique anchors that match the table of contents", async () => {
    const html = await render(heading(1, "Summary"), heading(2, "Summary"), heading(3, "Deep"));
    expect(html).toContain('<h2 id="summary">');
    expect(html).toContain('<h3 id="summary-2">');
    expect(html).toContain('<h4 id="deep">');
  });

  it("leave headings inside callouts plain (not part of the outline)", async () => {
    const html = await render({ type: "callout", attrs: { variant: "note" }, content: [heading(1, "Inside"), paragraph("x")] });
    expect(html).toContain("<h2>Inside</h2>");
    expect(html).not.toContain("heading-anchor");
  });
});
