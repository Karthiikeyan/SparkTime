import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeDoc, type BlockNode, type Doc } from "@/lib/content/blocks";
import { newStats, type BodyContext } from "@/lib/portability/body-context";
import { splitFrontmatter } from "@/lib/portability/frontmatter";
import { htmlToBlocks } from "@/lib/portability/html-to-doc";
import { parseManifest } from "@/lib/portability/manifest";
import { markdownToBlocks, preprocessMdx } from "@/lib/portability/markdown-to-doc";
import { parsePackage, type StagedFile } from "@/lib/portability/parse";
import { looksSequenced, numericPrefix, orderItems } from "@/lib/portability/order";

const OPTIONS = { siteOrigin: "https://karthikeyan.example", mediaOrigin: "https://media.example" };

function ctx(overrides: Partial<BodyContext> = {}): BodyContext {
  const links: string[] = [];
  const media: string[] = [];
  return {
    path: "test.md",
    stats: newStats(),
    issue: () => undefined,
    link: (href) => {
      links.push(href);
      return /^https?:/.test(href) || href.startsWith("#") ? href : `ref:${links.length - 1}`;
    },
    media: (src) => {
      media.push(src);
      return `asset-ref:${media.length - 1}`;
    },
    wikiLink: (t) => `ref:wiki-${t}`,
    wikiEmbed: (t) => (/\.png$/.test(t) ? { kind: "image", src: `asset-ref:wiki-${t}` } : { kind: "link", href: `ref:wiki-${t}` }),
    ...overrides,
  };
}

function staged(files: Record<string, string>, media: Record<string, number> = {}): StagedFile[] {
  return [
    ...Object.entries(files).map(([path, text]) => ({ path, size: text.length, text, sha256: null, head: null })),
    ...Object.entries(media).map(([path, size]) => ({ path, size, text: null, sha256: "a".repeat(64), head: "" })),
  ];
}

function types(nodes: BlockNode[]): string[] {
  return nodes.map((n) => n.type);
}

function text(node: BlockNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(text).join("");
}

describe("front matter", () => {
  it("parses block scalars, flow lists and quoted strings", () => {
    const fm = splitFrontmatter('---\ntitle: "A: B"\ntags: ["x", "y"]\nlist:\n  - one\n  - two\ntakeaways: |\n  Line 1\n  Line 2\ndate: 2026-10-01\n---\nBody');
    expect(fm.kind).toBe("ok");
    if (fm.kind !== "ok") return;
    expect(fm.data).toMatchObject({ title: "A: B", tags: ["x", "y"], list: ["one", "two"], takeaways: "Line 1\nLine 2\n" });
    // CORE schema: dates stay strings (validated later), never Date objects.
    expect(fm.data.date).toBe("2026-10-01");
    expect(fm.body).toBe("Body");
  });

  it("reports malformed, unclosed, non-map and TOML front matter", () => {
    expect(splitFrontmatter("---\ntitle: [unclosed\n---\nx").kind).toBe("error");
    expect(splitFrontmatter("---\ntitle: x\nno end").kind).toBe("error");
    expect(splitFrontmatter("---\n- a\n- b\n---\nx").kind).toBe("error");
    expect(splitFrontmatter("+++\ntitle = 'x'\n+++\n").kind).toBe("error");
    expect(splitFrontmatter("No front matter").kind).toBe("none");
  });

  it("defuses alias amplification", () => {
    const bomb = ["---", 'a: &a ["x","x","x","x","x","x","x","x","x","x"]', "b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]", "c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]", "d: [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]", "---", ""].join("\n");
    const fm = splitFrontmatter(bomb);
    expect(fm.kind).toBe("error");
  });

  it("rejects custom YAML tags rather than executing them", () => {
    expect(splitFrontmatter("---\nx: !!js/function 'function(){}'\n---\n").kind).toBe("error");
  });
});

