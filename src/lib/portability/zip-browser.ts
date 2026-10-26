/**
 * Browser codecs for zip.ts, built on the Compression Streams API (no
 * dependency). Inflation is streamed and aborted as soon as the output
 * passes the entry's declared size, so a lying header can't exhaust memory.
 */
import { ZipError, type DeflateRaw, type InflateRaw, type RandomAccessSource } from "./zip";

async function pipe(data: Uint8Array, transform: TransformStream<Uint8Array, Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(transform).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ZipError("An archive entry expands beyond its declared size.");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export const browserInflateRaw: InflateRaw = (data, expectedSize) =>
  pipe(data, new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>, expectedSize);

export const browserDeflateRaw: DeflateRaw = (data) =>
  pipe(data, new CompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>, Number.MAX_SAFE_INTEGER);

/** Random access over a File/Blob without reading it whole into memory. */
export function sourceFromBlob(blob: Blob): RandomAccessSource {
  return {
    size: blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}

export function supportsCompressionStreams(): boolean {
  try {
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}
