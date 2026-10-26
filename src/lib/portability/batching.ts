/**
 * Splits staged files into request bodies measured in real UTF-8 bytes of
 * their JSON form (so multibyte text such as Tamil, and JSON escaping, are
 * counted exactly rather than estimated). A file that cannot fit in a request
 * on its own is returned as oversized instead of being sent.
 */
const encoder = new TextEncoder();

export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Bytes of the `{"files":[` ... `]}` wrapper and commas around n items. */
const ENVELOPE = 32;

export function planBatches<T extends object>(items: T[], maxBatchBytes: number, maxSingleBytes: number): { batches: T[][]; oversized: T[] } {
  const batches: T[][] = [];
  const oversized: T[] = [];
  let current: T[] = [];
  let bytes = ENVELOPE;
  for (const item of items) {
    const size = jsonBytes(item) + 1;
    if (size + ENVELOPE > maxSingleBytes) {
      oversized.push(item);
      continue;
    }
    if (current.length && bytes + size > maxBatchBytes) {
      batches.push(current);
      current = [];
      bytes = ENVELOPE;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return { batches, oversized };
}