describe("Markdown → blocks", () => {
  it("maps headings, lists, tasks, quotes, code, tables and rules", () => {
    const blocks = markdownToBlocks(
      ["## Section", "", "#### Deep", "", "- a", "- b", "  1. nested", "", "Between lists.", "", "- [x] done", "- [ ] todo", "", "> quoted", "", "```ts", "const x = 1;", "```", "", "| h1 | h2 |", "|---|---|", "| a | **b** |", "", "---"].join("\n"),
      ctx(),
    );
    expect(types(blocks)).toEqual(["heading", "heading", "bulletList", "paragraph", "taskList", "blockquote", "codeBlock", "table", "horizontalRule"]);
    expect(blocks[1]!.attrs).toEqual({ level: 3 });
    expect(blocks[2]!.content![1]!.content!.map((n) => n.type)).toEqual(["paragraph", "orderedList"]);
    expect(blocks[4]!.content!.map((i) => i.attrs?.checked)).toEqual([true, false]);
    expect(blocks[6]!.attrs).toEqual({ language: "ts" });
    expect(blocks[7]!.content![0]!.content![0]!.type).toBe("tableHeader");
    const doc = sanitizeDoc({ type: "doc", content: blocks });
    expect(doc.content.length).toBe(9);
  });

  it("keeps marks, decodes entities and turns links and images into placeholders", () => {
    const blocks = markdownToBlocks('Tom &amp; Jerry **bold** _it_ ~~gone~~ `code` <u>under</u> [next](./02-next.md) ![Alt](img/a%20b.png "Cap")', ctx());
    expect(types(blocks)).toEqual(["paragraph", "image"]);
    const nodes = blocks[0]!.content!;
    expect(nodes[0]!.text).toBe("Tom & Jerry ");
    expect(nodes.find((n) => n.text === "bold")!.marks).toEqual([{ type: "bold" }]);
    expect(nodes.find((n) => n.text === "under")!.marks).toEqual([{ type: "underline" }]);
    expect(nodes.find((n) => n.text === "next")!.marks).toEqual([{ type: "link", attrs: { href: "ref:0" } }]);
    expect(blocks[1]!.attrs).toEqual({ src: "asset-ref:0", alt: "Alt", caption: "Cap" });
  });

  it("turns GitHub and Obsidian alerts into callouts, keeping an Obsidian title", () => {
    const gh = markdownToBlocks("> [!WARNING]\n> Careful now", ctx());
    expect(gh[0]).toMatchObject({ type: "callout", attrs: { variant: "warning" } });
    expect(text(gh[0])).toBe("Careful now");
    const obs = markdownToBlocks("> [!tip] Pro move\n> Body text", ctx());
    expect(obs[0]).toMatchObject({ type: "callout", attrs: { variant: "tip" } });
    expect(text(obs[0]!.content![0])).toBe("Pro move");
    expect(text(obs[0]!.content![1])).toBe("Body text");
  });

  it("collects <details> blocks that span Markdown", () => {
    const blocks = markdownToBlocks("<details><summary>More</summary>\n\nHidden **text**\n\n</details>\n\nAfter", ctx());
    expect(types(blocks)).toEqual(["details", "paragraph"]);
    expect(text(blocks[0]!.content![0])).toBe("More");
    expect(text(blocks[0]!.content![1])).toBe("Hidden text");
  });

  it("resolves wikilinks and embeds through the context", () => {
    const blocks = markdownToBlocks("See [[OOP Basics|the OOP note]] and ![[diagram.png]] and ![[Other note]]", ctx());
    const link = blocks[0]!.content!.find((n) => n.text === "the OOP note");
    expect(link!.marks).toEqual([{ type: "link", attrs: { href: "ref:wiki-OOP Basics" } }]);
    expect(blocks[1]).toMatchObject({ type: "image", attrs: { src: "asset-ref:wiki-diagram.png" } });
  });

  it("makes a paragraph that is only a YouTube link a player", () => {
    const blocks = markdownToBlocks("[Watch](https://www.youtube.com/watch?v=dQw4w9WgXcQ)", ctx());
    expect(blocks[0]).toMatchObject({ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } });
  });

  it("drops dangerous links after sanitising", () => {
    const blocks = markdownToBlocks("[x](javascript:alert(1)) <a href=\"javascript:alert(2)\">y</a>", ctx({ link: (href) => (/^https?:/.test(href) ? href : null) }));
    const doc = sanitizeDoc({ type: "doc", content: blocks });
    expect(JSON.stringify(doc)).not.toMatch(/javascript/);
    expect(text(doc.content[0])).toContain("x");
  });
});

