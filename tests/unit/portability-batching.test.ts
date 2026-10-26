import { describe, expect, it } from "vitest";
import { jsonBytes, planBatches } from "@/lib/portability/batching";
import { IMPORT_LIMITS } from "@/lib/portability/limits";

const VERCEL_BODY_LIMIT = 4.5 * 1024 * 1024;
const SERVER_CAP = IMPORT_LIMITS.maxBatchBytes + 384 * 1024;
const utf8 = new TextEncoder();

const file = (path: string, text: string) => ({ path, size: utf8.encode(text).length, sha256: null, head: null, text });
const body = (batch: object[]) => utf8.encode(JSON.stringify({ files: batch })).length;

describe("import request sizing (UTF-8 bytes, exact)", () => {
  it("keeps Tamil batches under the limit even though characters ≠ bytes", () => {
    const tamil = "தமிழ் மொழி ஒரு செம்மொழி. ".repeat(60_000); // ~1.5M chars, ~4.4 MB if sent whole
    const items = Array.from({ length: 5 }, (_, i) => file(`ta/${i}.md`, tamil.slice(0, 600_000)));
    expect(items[0]!.text!.length).toBe(600_000);
    expect(items[0]!.size).toBeGreaterThan(1_500_000); // multibyte: far more bytes than characters
    const { batches, oversized } = planBatches(items, IMPORT_LIMITS.maxBatchBytes, SERVER_CAP);
    expect(oversized).toEqual([]);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(5);
    for (const batch of batches) {
      expect(body(batch)).toBeLessThanOrEqual(IMPORT_LIMITS.maxBatchBytes);
      expect(body(batch)).toBeLessThan(VERCEL_BODY_LIMIT);
    }
    // The old estimate (characters × 1.1) would have packed all five into one ~7.5 MB request.
    expect(items.reduce((n, f) => n + f.text!.length * 1.1, 0)).toBeLessThan(IMPORT_LIMITS.maxBatchBytes * 1.2);
    expect(body(items)).toBeGreaterThan(VERCEL_BODY_LIMIT);
  });

  it("handles many small files and escaping-heavy text", () => {
    const small = Array.from({ length: 1000 }, (_, i) => file(`n/${i}.md`, `# தலைப்பு ${i}\n\n${"உரை \"மேற்கோள்\"\n".repeat(60)}`));
    const { batches } = planBatches(small, IMPORT_LIMITS.maxBatchBytes, SERVER_CAP);
    expect(batches.flat()).toHaveLength(1000);
    for (const batch of batches) expect(body(batch)).toBeLessThanOrEqual(IMPORT_LIMITS.maxBatchBytes);
    // Quotes and newlines double in JSON: still measured exactly.
    const heavy = file("h.md", '"\n'.repeat(900_000));
    expect(jsonBytes(heavy)).toBeGreaterThan(heavy.size * 1.9);
    const result = planBatches([heavy], IMPORT_LIMITS.maxBatchBytes, SERVER_CAP);
    expect(result.oversized).toHaveLength(1); // ~3.9 MB encoded: refused rather than sent and rejected
    expect(result.batches).toEqual([]);
  });

  it("never exceeds the server's own cap for any single sent file", () => {
    const max = file("m.md", "அ".repeat(Math.floor(IMPORT_LIMITS.maxTextFileBytes / 3)));
    const { batches, oversized } = planBatches([max], IMPORT_LIMITS.maxBatchBytes, SERVER_CAP);
    expect(oversized).toEqual([]);
    expect(body(batches[0]!)).toBeLessThan(SERVER_CAP);
  });
});
