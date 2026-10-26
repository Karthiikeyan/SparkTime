/**
 * Minimal, defensive ZIP reader and writer (PKWARE APPNOTE subset).
 *
 * Isomorphic: compression is injected, so the browser uses
 * (De)CompressionStream("deflate-raw") and Node uses zlib. The reader trusts
 * nothing in the archive:
 *  - only the central directory is used to list entries (local headers are
 *    read for their variable-length fields only),
 *  - stored (0) and deflate (8) only; encrypted, ZIP64 and multi-disk
 *    archives are rejected,
 *  - symlink entries are rejected,
 *  - entry count, total uncompressed size and per-entry ratio are bounded
 *    BEFORE anything is inflated, and inflation is capped at the declared
 *    size and CRC-checked afterwards,
 *  - names are returned raw; callers must pass them through
 *    normalizePackagePath() (paths.ts).
 */
import { IMPORT_LIMITS } from "./limits";

export type RandomAccessSource = {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
};

export type InflateRaw = (data: Uint8Array, expectedSize: number) => Promise<Uint8Array>;
export type DeflateRaw = (data: Uint8Array) => Promise<Uint8Array>;

export type ZipEntry = {
  name: string;
  method: 0 | 8;
  crc32: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  modifiedAt: Date | null;
};

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export type ZipLimits = { maxEntries: number; maxExtractedBytes: number; maxCompressionRatio: number; maxEntryBytes: number };

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: IMPORT_LIMITS.maxFiles * 2,
  maxExtractedBytes: IMPORT_LIMITS.maxExtractedBytes,
  maxCompressionRatio: IMPORT_LIMITS.maxCompressionRatio,
  maxEntryBytes: 100 * 1024 * 1024,
};

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array, seed = 0): number {
  let crc = ~seed >>> 0;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return ~crc >>> 0;
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function dosDate(date: number, time: number): Date | null {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = (date >> 5) & 0x0f;
  const day = date & 0x1f;
  if (!month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2));
}

const utf8Strict = new TextDecoder("utf-8", { fatal: true });
const latin1 = new TextDecoder("latin1");

function decodeName(bytes: Uint8Array): string {
  // Bit 11 marks UTF-8, but many tools write UTF-8 without it. Try strict UTF-8 first.
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

export function sourceFromBytes(bytes: Uint8Array): RandomAccessSource {
  return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)) };
}

