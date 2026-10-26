import { deflateRawSync, inflateRawSync } from "node:zlib";
import { ZipError, type DeflateRaw, type InflateRaw } from "@/lib/portability/zip";

/** Node codecs for lib/portability/zip.ts. Inflation stops one byte past the declared size. */
export const nodeInflateRaw: InflateRaw = async (data, expectedSize) => {
  try {
    return new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, expectedSize + 1) }));
  } catch (error) {
    if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
      throw new ZipError("An archive entry expands beyond its declared size.");
    }
    throw error;
  }
};

export const nodeDeflateRaw: DeflateRaw = async (data) => new Uint8Array(deflateRawSync(data, { level: 6 }));
