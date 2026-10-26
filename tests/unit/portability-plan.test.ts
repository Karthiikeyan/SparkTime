import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@/lib/content/model";
import { parsePackage, type StagedFile } from "@/lib/portability/parse";
import { planImport, planIsApprovable } from "@/lib/portability/plan";
import type { DestinationSnapshot, ImportDecisions } from "@/lib/portability/plan-types";
import { sniffType } from "@/server/media/validation";

const OPTIONS = { siteOrigin: "https://karthikeyan.example", mediaOrigin: "https://media.example" };
const PLAN_OPTIONS = { maxUploadBytes: 4 * 1024 * 1024, sniffMedia: sniffType };

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]).toString("base64");

const field = (key: string, type: FieldDefinition["type"], extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  key, label: key, type, role: null, required: false, helpText: "", options: {}, showInFacts: true, position: 0, ...extra,
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function snapshot(overrides: Partial<DestinationSnapshot> = {}): DestinationSnapshot {
  return {
    types: [
      { id: ID(1), slug: "article", name: "Article", pluralName: "Articles", template: "editorial", routing: "type", fields: [field("audience", "text"), field("difficulty", "select", { options: { choices: [{ value: "beginner", label: "Beginner" }, { value: "advanced", label: "Advanced" }] } }), field("takeaways", "long_text"), field("related", "relation", { options: { multiple: true } })] },
      { id: ID(2), slug: "note", name: "Note", pluralName: "Notes", template: "minimal", routing: "type", fields: [] },
      { id: ID(3), slug: "course", name: "Course", pluralName: "Courses", template: "collection", routing: "type", fields: [] },
      { id: ID(4), slug: "page", name: "Page", pluralName: "Pages", template: "minimal", routing: "root", fields: [] },
    ],
    categories: [
      { id: ID(10), name: "Career", slug: "career", parentId: null },
      { id: ID(11), name: "Technology", slug: "technology", parentId: null },
      { id: ID(12), name: "Software Engineering", slug: "software-engineering", parentId: ID(11) },
    ],
    tags: [{ id: ID(20), name: "Salary", slug: "salary" }],
    documents: [{ id: ID(30), typeId: ID(1), slug: "existing-post", title: "Existing Post", status: "published", visibility: "public", canonicalUrl: null, path: "/article/existing-post" }],
    identities: [],
    media: [],
    collectionItems: [],
    rootSlugs: ["article", "note", "course", "page"],
    redirectPaths: [],
    fingerprint: "f1",
    ...overrides,
  };
}

function staged(files: Record<string, string>, media: Record<string, { size?: number; sha?: string; head?: string }> = {}): StagedFile[] {
  return [
    ...Object.entries(files).map(([path, text]) => ({ path, size: text.length, text, sha256: null, head: null })),
    ...Object.entries(media).map(([path, m]) => ({ path, size: m.size ?? 100, text: null, sha256: m.sha ?? "b".repeat(64), head: m.head ?? PNG_HEAD })),
  ];
}

async function plan(files: StagedFile[], decisions: ImportDecisions = {}, snap = snapshot(), parse = {}) {
  const pkg = await parsePackage(files, { ...OPTIONS, ...parse });
  return planImport(pkg, snap, decisions, PLAN_OPTIONS);
}

describe("defaults and type inference", () => {
  it("imports new documents as drafts (public once published), even when the source says published", async () => {
    const p = await plan(staged({ "a.md": "---\ntitle: A\ndraft: false\nstatus: published\n---\nBody" }));
    const doc = p.documents[0]!;
    expect(doc).toMatchObject({ action: "create", status: "draft", visibility: "public", statusFrom: "default" });
    expect(doc.issues.some((i) => i.code === "status.not_applied")).toBe(true);
  });

  it("honours an explicit status policy and per-document decisions", async () => {
    const files = staged({ "a.md": "# A", "b.md": "# B" });
    const p = await plan(files, { status: { mode: "set", status: "published", visibility: "unlisted" }, documents: { "b.md": { status: "draft", visibility: "private" } } });
    expect(p.documents.find((d) => d.key === "a.md")).toMatchObject({ status: "published", visibility: "unlisted", statusFrom: "decision" });
    expect(p.documents.find((d) => d.key === "b.md")).toMatchObject({ status: "draft", visibility: "private" });
  });

  it("infers type: decision > front matter > folder README > default; unknown types need a decision", async () => {
    const p = await plan(
      staged({
        "x/a.md": "---\ntype: Note\n---\nA",
        "x/b.md": "B",
        "y/README.md": "---\ntype: note\n---\n# Y",
        "y/c.md": "C",
        "z/d.md": "---\ntype: podcast\n---\nD",
      }),
      { documents: { "x/b.md": { type: "note" } } },
    );
    const t = (k: string) => p.documents.find((d) => d.key === k)!;
    expect(t("x/a.md")).toMatchObject({ typeSlug: "note", typeFrom: "frontmatter" });
    expect(t("x/b.md")).toMatchObject({ typeSlug: "note", typeFrom: "decision" });
    expect(t("y/c.md")).toMatchObject({ typeSlug: "note", typeFrom: "readme" });
    expect(t("z/d.md")).toMatchObject({ typeSlug: "article", typeFrom: "default" });
    expect(p.decisionsRequired.some((d) => d.kind === "type" && d.key === "z/d.md")).toBe(true);
    const aliased = await plan(staged({ "z/d.md": "---\ntype: podcast\n---\nD" }), { typeAliases: { podcast: "note" } });
    expect(aliased.documents[0]).toMatchObject({ typeSlug: "note", typeFrom: "alias" });
    expect(aliased.decisionsRequired).toEqual([]);
  });
});

describe("topics and tags", () => {
  it("reuses existing topics by slug or name, creates missing ones, nests sub-folders", async () => {
    const p = await plan(staged({ "career/a.md": "A", "Personal Finance/b.md": "B", "Personal Finance/Tax/c.md": "C" }));
    const career = p.topics.find((t) => t.key === "folder:career")!;
    expect(career).toMatchObject({ action: "reuse", existingId: ID(10), documentCount: 1 });
    const pf = p.topics.find((t) => t.key === "folder:Personal Finance")!;
    expect(pf).toMatchObject({ action: "create", create: { name: "Personal Finance", slug: "personal-finance", parentKey: null } });
    const tax = p.topics.find((t) => t.key === "folder:Personal Finance/Tax")!;
    expect(tax.create).toMatchObject({ slug: "tax", parentKey: "folder:Personal Finance" });
    expect(p.documents.find((d) => d.key === "Personal Finance/Tax/c.md")!.topicKeys).toEqual(["folder:Personal Finance/Tax"]);
  });

  it("lets explicit front matter topics win over the folder", async () => {
    const p = await plan(staged({ "career/a.md": "---\ncategories: [technology, software-engineering]\n---\nA" }));
    const doc = p.documents[0]!;
    expect(doc.topicKeys).toEqual(["name:technology", "name:software-engineering"]);
    expect(p.topics.find((t) => t.key === "name:software-engineering")).toMatchObject({ action: "reuse", existingId: ID(12) });
    expect(p.topics.some((t) => t.key === "folder:career")).toBe(false);
  });

  it("asks when a topic is ambiguous, or would collide with the URL namespace", async () => {
    const snap = snapshot({ categories: [...snapshot().categories, { id: ID(13), name: "Careers", slug: "careers-old", parentId: null }, { id: ID(14), name: "careers", slug: "careers", parentId: null }] });
    const p = await plan(staged({ "a.md": "---\ncategories: [Careers]\n---\nA", "b.md": "---\ncategories: [article]\n---\nB" }), {}, snap);
    expect(p.topics.find((t) => t.key === "name:careers")!.action).toBe("ambiguous");
    expect(p.topics.find((t) => t.key === "name:article")!.action).toBe("ambiguous");
    expect(p.decisionsRequired.filter((d) => d.kind === "topic")).toHaveLength(2);
    expect(planIsApprovable(p).ok).toBe(false);
    const decided = await plan(staged({ "a.md": "---\ncategories: [Careers]\n---\nA" }), { topics: { "name:careers": { mode: "existing", id: ID(14) } } }, snap);
    expect(decided.topics[0]).toMatchObject({ action: "reuse", existingId: ID(14) });
    expect(planIsApprovable(decided).ok).toBe(true);
  });

  it("deduplicates tags by slug, reuses existing ones and reports unrepresentable tags", async () => {
    const p = await plan(staged({ "a.md": "---\ntags: [CTC, salary, 'Job Offer']\n---\nA", "b.md": "---\ntags: [ctc, தமிழ்]\n---\nB" }));
    expect(p.tags.map((t) => t.key)).toEqual(["ctc", "job-offer", "salary"]);
    expect(p.tags.find((t) => t.key === "salary")).toMatchObject({ action: "reuse", existingId: ID(20) });
    expect(p.tags.find((t) => t.key === "ctc")).toMatchObject({ action: "create", name: "CTC", variants: ["CTC", "ctc"], documentCount: 2 });
    const b = p.documents.find((d) => d.key === "b.md")!;
    expect(b.issues.some((i) => i.code === "tag.unrepresentable")).toBe(true);
    expect(b.unmapped.tags).toEqual(["தமிழ்"]);
  });
});

describe("collections and ordering", () => {
  it("detects a numbered folder as a course with README metadata and deterministic order", async () => {
    const files = staged({
      "articles.md": "# Sibling, so career/ is not a wrapper folder",
      "career/java/README.md": "---\ntitle: Java from scratch\ndescription: Learn Java step by step.\n---\n# Java from scratch\n\nIntro text.",
      "career/java/10-streams.md": "# Streams",
      "career/java/02-oop.md": "# OOP\n\nSee [basics](01-java-basics.md).",
      "career/java/01-java-basics.md": "# Basics",
    });
    const p = await plan(files);
    expect(p.folders.find((f) => f.path === "career/java")).toMatchObject({ role: "collection", roleFrom: "inferred" });
    const course = p.documents.find((d) => d.key === "collection:career/java")!;
    // No explicit slug: generated from the title, like any document.
    expect(course).toMatchObject({ synthetic: true, title: "Java from scratch", typeSlug: "course", slug: "java-from-scratch", excerpt: "Learn Java step by step.", topicKeys: ["folder:career"] });
    const collection = p.collections[0]!;
    expect(collection.items.map((i) => i.documentKey)).toEqual(["career/java/01-java-basics.md", "career/java/02-oop.md", "career/java/10-streams.md"]);
    expect(collection.orderSource).toBe("prefix");
    const again = await plan([...files].reverse());
    expect(again.hash).toBe(p.hash);
  });

  it("uses groups for numbered module folders and lets decisions reorder", async () => {
    const files = staged({ "course/01-intro/01-a.md": "A", "course/01-intro/02-b.md": "B", "course/02-deep/01-c.md": "C" });
    // Everything is inside course/: keep it as a real folder rather than a wrapper.
    const p = await plan(files, { keepRootFolder: true }, snapshot(), { keepRootFolder: true });
    const c = p.collections[0]!;
    expect(c.items.map((i) => [i.documentKey, i.groupLabel])).toEqual([
      ["course/01-intro/01-a.md", "Intro"],
      ["course/01-intro/02-b.md", "Intro"],
      ["course/02-deep/01-c.md", "Deep"],
    ]);
    const reordered = await plan(files, { keepRootFolder: true, documents: { "course/01-intro/02-b.md": { order: 0 } } }, snapshot(), { keepRootFolder: true });
    expect(reordered.collections[0]!.items[0]!.documentKey).toBe("course/01-intro/02-b.md");
  });

  it("merges into an existing collection only on update, never removing members", async () => {
    const snap = snapshot({
      documents: [...snapshot().documents, { id: ID(31), typeId: ID(3), slug: "java", title: "Java", status: "draft", visibility: "private", canonicalUrl: null, path: "/course/java" }],
      collectionItems: [{ collectionId: ID(31), documentId: ID(30), position: 0 }],
    });
    const files = staged({ "java/01-a.md": "A", "java/02-b.md": "B", "other.md": "x" });
    const skipped = await plan(files, { documents: { "collection:java": { action: "skip" } } }, snap);
    expect(skipped.collections[0]).toMatchObject({ action: "skip", existingId: ID(31), existingMemberCount: 1 });
    const merged = await plan(files, { documents: { "collection:java": { action: "update" } } }, snap);
    expect(merged.collections[0]).toMatchObject({ action: "merge", existingId: ID(31) });
    expect(merged.summary.collectionsModify).toBe(1);
  });
});

describe("duplicates, conflicts and slugs", () => {
  const files = staged({ "existing-post.md": "---\ntitle: Existing Post v2\nslug: existing-post\nexcerpt: New excerpt\n---\nNew body" });

  it("requires a decision for a slug match and defaults to skipping", async () => {
    const p = await plan(files);
    const doc = p.documents[0]!;
    expect(doc.conflict).toMatchObject({ reason: "slug", existing: { id: ID(30) } });
    expect(doc.action).toBe("skip");
    expect(p.decisionsRequired).toEqual([expect.objectContaining({ kind: "duplicate", key: "existing-post.md" })]);
  });

  it("update keeps the existing slug, status and visibility; only selected fields change", async () => {
    const p = await plan(files, { documents: { "existing-post.md": { action: "update", updateFields: ["excerpt"], clearFields: ["seo"] } } });
    const doc = p.documents[0]!;
    expect(doc).toMatchObject({ action: "update", slug: "existing-post", slugFrom: "existing", updateFields: ["excerpt"], clearFields: ["seo"], status: "published", visibility: "public", statusFrom: "existing" });
    expect(p.decisionsRequired).toEqual([]);
  });

  it("copy creates a new draft with a unique slug", async () => {
    const p = await plan(files, { duplicateAction: "copy" });
    expect(p.documents[0]).toMatchObject({ action: "copy", slug: "existing-post-copy", status: "draft", visibility: "public" });
  });

  it("matches by identity from an earlier import before slugs", async () => {
    const snap = snapshot({ identities: [{ portableId: "notes-1", entity: "document", entityId: ID(30) }] });
    const p = await plan(staged({ "renamed.md": "---\nid: notes-1\n---\nX" }), {}, snap);
    expect(p.documents[0]!.conflict?.reason).toBe("identity");
  });

  it("resolves slug collisions inside the import with a suffix", async () => {
    const p = await plan(staged({ "a/intro.md": "# Intro", "b/intro.md": "# Intro" }));
    expect(p.documents.map((d) => d.slug).sort()).toEqual(["intro", "intro-2"]);
    expect(p.summary.slugCollisions).toBe(1);
  });

  it("keeps root pages out of reserved and taken namespace slugs", async () => {
    const p = await plan(staged({ "admin.md": "---\ntype: page\n---\nX", "career.md": "---\ntype: page\n---\nY" }));
    expect(p.documents.find((d) => d.key === "admin.md")!.slug).toBe("admin-2");
    expect(p.documents.find((d) => d.key === "career.md")!.slug).toBe("career-2");
  });
});

describe("references and relationships", () => {
  it("resolves links between imported files as inferred relations and front matter as explicit ones", async () => {
    const p = await plan(
      staged({
        "a.md": "---\nrelated: [b]\n---\nRead [B](b.md), [ext](https://example.com), [site](/article/existing-post) and [gone](missing.md). [Self](a.md)",
        "b.md": "# B",
      }),
    );
    const a = p.documents.find((d) => d.key === "a.md")!;
    expect(a.refs.map((r) => r.resolution.status)).toEqual(["incoming", "existing", "unresolved", "incoming"]);
    const rels = p.relations.filter((r) => r.sourceKey === "a.md");
    expect(rels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: "manual", kind: "related", evidence: "frontmatter", target: { status: "incoming", key: "b.md" } }),
        expect.objectContaining({ origin: "content", evidence: "link", target: { status: "incoming", key: "b.md" } }),
        expect.objectContaining({ origin: "content", target: expect.objectContaining({ status: "existing", id: ID(30) }) }),
      ]),
    );
    expect(rels.some((r) => r.target.status === "incoming" && r.target.key === "a.md")).toBe(false);
    expect(a.issues.some((i) => i.code === "relation.self")).toBe(true);
    expect(a.issues.some((i) => i.code === "reference.unresolved")).toBe(true);
  });

  it("flags ambiguous wikilinks instead of guessing", async () => {
    const p = await plan(staged({ "one/Note.md": "x", "two/Note.md": "y", "three/Link.md": "[[Note]]" }), {}, snapshot(), { obsidianVault: true });
    const link = p.documents.find((d) => d.key === "three/Link.md")!;
    expect(link.refs[0]!.resolution.status).toBe("ambiguous");
    expect(link.issues.some((i) => i.code === "reference.ambiguous")).toBe(true);
  });

  it("points references to skipped duplicates at the existing document", async () => {
    const p = await plan(staged({ "existing-post.md": "x", "b.md": "[old](existing-post.md)" }));
    const b = p.documents.find((d) => d.key === "b.md")!;
    expect(b.refs[0]!.resolution).toEqual({ status: "existing", id: ID(30), path: "/article/existing-post" });
  });
});