describe("MDX", () => {
  it("removes ESM, fences components and never evaluates anything", () => {
    const src = ["import Chart from './chart'", "export const meta = { a: 1 };", "", "# Title", "", "<Chart data={[1,2]} />", "", "<Callout type=\"tip\">", "Inner **md**", "</Callout>", "", "{/* comment */}Text", "", "```js", "import kept from 'code';", "```"].join("\n");
    const out = preprocessMdx(src);
    expect(out.esm).toHaveLength(2);
    expect(out.components.sort()).toEqual(["Callout", "Chart"]);
    expect(out.source).toContain("```mdx\n<Chart data={[1,2]} />\n```");
    expect(out.source).toContain("import kept from 'code';");
    expect(out.source).not.toContain("comment");
    const blocks = markdownToBlocks(out.source, ctx());
    expect(blocks.filter((b) => b.type === "codeBlock").map((b) => b.attrs?.language)).toEqual(["mdx", "mdx", "js"]);
  });
});

describe("HTML → blocks", () => {
  it("drops scripts and styles with their content and maps structure", () => {
    const html = `<html><head><title>Page T</title><meta name="description" content="Desc"><style>p{}</style></head><body>
      <script>alert(1)</script><h1>Heading</h1><p onclick="x()">Hello <b>world</b><br>line <img src="a.png" alt="A"></p>
      <ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>
      <pre><code class="language-py">print("hi")</code></pre>
      <table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>
      <figure><img src="b.png"><figcaption>Caption</figcaption></figure>
      <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
      <details><summary>S</summary><p>D</p></details></body></html>`;
    const out = htmlToBlocks(html, ctx());
    expect(out.title).toBe("Page T");
    expect(out.description).toBe("Desc");
    expect(types(out.blocks)).toEqual(["heading", "paragraph", "image", "bulletList", "codeBlock", "table", "image", "youtube", "details"]);
    expect(JSON.stringify(out.blocks)).not.toMatch(/alert|onclick|p\{\}/);
    expect(out.blocks[4]!.attrs).toEqual({ language: "py" });
    expect(out.blocks[6]!.attrs).toMatchObject({ caption: "Caption" });
  });

  it("survives malformed markup", () => {
    const out = htmlToBlocks("<p>unclosed <b>bold <i>both</p><p>next</div></span>< stray", ctx());
    expect(out.blocks.length).toBeGreaterThan(0);
    expect(sanitizeDoc({ type: "doc", content: out.blocks }).content.length).toBeGreaterThan(0);
  });
});

describe("ordering", () => {
  it("reads numeric prefixes and worded sequences", () => {
    expect(numericPrefix("01-java-basics.md")).toBe(1);
    expect(numericPrefix("Day 12 - Streams.md")).toBe(12);
    expect(numericPrefix("lesson_3.md")).toBe(3);
    expect(numericPrefix("2024-review.md")).toBe(2024);
    expect(numericPrefix("intro.md")).toBeNull();
    expect(looksSequenced(["01-a.md", "02-b.md", "notes.md"])).toBe(true);
    expect(looksSequenced(["a.md", "b.md", "01-c.md"])).toBe(false);
  });

  it("orders explicit > prefix > natural name, independent of input order", () => {
    const items = [
      { path: "c/10-ten.md", explicit: null },
      { path: "c/2-two.md", explicit: null },
      { path: "c/appendix.md", explicit: null },
      { path: "c/1-one.md", explicit: null },
    ];
    const a = orderItems(items).items.map((i) => i.path);
    const b = orderItems([...items].reverse()).items.map((i) => i.path);
    expect(a).toEqual(["c/1-one.md", "c/2-two.md", "c/10-ten.md", "c/appendix.md"]);
    expect(b).toEqual(a);
    const explicit = orderItems([...items, { path: "c/first.md", explicit: 0 }]);
    expect(explicit.items[0]!.path).toBe("c/first.md");
    expect(explicit.source).toBe("explicit");
    expect(orderItems(items, ["appendix.md"]).items[0]!.path).toBe("c/appendix.md");
  });
});

function loadFolder(dir: string): StagedFile[] {
  const out: StagedFile[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const textValue = readFileSync(full, "utf8");
        out.push({ path: "articles/" + relative(dir, full).replace(/\\/g, "/"), size: textValue.length, text: textValue, sha256: null, head: null });
      }
    }
  };
  walk(dir);
  return out;
}

// articles/ is local content that is never committed, so this suite only runs where it exists.
const articlesDir = join(process.cwd(), "articles");

