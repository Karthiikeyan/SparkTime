import { describe, expect, it } from "vitest";
import { commonRoot, isJunkPath, normalizePackagePath, resolveRelative, stripRoot } from "@/lib/portability/paths";
import { concatChunks, crc32, createZip, extractZipEntry, readZipEntries, sourceFromBytes, ZipError, DEFAULT_ZIP_LIMITS } from "@/lib/portability/zip";
import { nodeDeflateRaw, nodeInflateRaw } from "@/server/portability/zip-node";

const enc = new TextEncoder();

async function zipOf(entries: Record<string, string | Uint8Array>) {
  const chunks = await createZip(
    Object.entries(entries).map(([path, data]) => ({ path, data: typeof data === "string" ? enc.encode(data) : data })),
    nodeDeflateRaw,
  );
  return concatChunks(chunks);
}

describe("crc32", () => {
  it("matches the IEEE reference value", () => {
    expect(crc32(enc.encode("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("ZIP round trip", () => {
  it("writes and reads stored and deflated entries with Unicode names", async () => {
    const big = "lorem ipsum ".repeat(500);
    const bytes = await zipOf({ "notes/தமிழ் குறிப்பு.md": "# வணக்கம்", "notes/big.md": big, "img/a.bin": new Uint8Array([1, 2, 3]) });
    const source = sourceFromBytes(bytes);
    const entries = await readZipEntries(source);
    expect(entries.map((e) => e.name)).toEqual(["notes/தமிழ் குறிப்பு.md", "notes/big.md", "img/a.bin"]);
    expect(entries.find((e) => e.name === "notes/big.md")!.method).toBe(8);
    const text = new TextDecoder().decode(await extractZipEntry(source, entries[1]!, nodeInflateRaw));
    expect(text).toBe(big);
  });

  it("is deterministic for identical input", async () => {
    const a = await zipOf({ "a.md": "same", "b.md": "content ".repeat(40) });
    const b = await zipOf({ "a.md": "same", "b.md": "content ".repeat(40) });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("refuses duplicate paths when writing", async () => {
    await expect(createZip([{ path: "a", data: enc.encode("1") }, { path: "a", data: enc.encode("2") }], nodeDeflateRaw)).rejects.toBeInstanceOf(ZipError);
  });
});

/** Patches a field in the first central directory record. */
function patchCentral(bytes: Uint8Array, offset: number, value: number, size: 2 | 4) {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);
  let cd = -1;
  for (let i = copy.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      cd = view.getUint32(i + 16, true);
      break;
    }
  }
  if (size === 2) view.setUint16(cd + offset, value, true);
  else view.setUint32(cd + offset, value, true);
  return copy;
}

describe("ZIP defences", () => {
  it("rejects non-archives and truncated archives", async () => {
    await expect(readZipEntries(sourceFromBytes(enc.encode("not a zip at all, just text")))).rejects.toThrow(/not a ZIP/);
    const bytes = await zipOf({ "a.md": "hello" });
    await expect(readZipEntries(sourceFromBytes(bytes.subarray(0, bytes.length - 30)))).rejects.toBeInstanceOf(ZipError);
  });

  it("rejects encrypted entries", async () => {
    const bytes = patchCentral(await zipOf({ "secret.md": "x" }), 8, 0x0801, 2);
    await expect(readZipEntries(sourceFromBytes(bytes))).rejects.toThrow(/encrypted/);
  });

  it("rejects symbolic links", async () => {
    let bytes = patchCentral(await zipOf({ "link": "/etc/passwd" }), 4, (3 << 8) | 20, 2);
    bytes = patchCentral(bytes, 38, (0o120777 << 16) >>> 0, 4);
    await expect(readZipEntries(sourceFromBytes(bytes))).rejects.toThrow(/symbolic link/);
  });

  it("rejects archives over the entry and size limits before inflating", async () => {
    const bytes = await zipOf({ "a.md": "1", "b.md": "2", "c.md": "3" });
    await expect(readZipEntries(sourceFromBytes(bytes), { ...DEFAULT_ZIP_LIMITS, maxEntries: 2 })).rejects.toThrow(/too many entries/);
    await expect(readZipEntries(sourceFromBytes(bytes), { ...DEFAULT_ZIP_LIMITS, maxExtractedBytes: 2 })).rejects.toThrow(/expands beyond/);
  });

  it("rejects suspicious compression ratios (zip bombs)", async () => {
    const bomb = new Uint8Array(3 * 1024 * 1024); // zeros compress ~1000:1
    const bytes = await zipOf({ "bomb.txt": bomb });
    await expect(readZipEntries(sourceFromBytes(bytes))).rejects.toThrow(/compression ratio/);
  });

  it("stops inflating when an entry lies about its size, and detects corruption", async () => {
    const bytes = await zipOf({ "a.md": "x".repeat(5000) });
    // Claim 100 bytes uncompressed: inflation must stop at the declared size.
    const lying = patchCentral(bytes, 24, 100, 4);
    const source = sourceFromBytes(lying);
    const [entry] = await readZipEntries(source);
    await expect(extractZipEntry(source, entry!, nodeInflateRaw)).rejects.toBeInstanceOf(ZipError);
    const badCrc = patchCentral(bytes, 16, 1234, 4);
    const s2 = sourceFromBytes(badCrc);
    const [e2] = await readZipEntries(s2);
    await expect(extractZipEntry(s2, e2!, nodeInflateRaw)).rejects.toThrow(/checksum/);
  });

  it("returns traversal names raw so the path layer can reject them", async () => {
    const bytes = await zipOf({ "../../etc/passwd": "x", "/abs.md": "y", "C:/win.md": "z", "ok/fine.md": "w" });
    const names = (await readZipEntries(sourceFromBytes(bytes))).map((e) => e.name);
    const verdicts = names.map((n) => normalizePackagePath(n).ok);
    expect(verdicts).toEqual([false, false, false, true]);
  });
});

describe("package paths", () => {
  it("normalises and rejects unsafe paths", () => {
    expect(normalizePackagePath("a\\b\\./c.md")).toEqual({ ok: true, path: "a/b/c.md" });
    expect(normalizePackagePath("a/../b.md").ok).toBe(false);
    expect(normalizePackagePath("/etc/passwd").ok).toBe(false);
    expect(normalizePackagePath("\\\\server\\share").ok).toBe(false);
    expect(normalizePackagePath("a\u0000b.md").ok).toBe(false);
    expect(normalizePackagePath("evil\u202Egnp.md").ok).toBe(false);
    expect(normalizePackagePath("x/".repeat(40) + "deep.md").ok).toBe(false);
    // NFD input is stored NFC so lookups agree.
    const nfd = "cafe\u0301.md";
    expect(normalizePackagePath(nfd)).toEqual({ ok: true, path: "café.md" });
  });

  it("resolves relative references inside the package only", () => {
    expect(resolveRelative("career/java/02-oop.md", "../01-intro.md")).toEqual({ path: "career/01-intro.md", fragment: null });
    expect(resolveRelative("a/b.md", "img/My%20Photo.png#x")).toEqual({ path: "a/img/My Photo.png", fragment: "x" });
    expect(resolveRelative("a/b.md", "<img/with space.png>")).toEqual({ path: "a/img/with space.png", fragment: null });
    expect(resolveRelative("a/b.md", "../../escape.md")).toBeNull();
    expect(resolveRelative("a/b.md", "https://example.com/x.md")).toBeNull();
    expect(resolveRelative("a/b.md", "#section")).toBeNull();
  });

  it("detects a shared wrapper folder and junk files", () => {
    expect(commonRoot(["articles/a.md", "articles/b/c.md"])).toBe("articles");
    expect(commonRoot(["a.md", "articles/b.md"])).toBe("");
    expect(stripRoot("articles/b/c.md", "articles")).toBe("b/c.md");
    expect(isJunkPath("__MACOSX/a/._b.md")).toBe(true);
    expect(isJunkPath("notes/.DS_Store")).toBe(true);
    expect(isJunkPath("vault/.obsidian/app.json")).toBe(true);
    expect(isJunkPath("notes/real.md")).toBe(false);
  });
});