describe("properties", () => {
  it("maps front matter to type fields, normalises select values, preserves the rest", async () => {
    const p = await plan(staged({ "a.md": "---\naudience: Freshers\ndifficulty: Beginner\ntakeaways: |\n  One\n  Two\nlastReviewed: October 2026\nrelated-posts: x\n---\nA" }));
    const doc = p.documents[0]!;
    expect(doc.properties).toEqual({ audience: { kind: "value", value: "Freshers" }, difficulty: { kind: "value", value: "beginner" }, takeaways: { kind: "value", value: "One\nTwo" } });
    expect(doc.unmapped).toMatchObject({ lastReviewed: "October 2026" });
  });

  it("keeps invalid values as source metadata with a warning", async () => {
    const p = await plan(staged({ "a.md": "---\ndifficulty: impossible\n---\nA" }));
    const doc = p.documents[0]!;
    expect(doc.properties.difficulty).toBeUndefined();
    expect(doc.unmapped.difficulty).toBe("impossible");
    expect(doc.issues.some((i) => i.code === "property.invalid")).toBe(true);
  });
});

describe("media", () => {
  it("plans uploads, reuses known checksums, and reports missing, external and unsupported media", async () => {
    const sha = "c".repeat(64);
    const snap = snapshot({ identities: [{ portableId: `sha256:${sha}`, entity: "media", entityId: ID(40) }], media: [{ id: ID(40), url: "https://media.example/media/2026/01/x.webp" }] });
    const p = await plan(
      staged(
        { "a.md": "![one](img/one.png) ![two](img/two.png) ![miss](img/miss.png) ![ext](https://cdn.example/x.png) ![fake](img/fake.png)" },
        { "img/one.png": {}, "img/two.png": { sha }, "img/fake.png": { head: Buffer.from("not an image at all").toString("base64") } },
      ),
      {},
      snap,
    );
    const action = (key: string) => p.media.find((m) => m.key === key)?.action;
    expect(action("file:img/one.png")).toBe("upload");
    expect(action("file:img/two.png")).toBe("reuse");
    expect(action("missing:img/miss.png")).toBe("missing");
    expect(action("external:https://cdn.example/x.png")).toBe("external");
    expect(action("file:img/fake.png")).toBe("unsupported");
    expect(p.summary).toMatchObject({ mediaUpload: 1, mediaReuse: 1, mediaMissing: 3 });
  });

  it("finds Obsidian attachments by name anywhere in the vault", async () => {
    const p = await plan(staged({ "notes/a.md": "![[pic.png]]" }, { "attachments/pic.png": {} }), {}, snapshot(), { obsidianVault: true });
    expect(p.media[0]).toMatchObject({ key: "file:attachments/pic.png", action: "upload", usedBy: ["notes/a.md"] });
  });
});

describe("dry-run determinism", () => {
  it("produces the same plan and hash for the same input and destination", async () => {
    const files = staged({ "career/a.md": "---\ntags: [x]\n---\n[b](b.md)", "career/b.md": "B" });
    const a = await plan(files);
    const b = await plan([...files].reverse());
    expect(b.hash).toBe(a.hash);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const changed = await plan(files, {}, snapshot({ fingerprint: "f2" }));
    expect(changed.hash).not.toBe(a.hash);
  });
});
