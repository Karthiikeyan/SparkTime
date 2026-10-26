import { describe, expect, it } from "vitest";
import { assemblePackage, ExportValidationError, type ManifestResponse } from "@/lib/portability/assemble";
import { EXPORT_LIMITS } from "@/lib/portability/limits";
import { parseManifest } from "@/lib/portability/manifest";
import { nodeDeflateRaw } from "@/server/portability/zip-node";

const manifest = (assets: ManifestResponse["assets"]): ManifestResponse => ({
  manifest: parseManifest({ format: "studio-portable", schemaVersion: 1, exportedAt: "2026-10-04T00:00:00Z" }).ok
    ? (parseManifest({ format: "studio-portable", schemaVersion: 1, exportedAt: "2026-10-04T00:00:00Z", assets: assets.map((a) => ({ pid: a.pid, path: a.path, sizeBytes: a.size })) }) as { ok: true; manifest: ManifestResponse["manifest"] }).manifest
    : (null as never),
  extras: [{ path: "README.md", text: "hi" }],
  assets,
  summary: { pages: 0, documents: 0, assets: assets.length, warnings: [] },
});

describe("export packaging limits", () => {
  it("refuses media beyond the browser ceiling before downloading any of it", async () => {
    let downloads = 0;
    const big = [{ id: "a", pid: "p", path: "media/a.webp", size: EXPORT_LIMITS.maxPackageMediaBytes + 1, mimeType: "image/webp" }];
    await expect(
      assemblePackage({ format: "portable", fetchManifest: async () => manifest(big), fetchPage: async () => ({ files: [] }), fetchAsset: async () => (downloads++, new Uint8Array(1)), deflate: nodeDeflateRaw }),
    ).rejects.toBeInstanceOf(ExportValidationError);
    expect(downloads).toBe(0);
  });

  it("builds and validates a small package, and manifest-only ignores the media ceiling", async () => {
    const small = [{ id: "a", pid: "p", path: "media/a.webp", size: 3, mimeType: "image/webp" }];
    const ok = await assemblePackage({ format: "portable", fetchManifest: async () => manifest(small), fetchPage: async () => ({ files: [] }), fetchAsset: async () => new Uint8Array([1, 2, 3]), deflate: nodeDeflateRaw });
    expect(ok.files).toBe(3); // manifest.json, README.md, one media file
    const huge = [{ ...small[0]!, size: EXPORT_LIMITS.maxPackageMediaBytes * 5 }];
    const manifestOnly = await assemblePackage({ format: "manifest", fetchManifest: async () => manifest(huge), fetchPage: async () => ({ files: [] }), fetchAsset: async () => { throw new Error("must not download"); }, deflate: nodeDeflateRaw });
    expect(manifestOnly.files).toBe(2);
  });
});