describe.skipIf(!existsSync(articlesDir))("parsePackage: plain Markdown folder (the real articles/ batch)", () => {
  it("parses every article with front matter, keeps README as folder metadata", async () => {
    const files = loadFolder(articlesDir);
    const pkg = await parsePackage(files, OPTIONS);
    expect(pkg.sourceSystem).toBe("folder");
    expect(pkg.rootFolder).toBe("articles");
    expect(pkg.documents).toHaveLength(files.filter((f) => f.path.endsWith(".md") && !/(^|\/)README\.md$/i.test(f.path)).length);
    expect(pkg.folders.find((f) => f.path === "")?.readmePath).toBe("README.md");
    const ctc = pkg.documents.find((d) => d.sourcePath === "career/ctc-vs-in-hand-salary.md")!;
    expect(ctc.title).toEqual({ value: "CTC vs In-Hand Salary: Why Your ₹12 LPA Offer Doesn't Pay ₹1 Lakh a Month", from: "frontmatter" });
    expect(ctc.slug?.value).toBe("ctc-vs-in-hand-salary");
    expect(ctc.topics.map((t) => t.value)).toEqual(["career"]);
    expect(ctc.tags.map((t) => t.value)).toContain("CTC");
    expect(ctc.properties).toMatchObject({ audience: expect.any(String), difficulty: "beginner", takeaways: expect.stringContaining("CTC is what") });
    expect(ctc.properties.lastReviewed).toBe("October 2026");
    expect(ctc.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(ctc.body.content.length).toBeGreaterThan(10);
  });
});

describe("parsePackage: security and edge cases", () => {
  it("rejects traversal paths and reports case/Unicode collisions", async () => {
    const pkg = await parsePackage(staged({ "../evil.md": "# x", "notes/Café.md": "# a", "notes/café.md": "# b", "notes/CAFÉ.md": "# c" }), OPTIONS);
    expect(pkg.issues.some((i) => i.code === "file.path_invalid")).toBe(true);
    expect(pkg.issues.filter((i) => i.code === "file.path_collision")).toHaveLength(2);
    expect(pkg.documents).toHaveLength(1);
  });

  it("blocks documents with malformed front matter instead of importing them as text", async () => {
    const pkg = await parsePackage(staged({ "a.md": "---\ntitle: [oops\n---\nbody" }), OPTIONS);
    const doc = pkg.documents[0]!;
    expect(doc.issues.some((i) => i.level === "error" && i.code === "frontmatter.malformed")).toBe(true);
    expect(doc.body.content).toEqual([]);
  });

  it("is independent of input order", async () => {
    const files = staged({ "t/01-a.md": "# A\n\n[b](02-b.md)", "t/02-b.md": "# B", "t/README.md": "# T" });
    const a = await parsePackage(files, OPTIONS);
    const b = await parsePackage([...files].reverse(), OPTIONS);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("derives titles from file names, stripping sequence numbers", async () => {
    const pkg = await parsePackage(staged({ "java/03-collections-framework.md": "Body only" }), OPTIONS);
    expect(pkg.documents[0]!.title).toEqual({ value: "Collections framework", from: "filename" });
  });

  it("treats a leading H1 as the title and does not repeat it", async () => {
    const pkg = await parsePackage(staged({ "x.md": "# Real Title\n\nText" }), OPTIONS);
    expect(pkg.documents[0]!.title).toEqual({ value: "Real Title", from: "heading" });
    expect(pkg.documents[0]!.body.content.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("records URL-encoded relative references and external images", async () => {
    const pkg = await parsePackage(staged({ "a/doc.md": "![p](../img/My%20Photo.png) ![r](https://elsewhere.example/x.png) [o](other%20page.md)" }, { "img/My Photo.png": 10 }), OPTIONS);
    const doc = pkg.documents[0]!;
    expect(doc.mediaRefs).toEqual([{ kind: "path", path: "img/My Photo.png" }, { kind: "external", url: "https://elsewhere.example/x.png" }]);
    expect(doc.refs).toEqual([{ kind: "path", path: "a/other page.md", fragment: null }]);
  });
});

describe("parsePackage: Notion export", () => {
  it("strips ids from titles, reads property lines, links sub-pages and notion.so URLs", async () => {
    const id1 = "0123456789abcdef0123456789abcdef";
    const id2 = "fedcba9876543210fedcba9876543210";
    const pkg = await parsePackage(
      staged(
        {
          [`Export/Java Course ${id1}.md`]: `# Java Course\n\nTags: java, backend\nCreated: January 5, 2024 3:04 PM\n\nIntro. See [OOP](Java%20Course%20${id1}/OOP%20${id2}.md) and https://www.notion.so/OOP-${id2}`,
          [`Export/Java Course ${id1}/OOP ${id2}.md`]: `# OOP\n\n![d](OOP%20${id2}/diagram.png)`,
        },
        { [`Export/Java Course ${id1}/OOP ${id2}/diagram.png`]: 5 },
      ),
      OPTIONS,
    );
    expect(pkg.sourceSystem).toBe("notion");
    const course = pkg.documents.find((d) => d.title.value === "Java Course")!;
    expect(course.pid).toBe(`notion:${id1}`);
    expect(course.tags.map((t) => t.value)).toEqual(["java", "backend"]);
    expect(course.createdAt).toBe("2024-01-05T15:04:00.000Z");
    expect(course.body.content[0]!.type).toBe("paragraph");
    const oop = pkg.documents.find((d) => d.title.value === "OOP")!;
    expect(oop.relations).toEqual([{ target: { kind: "path", path: `Java Course ${id1}.md`, fragment: null }, kind: "part_of", note: "", from: "folder" }]);
    expect(oop.mediaRefs).toEqual([{ kind: "path", path: `Java Course ${id1}/OOP ${id2}/diagram.png` }]);
  });
});

describe("parsePackage: Obsidian vault", () => {
  it("detects the vault, collects inline tags and aliases", async () => {
    const pkg = await parsePackage(staged({ "Vault/Inbox/Idea.md": "---\naliases: [Big idea]\n---\nThinking about #learning/java and [[OOP Basics]] ![[sketch.png]]", "Vault/OOP Basics.md": "# OOP" }, { "Vault/attachments/sketch.png": 3 }), { ...OPTIONS, obsidianVault: true });
    expect(pkg.sourceSystem).toBe("obsidian");
    const idea = pkg.documents.find((d) => d.sourcePath === "Inbox/Idea.md")!;
    expect(idea.aliases).toEqual(["Big idea"]);
    expect(idea.tags.map((t) => t.value)).toContain("learning/java");
    expect(idea.refs).toEqual([{ kind: "wiki", name: "OOP Basics", fragment: null }]);
    expect(idea.mediaRefs).toEqual([{ kind: "wiki", name: "sketch.png" }]);
  });
});

describe("portable manifest", () => {
  it("rejects unknown future versions with a clear message and validates structure", () => {
    const future = parseManifest({ format: "studio-portable", schemaVersion: 7 });
    expect(future).toMatchObject({ ok: false, version: 7 });
    if (!future.ok) expect(future.error).toMatch(/newer than this site understands/);
    expect(parseManifest({ format: "other", schemaVersion: 1 }).ok).toBe(false);
    const bad = parseManifest({ format: "studio-portable", schemaVersion: 1, exportedAt: "x", documents: [{ pid: "" }] });
    expect(bad.ok).toBe(false);
    const ok = parseManifest({ format: "studio-portable", schemaVersion: 1, exportedAt: "2026-10-04T00:00:00Z" });
    expect(ok.ok).toBe(true);
  });

  it("reports an invalid manifest without importing anything", async () => {
    const pkg = await parsePackage(staged({ "pkg/manifest.json": '{"format":"studio-portable","schemaVersion":99}' }), OPTIONS);
    expect(pkg.documents).toEqual([]);
    expect(pkg.issues[0]!.code).toBe("manifest.version");
  });
});

describe("unsupported content is reported, not dropped silently", () => {
  it("reports databases (CSV), unknown files and data: images", async () => {
    const pkg = await parsePackage(staged({ "db.csv": "a,b", "x.exe": "MZ", "doc.md": "![x](data:image/png;base64,AAAA)" }), OPTIONS);
    const codes = [...pkg.issues, ...pkg.documents.flatMap((d) => d.issues)].map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["file.unsupported", "media.unsupported"]));
    const doc: Doc = pkg.documents[0]!.body;
    expect(doc.content).toEqual([]);
  });
});
