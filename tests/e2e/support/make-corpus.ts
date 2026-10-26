/**
 * Deterministic test corpus for the import/export integration run:
 *   npx tsx tests/e2e/support/make-corpus.ts <outDir>
 * Writes <outDir>/site/ (a folder) and <outDir>/site.zip (the same files).
 * A deliberately small default (~30 documents, 3 courses, 3 images): nested folders,
 * links, tags, Tamil content, intra-import slug collisions. Nothing real.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { concatChunks, createZip } from "../../../src/lib/portability/zip";
import { nodeDeflateRaw } from "../../../src/server/portability/zip-node";

export type CorpusFile = { path: string; data: Buffer };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const WORDS = "budget salary interview resume negotiation notice offer payslip tax savings insurance index fund loan credit score api debug logging testing review habit garden seed soil route train budget packing visa lesson module class object stream thread query join index table".split(" ");
const TAMIL = "இது ஒரு சோதனை ஆவணம். தமிழ் எழுத்துகள் சரியாகச் சேமிக்கப்பட வேண்டும். வணக்கம் உலகம்!";

export async function buildCorpus(options: { articles?: number; images?: number; lessons?: [number, number, number] } = {}): Promise<CorpusFile[]> {
  const rand = rng(20261004);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!;
  const files: CorpusFile[] = [];
  const add = (path: string, text: string) => files.push({ path: `site/${path}`, data: Buffer.from(text, "utf8") });
  const paragraph = () => Array.from({ length: 40 }, () => pick(WORDS)).join(" ") + ".";
  const body = (links: string[] = [], image?: string) =>
    [paragraph(), "", `## ${pick(WORDS)} ${pick(WORDS)}`, "", paragraph(), "", "- " + pick(WORDS), "- " + pick(WORDS), "", ...(links.length ? [`See ${links.map((l) => `[${l}](${l})`).join(" and ")}.`, ""] : []), ...(image ? [`![figure](${image})`, ""] : []), "> [!NOTE]", "> " + paragraph(), "", "```js", "console.log('hello');", "```", "", "| a | b |", "|---|---|", "| 1 | 2 |", ""].join("\n");
  const imageCount = options.images ?? 3;
  for (let i = 0; i < imageCount; i++) {
    const data = await sharp({ create: { width: 48 + (i % 7), height: 32, channels: 3, background: { r: (i * 37) % 256, g: (i * 91) % 256, b: (i * 53) % 256 } } }).png().toBuffer();
    files.push({ path: `site/assets/fig-${String(i).padStart(3, "0")}.png`, data });
  }

  // Topic folders (existing topics: career, money, technology; new: gardening, travel-notes), with nesting.
  const topics: Array<[string, string[]]> = [
    ["career", ["", "interviews", "negotiation"]],
    ["money", ["", "tax", "investing"]],
    ["technology", ["", "web", "databases"]],
    ["gardening", ["", "roses"]],
    ["travel-notes", [""]],
  ];
  const total = options.articles ?? 18;
  const tags = ["Salary", "salary", "CTC", "Tax Saving", "tax-saving", "SIP", "debugging", "API", "Roses", "Soil", "visa", "packing", "Index Funds", "interview", "resume", "Java", "SQL", "மொழி", "notes", "Beginners"];
  let n = 0;
  const written: string[] = [];
  for (let i = 0; i < total; i++) {
    const [topic, subs] = topics[i % topics.length]!;
    const sub = subs[Math.floor(i / topics.length) % subs.length]!;
    const dir = [topic, sub].filter(Boolean).join("/");
    // Every 19th file reuses an earlier name in another folder → intra-import slug collision.
    const name = i % 9 === 8 ? "common-guide" : `${pick(WORDS)}-${pick(WORDS)}-${i}`;
    const path = `${dir}/${name}.md`;
    if (written.includes(path)) continue;
    written.push(path);
    const fm = [
      "---",
      `title: "${name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())}"`,
      i % 4 === 0 ? `excerpt: "A short summary for article ${i}."` : null,
      `tags: [${[pick(tags), pick(tags), pick(tags)].join(", ")}]`,
      i % 5 === 0 ? "status: published" : null,
      i % 7 === 0 ? "draft: false" : null,
      i % 6 === 0 ? `date: 2025-0${1 + (i % 9)}-1${i % 9}` : null,
      i % 11 === 0 ? `author: "Someone Else"` : null,
      i % 13 === 0 ? `audience: "Readers number ${i}"` : null,
      i % 13 === 0 ? `difficulty: beginner` : null,
      i % 17 === 0 ? `extraField${i}: "kept as source metadata"` : null,
      "---",
    ].filter((l): l is string => l !== null);
    const sibling = written.length > 2 ? written[written.length - 2]!.split("/").pop()! : "";
    const image = n < imageCount && i % 2 === 0 ? `../${"../".repeat(sub ? 1 : 0)}assets/fig-${String(n++ % imageCount).padStart(3, "0")}.png`.replace("../../assets", "../assets") : undefined;
    const fixedImage = image ? (sub ? `../../assets/${image.split("/").pop()}` : `../assets/${image.split("/").pop()}`) : undefined;
    const tamil = i % 10 === 0 ? `\n\n${TAMIL}\n` : "";
    add(path, fm.join("\n") + "\n" + body(sibling && sibling !== `${name}.md` ? [sibling] : [], fixedImage) + tamil);
  }

  // Tamil-named folder: has no URL-safe topic, so the preview asks what to do.
  add("தமிழ்/முதல்-குறிப்பு.md", `---\ntitle: "தமிழ் குறிப்பு"\ntags: [மொழி]\n---\n${TAMIL}\n\n${paragraph()}\n`);
  add("தமிழ்/இரண்டாம்-குறிப்பு.md", `---\ntitle: "இரண்டாம் குறிப்பு"\n---\n${TAMIL}\n`);

  // Courses: README metadata, numbered lessons, links between lessons, modules.
  const course = (slug: string, title: string, lessons: number, modules: number) => {
    add(`courses/${slug}/README.md`, `---\ntitle: "${title}"\ndescription: "A course about ${slug}."\ntags: [${slug}, Beginners]\n---\n# ${title}\n\n${paragraph()}\n`);
    for (let l = 1; l <= lessons; l++) {
      const mod = modules ? `module-${String(Math.ceil((l / lessons) * modules)).padStart(2, "0")}/` : "";
      const nn = String(l).padStart(2, "0");
      const next = l < lessons ? `${String(l + 1).padStart(2, "0")}-lesson-${l + 1}.md` : "";
      const withMod = modules && l < lessons && Math.ceil(((l + 1) / lessons) * modules) !== Math.ceil((l / lessons) * modules);
      const link = next ? (withMod ? `../module-${String(Math.ceil(((l + 1) / lessons) * modules)).padStart(2, "0")}/${next}` : next) : "";
      add(`courses/${slug}/${mod}${nn}-lesson-${l}.md`, `---\ntitle: "${title}: lesson ${l}"\n---\n${body(link ? [link] : [])}`);
    }
  };
  const [java, python, sqlLessons] = options.lessons ?? [5, 4, 3];
  course("java", "Java from scratch", java, 0);
  course("python", "Python in modules", python, 2);
  course("sql", "SQL basics", sqlLessons, 0);

  // A few edge files.
  add("misc/readme-like.md", "# Notes\n\nA file with no front matter, [broken link](does-not-exist.md), and a remote image: ![remote](https://example.com/x.png)\n");
  add("misc/malformed.md", "---\ntitle: [oops\n---\nThis one has malformed front matter and must be blocked, not imported as text.\n");
  add("README.md", "# Test site\n\nTop-level README: folder metadata, not an article.\n");
  return files;
}

export async function writeCorpus(outDir: string): Promise<{ folder: string; zip: string; documents: number; media: number }> {
  rmSync(outDir, { recursive: true, force: true });
  const files = await buildCorpus();
  for (const f of files) {
    const target = join(outDir, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.data);
  }
  const zip = join(outDir, "site.zip");
  writeFileSync(zip, concatChunks(await createZip(files.map((f) => ({ path: f.path, data: f.data })), nodeDeflateRaw)));
  return { folder: join(outDir, "site"), zip, documents: files.filter((f) => f.path.endsWith(".md")).length, media: files.filter((f) => f.path.endsWith(".png")).length };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("make-corpus.ts")) {
  const out = process.argv[2] ?? ".data/staging-corpus";
  writeCorpus(out).then((r) => console.log(JSON.stringify(r)));
}
