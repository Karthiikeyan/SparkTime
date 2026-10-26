/**
 * Local-only design and scale fixtures: a realistic library (long articles,
 * images, projects, series, subtopics, relations) for visual QA.
 *
 *   npx tsx --conditions=react-server scripts/design-fixtures.ts            # add fixtures
 *   npx tsx --conditions=react-server scripts/design-fixtures.ts --scale 1000   # plus N lightweight pieces
 *   npx tsx --conditions=react-server scripts/design-fixtures.ts --remove   # delete every fixture
 *
 * Refuses any DATABASE_URL that is not loopback. Every fixture carries the
 * tag "design-fixture" and a private note, and none describes the owner.
 */
import sharp from "sharp";
import { loadEnvFiles } from "./load-env";

const TAG = "design-fixture";
const NOTE = "Local design fixture — generic sample text, not the owner's content. Remove with scripts/design-fixtures.ts --remove.";

type Node = Record<string, unknown>;
const t = (text: string, marks?: Node[]): Node => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...parts: Array<string | Node>): Node => ({ type: "paragraph", content: parts.map((x) => (typeof x === "string" ? t(x) : x)) });
const h = (level: number, text: string): Node => ({ type: "heading", attrs: { level }, content: [t(text)] });
const list = (items: string[], ordered = false): Node => ({ type: ordered ? "orderedList" : "bulletList", content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
const code = (language: string, text: string): Node => ({ type: "codeBlock", attrs: { language }, content: [t(text)] });
const callout = (variant: string, text: string): Node => ({ type: "callout", attrs: { variant }, content: [p(text)] });
const quote = (text: string): Node => ({ type: "blockquote", content: [p(text)] });
const table = (rows: string[][]): Node => ({
  type: "table",
  content: rows.map((row, r) => ({ type: "tableRow", content: row.map((cell) => ({ type: r === 0 ? "tableHeader" : "tableCell", content: [p(cell)] })) })),
});

const PARAGRAPHS = [
  "Most explanations of this topic start with the answer. It is more useful to start with the question that made the answer necessary, because the question is what you will meet again in a new codebase, a new team or an interview.",
  "The idea is simple to state and surprisingly easy to misapply. The details matter less than the shape of the trade-off: what you gain, what you pay for it, and how you notice when the price has changed.",
  "A small experiment makes this concrete. Change one variable, keep everything else fixed, and write down what you expected before you look at the result. The gap between the two is where the learning is.",
  "In practice the constraint is rarely technical. It is time, attention and the cost of changing your mind later. Good defaults reduce the number of decisions you have to make under pressure.",
  "There is a version of this that works in a tutorial and a version that survives production. The second one is less elegant, has more logging and assumes that something upstream will eventually behave badly.",
  "If you remember one thing, remember the boundary: what this approach is for, and the situation in which you should reach for something else.",
];
const para = (i: number) => p(PARAGRAPHS[i % PARAGRAPHS.length]!);

function articleBody(title: string, i: number, image?: { src: string; id: string; w: number; h: number }): Node {
  const content: Node[] = [
    p("This piece works through ", t(title.toLowerCase(), [{ type: "italic" }]), " step by step: the problem, the model that makes it tractable, a worked example and the mistakes worth avoiding."),
    para(i),
    h(2, "The problem"),
    para(i + 1),
    para(i + 2),
    callout(i % 2 ? "tip" : "note", "Sample callout: a practical aside the reader can skip without losing the thread."),
    h(2, "A working model"),
    para(i + 3),
    list(["Name the constraint before choosing the tool.", "Measure the thing you are optimising, not a proxy for it.", "Prefer reversible decisions while the picture is still forming."]),
  ];
  if (image) content.push({ type: "image", attrs: { src: image.src, mediaId: image.id, width: image.w, height: image.h, alt: "Abstract diagram used as a fixture illustration", caption: "Figure: a fixture illustration generated for layout testing.", size: i % 3 === 0 ? "wide" : "content" } });
  content.push(
    h(3, "A worked example"),
    para(i + 4),
    code(i % 2 ? "java" : "typescript", i % 2
      ? "public final class RateLimiter {\n  private final int capacity;\n  private int tokens;\n\n  public RateLimiter(int capacity) {\n    this.capacity = capacity;\n    this.tokens = capacity;\n  }\n\n  public synchronized boolean tryAcquire() {\n    if (tokens == 0) return false;\n    tokens--;\n    return true;\n  }\n}"
      : "export function debounce<T extends unknown[]>(fn: (...args: T) => void, wait = 200) {\n  let timer: ReturnType<typeof setTimeout> | undefined;\n  return (...args: T) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), wait);\n  };\n}"),
    para(i + 5),
    table([["Approach", "Good for", "Watch out for"], ["Simple default", "Most cases", "Hidden scaling limits"], ["Specialised tool", "Known bottlenecks", "Operational cost"], ["Do nothing", "Uncertain needs", "Deferred decisions piling up"]]),
    h(2, "Mistakes worth avoiding"),
    para(i + 1),
    quote("Make it work, make it right, make it fast — in that order, and only as far as you need to."),
    para(i + 2),
    h(2, "Where to go from here"),
    para(i + 3),
    para(i),
  );
  return { type: "doc", content };
}

const PALETTES = [
  ["#1f3a5f", "#e8d8c4", "#d9653b"],
  ["#2e4a3a", "#f1e9d8", "#c9a227"],
  ["#3b2f4a", "#efe6f0", "#e07a5f"],
  ["#1c2b2d", "#dfe9e6", "#3d9a8b"],
  ["#4a2c1f", "#f4e7d7", "#b4532a"],
  ["#22252b", "#e9e6df", "#8a8f99"],
];

/** Abstract, diagram-like compositions: blocks and connectors, not decoration. */
async function illustration(seed: number, width = 1600, height = 1000): Promise<Buffer> {
  const [bg, paper, accent] = PALETTES[seed % PALETTES.length]!;
  const boxes = Array.from({ length: 5 }, (_, k) => {
    const x = 140 + ((seed * 37 + k * 263) % (width - 480));
    const y = 120 + ((seed * 53 + k * 181) % (height - 360));
    const w = 180 + ((seed + k) % 3) * 70;
    return { x, y, w, h: 110 + ((seed + k) % 2) * 50, fill: k === (seed % 5) ? accent : paper };
  });
  const lines = boxes.slice(1).map((b, k) => `<path d="M${boxes[k]!.x + boxes[k]!.w / 2} ${boxes[k]!.y + boxes[k]!.h / 2} C ${b.x} ${boxes[k]!.y}, ${boxes[k]!.x} ${b.y}, ${b.x + b.w / 2} ${b.y + b.h / 2}" stroke="${paper}" stroke-opacity="0.45" stroke-width="3" fill="none"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${bg}"/>
    <g opacity="0.08" stroke="${paper}">${Array.from({ length: 24 }, (_, k) => `<line x1="${k * 70}" y1="0" x2="${k * 70}" y2="${height}"/>`).join("")}</g>
    ${lines.join("")}
    ${boxes.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="${b.fill}" fill-opacity="${b.fill === accent ? 1 : 0.9}"/><rect x="${b.x + 18}" y="${b.y + 22}" width="${b.w * 0.55}" height="10" rx="2" fill="${bg}" fill-opacity="0.35"/><rect x="${b.x + 18}" y="${b.y + 42}" width="${b.w * 0.35}" height="10" rx="2" fill="${bg}" fill-opacity="0.2"/>`).join("")}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const WRITING: Array<{ title: string; excerpt: string; topic: string; featured?: boolean; priority?: number; minutes?: number }> = [
  { title: "How the JVM decides what to keep", excerpt: "Generational garbage collection explained from the allocation up, with the three tuning mistakes that cause most production pauses.", topic: "java", featured: true, priority: 5 },
  { title: "Designing a rate limiter you can explain in an interview", excerpt: "Token buckets, sliding windows and the trade-offs between them — built up from a single counter.", topic: "system-design", featured: true, priority: 4 },
  { title: "Spring Boot configuration without the magic", excerpt: "What auto-configuration actually does at startup, and how to read the conditions report when it surprises you.", topic: "spring-boot", priority: 3 },
  { title: "A practical mental model for AWS networking", excerpt: "VPCs, subnets, route tables and security groups as one picture instead of five separate consoles.", topic: "aws", featured: true, priority: 2 },
  { title: "Why your React component renders twice", excerpt: "Strict mode, effects and the difference between rendering and committing — with the fix for each symptom.", topic: "web-development" },
  { title: "Reading a system design question slowly", excerpt: "A repeatable way to turn a vague prompt into requirements, constraints and a first diagram in ten minutes.", topic: "system-design", priority: 2 },
  { title: "TypeScript narrowing, from first principles", excerpt: "Discriminated unions, type guards and the control-flow analysis that makes them work.", topic: "web-development" },
  { title: "Consistent hashing without the hand-waving", excerpt: "Why the ring exists, what virtual nodes fix, and when a simpler scheme is enough.", topic: "system-design" },
  { title: "Transactions in Spring: the proxy you forgot about", excerpt: "Self-invocation, propagation and the reasons @Transactional silently does nothing.", topic: "spring-boot" },
  { title: "Using AI assistants without outsourcing your judgement", excerpt: "A working checklist for code review, learning and writing with language models.", topic: "ai", featured: true, priority: 1 },
  { title: "Prompting is interface design", excerpt: "Treating prompts as contracts: inputs, outputs, failure modes and tests.", topic: "ai" },
  { title: "Preparing for a backend interview in six weeks", excerpt: "A week-by-week plan covering fundamentals, one language deeply, and system design practice.", topic: "career", featured: true, priority: 3 },
  { title: "Negotiating your first offer", excerpt: "What is usually negotiable, how to ask, and the questions to ask before you accept.", topic: "career" },
  { title: "Learning in public without performing", excerpt: "Notes on sharing work in progress honestly, and what to keep private.", topic: "learning" },
  { title: "The spaced repetition routine that stuck", excerpt: "A small daily system for remembering technical material, and what to leave out of it.", topic: "learning" },
  { title: "Index funds, explained for engineers", excerpt: "Diversification, costs and why doing less usually beats doing more.", topic: "investing" },
  { title: "Building an emergency fund on a first salary", excerpt: "Sizing it, where to keep it, and when to stop adding to it.", topic: "personal-finance" },
  { title: "Scripting a technical video", excerpt: "From outline to on-screen code: structuring a ten-minute explainer so viewers keep up.", topic: "youtube" },
  { title: "Writing an essay that people finish", excerpt: "Openings, structure and cutting — practical editing for technical writers.", topic: "writing" },
  { title: "Giving a talk to a room of students", excerpt: "Preparation, pacing and handling questions when you are not sure of the answer.", topic: "public-speaking" },
  { title: "Validating a startup idea with ten conversations", excerpt: "Who to talk to, what to ask, and how to tell politeness from demand.", topic: "entrepreneurship" },
  { title: "Running your first 10K", excerpt: "A simple plan that respects easy days, and the mistakes that cause injuries.", topic: "life" },
  { title: "Observability for small teams", excerpt: "Logs, metrics and traces — what to set up first when you have one afternoon.", topic: "software-engineering" },
  { title: "Code review as teaching", excerpt: "Comments that explain intent, questions instead of instructions, and when to pair instead.", topic: "software-engineering" },
  { title: "Database indexes you can reason about", excerpt: "B-trees, selectivity and reading a query plan without guessing.", topic: "software-engineering", priority: 1 },
  { title: "Caching strategies and their failure modes", excerpt: "Cache-aside, write-through and the stampede that takes the database down.", topic: "system-design" },
  { title: "Concurrency in Java: start with the executor", excerpt: "Thread pools, futures and virtual threads — what to use for which job.", topic: "java" },
  { title: "Deploying a Spring Boot service to AWS", excerpt: "Containers, a load balancer and health checks: the smallest production setup that is honest.", topic: "aws" },
];

const DSA_DAYS = ["Arrays and two pointers", "Sliding window", "Prefix sums", "Hashing patterns", "Stacks and monotonic stacks", "Binary search on answers", "Linked lists", "Recursion and backtracking", "Trees and traversals", "Binary search trees", "Heaps and top-k", "Graphs: BFS and DFS"];

async function main() {
  loadEnvFiles();
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) throw new Error("design-fixtures only runs against a loopback database.");
  const { getDb } = await import("../src/server/db/client");
  const schema = await import("../src/server/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const docs = await import("../src/server/services/documents");
  const taxonomy = await import("../src/server/services/taxonomy");
  const { uploadMedia } = await import("../src/server/services/media");
  const { refreshSearchExtra } = await import("../src/server/services/search-index");
  const { listContentTypes } = await import("../src/server/services/content-types");
  const db = getDb();

  const [tag] = await db.select().from(schema.tags).where(eq(schema.tags.slug, TAG));
  if (process.argv.includes("--remove")) {
    if (tag) {
      const ids = (await db.select({ id: schema.documentTags.documentId }).from(schema.documentTags).where(eq(schema.documentTags.tagId, tag.id))).map((r) => r.id);
      if (ids.length) await db.delete(schema.documents).where(inArray(schema.documents.id, ids));
      await db.delete(schema.tags).where(eq(schema.tags.id, tag.id));
      console.log(`Removed ${ids.length} fixture documents.`);
    }
    await db.delete(schema.categories).where(eq(schema.categories.description, "Fixture subtopic."));
    process.exit(0);
  }
  if (tag) throw new Error("Fixtures already exist. Run with --remove first.");

  let [user] = await db.select().from(schema.users).limit(1);
  if (!user) [user] = await db.insert(schema.users).values({ githubId: 1, githubLogin: "fixture-owner" }).returning();
  const actor = { kind: "admin" as const, userId: user!.id, login: user!.githubLogin };

  const types = await db.select().from(schema.contentTypes);
  const typeId = (slug: string) => types.find((x) => x.slug === slug)!.id;
  const cats = await db.select().from(schema.categories);
  const catId = new Map(cats.map((c) => [c.slug, c.id]));
  for (const [slug, name, parent] of [["java", "Java", "software-engineering"], ["spring-boot", "Spring Boot", "software-engineering"], ["aws", "AWS", "software-engineering"], ["system-design", "System Design", "software-engineering"]] as const) {
    if (catId.has(slug)) continue;
    const created = await taxonomy.createCategory(actor, { name, slug, parentId: catId.get(parent) ?? null, description: "Fixture subtopic." });
    catId.set(slug, created.id);
  }

  const images: Array<{ id: string; src: string; w: number; h: number }> = [];
  for (let k = 0; k < 14; k++) {
    const asset = await uploadMedia(actor, { bytes: await illustration(k), declaredType: "image/png", filename: `fixture-${k}.png`, alt: "Abstract fixture diagram" });
    images.push({ id: asset.id, src: asset.url, w: asset.width ?? 1600, h: asset.height ?? 1000 });
  }

  const created: string[] = [];
  const publish = async (typeSlug: string, title: string, excerpt: string, body: Node, opts: { topics?: string[]; image?: number; featured?: boolean; priority?: number; properties?: Record<string, unknown>; publishedAt?: Date } = {}) => {
    const { id } = await docs.createDocument(actor, { typeId: typeId(typeSlug), title });
    await docs.saveDocument(actor, id, {
      body: { excerpt, content: body, featuredMediaId: opts.image !== undefined ? images[opts.image % images.length]!.id : null, properties: opts.properties ?? {} },
      settings: { featured: Boolean(opts.featured), priority: opts.priority ?? 0, notes: NOTE },
    });
    const topicIds = (opts.topics ?? []).map((s) => catId.get(s)).filter((x): x is string => Boolean(x));
    await docs.setDocumentTaxonomy(actor, id, { categoryIds: topicIds, primaryCategoryId: topicIds[0] ?? null, tagNames: [TAG] });
    await docs.runDocumentAction(actor, id, { action: "publish" });
    if (opts.publishedAt) await db.update(schema.documents).set({ publishedAt: opts.publishedAt }).where(eq(schema.documents.id, id));
    created.push(id);
    return id;
  };

  const day = 86_400_000;
  const writing: Record<string, string> = {};
  for (const [i, w] of WRITING.entries()) {
    const hasImage = i % 3 !== 2;
    writing[w.title] = await publish("article", w.title, w.excerpt, articleBody(w.title, i, hasImage ? images[(i + 3) % images.length] : undefined), {
      topics: [w.topic], image: hasImage ? i : undefined, featured: w.featured, priority: w.priority, publishedAt: new Date(Date.now() - (i * 9 + 3) * day),
    });
  }

  const projects = [
    { title: "Interview Prep Tracker", excerpt: "A small web app that turns a study plan into daily, trackable practice — built to test spaced repetition for DSA.", status: "live", stack: ["TypeScript", "Next.js", "PostgreSQL"] },
    { title: "Rate Limiter Playground", excerpt: "An interactive visualisation of four rate-limiting algorithms under the same traffic pattern.", status: "building", stack: ["React", "TypeScript"] },
    { title: "Spring Boot Starter Kit", excerpt: "An opinionated service template with health checks, structured logging and a production Dockerfile.", status: "live", stack: ["Java", "Spring Boot", "Docker"] },
    { title: "Reading Log", excerpt: "A private, searchable record of books and notes, exported to Markdown.", status: "archived", stack: ["Python", "SQLite"] },
  ];
  const projectIds: string[] = [];
  const projectType = (await listContentTypes()).find((x) => x.slug === "project")!;
  const statusField = projectType.fields.find((f) => f.role === "projectStatus");
  const choices = statusField?.options?.choices?.map((c) => c.value) ?? [];
  for (const [i, pr] of projects.entries()) {
    const status = choices.includes(pr.status) ? pr.status : choices[i % Math.max(choices.length, 1)];
    projectIds.push(await publish("project", pr.title, pr.excerpt, articleBody(pr.title, i + 2, images[(i + 6) % images.length]), {
      topics: i % 2 ? ["web-development"] : ["software-engineering"], image: i + 8, featured: i < 2, priority: 4 - i,
      properties: { ...(statusField && status ? { [statusField.key]: status } : {}), techStack: pr.stack },
    }));
  }

  const dsaIds: string[] = [];
  for (const [i, topic] of DSA_DAYS.entries()) {
    dsaIds.push(await publish("article", `Day ${i + 1}: ${topic}`, `Part ${i + 1} of the DSA series: ${topic.toLowerCase()} — the pattern, three problems and the mistakes to avoid.`, articleBody(topic, i), { topics: ["system-design"], publishedAt: new Date(Date.now() - (200 - i) * day) }));
  }
  const series = await publish("collection", "50 Days of DSA", "A day-by-day path through data structures and algorithms: one pattern a day, three problems each, in the order that builds on itself.", { type: "doc", content: [para(0), para(3)] }, { topics: ["career"], image: 4, featured: true, priority: 6 });
  await docs.setCollectionItems(actor, series, { items: dsaIds.map((documentId) => ({ documentId })) });
  const designPath = await publish("collection", "System design, from zero", "A reading path from requests and caches to sharding and consistency.", { type: "doc", content: [para(1)] }, { topics: ["system-design"], image: 5, priority: 3 });
  await docs.setCollectionItems(actor, designPath, { items: ["Reading a system design question slowly", "Caching strategies and their failure modes", "Consistent hashing without the hand-waving", "Designing a rate limiter you can explain in an interview"].map((title) => ({ documentId: writing[title]! })) });
  const springPath = await publish("collection", "Spring Boot in production", "Configuration, transactions and deployment — the parts tutorials skip.", { type: "doc", content: [para(2)] }, { topics: ["spring-boot"], image: 7, priority: 2 });
  await docs.setCollectionItems(actor, springPath, { items: ["Spring Boot configuration without the magic", "Transactions in Spring: the proxy you forgot about", "Deploying a Spring Boot service to AWS"].map((title) => ({ documentId: writing[title]! })) });

  await docs.setDocumentRelations(actor, projectIds[1]!, { relations: [{ targetId: writing["Designing a rate limiter you can explain in an interview"]!, kind: "expands_on" }] });
  await docs.setDocumentRelations(actor, projectIds[2]!, { relations: [{ targetId: writing["Spring Boot configuration without the magic"]!, kind: "related" }, { targetId: writing["Deploying a Spring Boot service to AWS"]!, kind: "related" }] });
  await docs.setDocumentRelations(actor, projectIds[0]!, { relations: [{ targetId: writing["Preparing for a backend interview in six weeks"]!, kind: "related" }, { targetId: series, kind: "related" }] });

  const scale = Number(process.argv[process.argv.indexOf("--scale") + 1] ?? 0);
  if (process.argv.includes("--scale") && scale > 0) {
    const topicSlugs = [...catId.keys()];
    const rows = Array.from({ length: scale }, (_, k) => ({
      typeId: typeId("article"), title: `Archive specimen ${k + 1}: ${WRITING[k % WRITING.length]!.title}`, slug: `archive-specimen-${k + 1}`,
      status: "published" as const, visibility: "public" as const, publishedAt: new Date(Date.now() - (k + 400) * day),
      excerpt: WRITING[k % WRITING.length]!.excerpt, plainText: PARAGRAPHS.join(" "), wordCount: 900, readingMinutes: 5, notes: NOTE,
      content: { type: "doc", content: [para(k)] },
    }));
    for (let k = 0; k < rows.length; k += 250) {
      const inserted = await db.insert(schema.documents).values(rows.slice(k, k + 250)).returning({ id: schema.documents.id });
      const ids = inserted.map((r) => r.id);
      const [fixtureTag] = await db.select().from(schema.tags).where(eq(schema.tags.slug, TAG));
      await db.insert(schema.documentTags).values(ids.map((documentId) => ({ documentId, tagId: fixtureTag!.id })));
      await db.insert(schema.documentCategories).values(ids.map((documentId, n) => ({ documentId, categoryId: catId.get(topicSlugs[(k + n) % topicSlugs.length]!)!, isPrimary: true })));
      await refreshSearchExtra(db, ids);
    }
  }
  console.log(`Created ${created.length} fixture documents${scale ? ` plus ${scale} scale specimens` : ""}.`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Fixtures failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
