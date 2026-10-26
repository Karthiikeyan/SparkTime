import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assemblePackage } from "@/lib/portability/assemble";
import { fileKind, isTextKind } from "@/lib/portability/paths";
import { concatChunks, extractZipEntry, readZipEntries, sourceFromBytes } from "@/lib/portability/zip";
import { eq } from "drizzle-orm";
import { documents } from "@/server/db/schema";
import { nodeDeflateRaw, nodeInflateRaw } from "@/server/portability/zip-node";
import { createDocument, getDocumentForEdit, saveDocument } from "@/server/services/documents";
import { runImportJob } from "@/server/services/import/execute";
import { analyzeImportJob, approveImportJob, createImportJob, stageImportFiles } from "@/server/services/import/jobs";
import { exportManifest, exportPage, exportAsset, type ExportRequest } from "@/server/services/portable-export";
import { createAdmin, createTestDb, typeId } from "../helpers/db";

/** An interview page's guide survives the portable package (export → import elsewhere). */

const guide = {
  accounts: 4,
  period: "2024–2026",
  researched: "2026-10-07",
  highlights: ["Two coding problems per round."],
  preparation: ["NeetCode 150."],
  official: [{ title: "Acme: how we hire", url: "https://acme.example/hire", points: ["Three interviews."] }],
  sequences: [{ steps: ["Online Assessment", "Technical Round 1"], reports: 2 }],
  rounds: [
    {
      id: "technical-round-1",
      name: "Technical Round 1",
      reports: 3,
      summary: "Two DSA problems.",
      questions: [
        { id: "lru", text: "Design an LRU cache", category: "dsa", difficulty: "medium", practiceUrl: "https://leetcode.com/problems/lru-cache/", reports: 2, review: false },
        { id: "lp-deadline", text: "Tell me about a missed deadline.", category: "behavioral", difficulty: null, practiceUrl: null, reports: 1, review: true },
      ],
    },
  ],
};

const files: Record<string, string> = {};

beforeAll(async () => {
  const source = await createTestDb({ seed: true });
  const admin = await createAdmin(source.db);
  const { id } = await createDocument(admin, { typeId: await typeId(source.db, "interviews"), title: "Acme SDE 1 Interview Experiences" });
  await saveDocument(admin, id, { body: { properties: { company: "Acme", jobRole: "SDE 1", guide } } });
  const request: Omit<ExportRequest, "page"> = { scope: { kind: "documents", ids: [id] }, format: "portable", includePrivate: true };
  const result = await assemblePackage({
    format: "portable",
    fetchManifest: () => exportManifest(admin, request),
    fetchPage: async (page) => exportPage(admin, { ...request, page }),
    fetchAsset: async (assetId) => new Uint8Array((await exportAsset(admin, assetId)).bytes),
    deflate: nodeDeflateRaw,
  });
  const zip = sourceFromBytes(concatChunks(result.chunks));
  for (const entry of await readZipEntries(zip)) {
    if (isTextKind(fileKind(entry.name))) files[entry.name] = new TextDecoder().decode(await extractZipEntry(zip, entry, nodeInflateRaw));
  }
  await source.close();
});

describe("interview pages in portable packages", () => {
  let target: Awaited<ReturnType<typeof createTestDb>>;
  afterAll(() => target?.close());

  it("round-trips company, role and the whole guide", async () => {
    target = await createTestDb({ seed: true });
    const admin = await createAdmin(target.db);
    const { id } = await createImportJob(admin, { sourceName: "roundtrip" });
    await stageImportFiles(admin, id, { files: Object.entries(files).map(([path, text]) => ({ path, size: text.length, text })) });
    const plan = await analyzeImportJob(admin, id, { decisions: {} });
    expect(plan.decisionsRequired).toEqual([]);
    await approveImportJob(admin, id, { hash: plan.hash });
    for (let i = 0; i < 20; i++) if ((await runImportJob(admin, id)).status !== "running") break;

    const [row] = await target.db.select({ id: documents.id }).from(documents).where(eq(documents.typeId, await typeId(target.db, "interviews")));
    const doc = await getDocumentForEdit(admin, row!.id);
    expect(doc.properties).toEqual({ company: "Acme", jobRole: "SDE 1", guide });
  });
});