/** Lists file entries (directories omitted) after validating archive-wide limits. */
export async function readZipEntries(source: RandomAccessSource, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<ZipEntry[]> {
  if (source.size < 22) throw new ZipError("This is not a ZIP archive.");
  const tailLength = Math.min(source.size, 22 + 0xffff);
  const tail = await source.read(source.size - tailLength, tailLength);
  const tv = view(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ZipError("This is not a ZIP archive (no central directory).");
  if (eocd >= 20 && tv.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) throw new ZipError("ZIP64 archives are not supported. Re-create the archive without ZIP64.");

  const disk = tv.getUint16(eocd + 4, true);
  const cdDisk = tv.getUint16(eocd + 6, true);
  const totalEntries = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOffset = tv.getUint32(eocd + 16, true);
  if (disk !== 0 || cdDisk !== 0) throw new ZipError("Multi-part (spanned) ZIP archives are not supported.");
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError("ZIP64 archives are not supported.");
  if (totalEntries > limits.maxEntries) throw new ZipError(`The archive has too many entries (max ${limits.maxEntries}).`);
  if (cdOffset + cdSize > source.size) throw new ZipError("The archive is truncated or corrupt.");

  const cd = await source.read(cdOffset, cdSize);
  const cv = view(cd);
  const entries: ZipEntry[] = [];
  let pos = 0;
  let totalSize = 0;
  for (let n = 0; n < totalEntries; n++) {
    if (pos + 46 > cd.length || cv.getUint32(pos, true) !== SIG_CENTRAL) throw new ZipError("The archive's central directory is corrupt.");
    const madeBy = cv.getUint16(pos + 4, true);
    const flags = cv.getUint16(pos + 8, true);
    const method = cv.getUint16(pos + 10, true);
    const time = cv.getUint16(pos + 12, true);
    const date = cv.getUint16(pos + 14, true);
    const crc = cv.getUint32(pos + 16, true);
    const compressedSize = cv.getUint32(pos + 20, true);
    const size = cv.getUint32(pos + 24, true);
    const nameLength = cv.getUint16(pos + 28, true);
    const extraLength = cv.getUint16(pos + 30, true);
    const commentLength = cv.getUint16(pos + 32, true);
    const externalAttributes = cv.getUint32(pos + 38, true);
    const localHeaderOffset = cv.getUint32(pos + 42, true);
    if (pos + 46 + nameLength > cd.length) throw new ZipError("The archive's central directory is corrupt.");
    const name = decodeName(cd.subarray(pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue; // directory entry
    if (flags & 0x0001) throw new ZipError(`"${name}" is encrypted. Password-protected archives are not supported.`);
    if (madeBy >> 8 === 3 && ((externalAttributes >>> 16) & 0o170000) === 0o120000) throw new ZipError(`"${name}" is a symbolic link. Archives with links are not supported.`);
    if (method !== 0 && method !== 8) throw new ZipError(`"${name}" uses an unsupported compression method.`);
    if (size === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) throw new ZipError("ZIP64 archives are not supported.");
    if (size > limits.maxEntryBytes) throw new ZipError(`"${name}" is too large to import.`);
    if (method === 0 && size !== compressedSize) throw new ZipError(`"${name}" is corrupt.`);
    if (method === 8 && size > 1024 * 1024 && compressedSize > 0 && size / compressedSize > limits.maxCompressionRatio) {
      throw new ZipError(`"${name}" expands suspiciously (compression ratio over ${limits.maxCompressionRatio}:1).`);
    }
    totalSize += size;
    if (totalSize > limits.maxExtractedBytes) throw new ZipError(`The archive expands beyond ${Math.round(limits.maxExtractedBytes / 1024 / 1024)} MB.`);
    entries.push({ name, method: method as 0 | 8, crc32: crc, compressedSize, size, localHeaderOffset, modifiedAt: dosDate(date, time) });
  }
  return entries;
}

/** Reads, inflates (bounded) and CRC-checks one entry. */
export async function extractZipEntry(source: RandomAccessSource, entry: ZipEntry, inflate: InflateRaw): Promise<Uint8Array> {
  const header = await source.read(entry.localHeaderOffset, 30);
  const hv = view(header);
  if (header.length < 30 || hv.getUint32(0, true) !== SIG_LOCAL) throw new ZipError(`"${entry.name}" is corrupt.`);
  const dataOffset = entry.localHeaderOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  if (dataOffset + entry.compressedSize > source.size) throw new ZipError(`"${entry.name}" is truncated.`);
  const raw = await source.read(dataOffset, entry.compressedSize);
  let data: Uint8Array;
  if (entry.method === 0) data = raw;
  else {
    try {
      data = await inflate(raw, entry.size);
    } catch (error) {
      if (error instanceof ZipError) throw error;
      throw new ZipError(`"${entry.name}" could not be decompressed.`);
    }
  }
  if (data.length !== entry.size) throw new ZipError(`"${entry.name}" is corrupt (size mismatch).`);
  if (crc32(data) !== entry.crc32) throw new ZipError(`"${entry.name}" is corrupt (checksum mismatch).`);
  return data;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export type ZipInput = { path: string; data: Uint8Array; compress?: boolean };

const encoder = new TextEncoder();

/** Fixed timestamp: identical input produces an identical archive. */
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = (2020 - 1980) << 9 | (1 << 5) | 1;

/**
 * Builds a ZIP as a list of chunks (wrap in a Blob in the browser, or
 * concatenate in Node). Entries are written in the given order with UTF-8
 * names; data that doesn't shrink under deflate is stored.
 */
export async function createZip(inputs: ZipInput[], deflate: DeflateRaw): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.path)) throw new ZipError(`Duplicate path in archive: ${input.path}`);
    seen.add(input.path);
    const name = encoder.encode(input.path);
    const crc = crc32(input.data);
    let method: 0 | 8 = 0;
    let body = input.data;
    if (input.compress !== false && input.data.length > 64) {
      const deflated = await deflate(input.data);
      if (deflated.length < input.data.length) {
        method = 8;
        body = deflated;
      }
    }
    const local = new Uint8Array(30 + name.length);
    const lv = view(local);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, FIXED_DOS_TIME, true);
    lv.setUint16(12, FIXED_DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, input.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const ev = view(entry);
    ev.setUint32(0, SIG_CENTRAL, true);
    ev.setUint16(4, 20, true);
    ev.setUint16(6, 20, true);
    ev.setUint16(8, 0x0800, true);
    ev.setUint16(10, method, true);
    ev.setUint16(12, FIXED_DOS_TIME, true);
    ev.setUint16(14, FIXED_DOS_DATE, true);
    ev.setUint32(16, crc, true);
    ev.setUint32(20, body.length, true);
    ev.setUint32(24, input.data.length, true);
    ev.setUint16(28, name.length, true);
    ev.setUint32(42, offset, true);
    entry.set(name, 46);

    chunks.push(local, body);
    central.push(entry);
    offset += local.length + body.length;
    if (offset > 0xfffffff0) throw new ZipError("The export is too large for a standard ZIP file (4 GB).");
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const endView = view(end);
  endView.setUint32(0, SIG_EOCD, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, cdSize, true);
  endView.setUint32(16, offset, true);
  if (central.length > 0xfffe) throw new ZipError("The export has too many files for a standard ZIP file.");
  return [...chunks, ...central, end];
}

export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
