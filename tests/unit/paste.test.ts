import { describe, expect, it } from "vitest";
import { choosePasteStrategy, isCodeEditorHtml, isSemanticHtml, looksLikeMarkdown, markdownToHtml, stripHiddenHashtagLabels } from "@/editor/paste";

const AI_ANSWER = `# Building an emergency fund

Here's a simple plan:

- Save **3–6 months** of expenses
- Keep it in a [liquid fund](https://example.com)
- Automate the transfer

> Start small, stay consistent.

\`\`\`python
months = 6
\`\`\`
`;

describe("markdown detection", () => {
  it("recognises typical AI-tool output", () => {
    expect(looksLikeMarkdown(AI_ANSWER)).toBe(true);
    expect(looksLikeMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(true);
    expect(looksLikeMarkdown("- [ ] one\n- [x] two")).toBe(true);
  });

  it("leaves ordinary prose alone", () => {
    expect(looksLikeMarkdown("Just a sentence I copied from an email.")).toBe(false);
    expect(looksLikeMarkdown("Dear team,\n\nThanks for yesterday. Let's talk soon.\n\nBest,\nK")).toBe(false);
    expect(looksLikeMarkdown("Price: 5 * 3 = 15")).toBe(false);
  });
});

describe("HTML classification", () => {
  it("detects semantic HTML from web pages and chat UIs", () => {
    expect(isSemanticHtml("<h2>Title</h2><p>Body <strong>bold</strong></p>")).toBe(true);
    expect(isSemanticHtml("<ul><li>a</li></ul>")).toBe(true);
    expect(isSemanticHtml("<span>plain</span>")).toBe(false);
  });

  it("recognises syntax-highlighted source from code editors", () => {
    const vscode = '<div style="font-family: Consolas, monospace;"><div><span style="color:#569cd6;"># Heading</span></div></div>';
    expect(isCodeEditorHtml(vscode)).toBe(true);
    expect(isCodeEditorHtml("<p>normal</p>")).toBe(false);
  });
});

describe("paste strategy", () => {
  it("uploads pasted images", () => {
    expect(choosePasteStrategy({ hasFiles: true, html: "", text: "" })).toBe("files");
  });
  it("prefers structured HTML over its plain-text twin", () => {
    expect(choosePasteStrategy({ hasFiles: false, html: "<h1>T</h1><ul><li>x</li></ul>", text: "T\n\nx" })).toBe("html");
  });
  it("converts Markdown when the HTML is just editor colouring", () => {
    const html = '<div style="font-family: Menlo, monospace;"><span># Title</span><br><span>- item</span></div>';
    expect(choosePasteStrategy({ hasFiles: false, html, text: "# Title\n- item\n- item two" })).toBe("markdown");
  });
  it("converts Markdown source pasted as plain text", () => {
    expect(choosePasteStrategy({ hasFiles: false, html: "", text: AI_ANSWER })).toBe("markdown");
  });
  it("keeps plain text plain", () => {
    expect(choosePasteStrategy({ hasFiles: false, html: "", text: "hello world" })).toBe("text");
  });
});

describe("markdown → HTML", () => {
  it("produces the structures the editor schema parses", () => {
    const html = markdownToHtml(AI_ANSWER);
    expect(html).toContain("<h1>Building an emergency fund</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>3–6 months</strong>");
    expect(html).toContain('<a href="https://example.com">liquid fund</a>');
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<code class="language-python">');
  });
});

describe("LinkedIn hashtag labels", () => {
  it("drops the hidden 'hashtag' label LinkedIn copies along with each hashtag", () => {
    expect(stripHiddenHashtagLabels("hashtag#LifeLessons hashtag#TakeRisks")).toBe("#LifeLessons #TakeRisks");
    expect(stripHiddenHashtagLabels("All the best.\nhashtag#DreamBig")).toBe("All the best.\n#DreamBig");
  });

  it("leaves ordinary text, real hashtags and the word 'hashtag' alone", () => {
    for (const text of ["#DreamBig", "Use a hashtag # sparingly", "the hashtag is #fi", "myhashtag#x", "hashtag#"]) {
      expect(stripHiddenHashtagLabels(text)).toBe(text);
    }
  });

  it("applies to Markdown pastes too", () => {
    expect(markdownToHtml("## Lessons\n\nhashtag#Growth")).toContain("<p>#Growth</p>");
  });
});
