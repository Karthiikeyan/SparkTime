/**
 * Deterministic ordering for collections. Never depends on upload or
 * directory-enumeration order: explicit order, then numeric prefix, then a
 * fixed-locale natural sort of the filename, then the full path.
 */
import { basename, stem } from "./paths";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** "01-java-basics" → 1, "Day 3 - Streams" → 3, "lesson_12" → 12, "1.2 Intro" → 1.2. */
export function numericPrefix(name: string): number | null {
  const base = stem(name).trim();
  const plain = /^(\d{1,4}(?:\.\d{1,3})?)(?=[\s._)-]|$)/.exec(base);
  if (plain) return Number(plain[1]);
  const worded = /^(?:day|lesson|part|chapter|module|step|week|unit|session|ep(?:isode)?|lecture)[\s._-]*(\d{1,4})(?=\b|[\s._-])/i.exec(base);
  return worded ? Number(worded[1]) : null;
}

/** Removes a leading sequence marker so "01-java-basics" titles as "java-basics". */
export function stripNumericPrefix(name: string): string {
  return name.replace(/^\d{1,4}(?:\.\d{1,3})?(?:[\s._)-]+|$)/, "").trim() || name;
}

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export type Orderable = { path: string; explicit: number | null };

export type OrderSource = "explicit" | "prefix" | "name";

/** Sorts and reports which evidence decided the order. */
export function orderItems<T extends Orderable>(items: T[], readmeOrder: string[] = []): { items: T[]; source: OrderSource } {
  const readmeRank = new Map(readmeOrder.map((name, i) => [name.normalize("NFC").toLowerCase(), i]));
  const rankOf = (item: T): number | null => {
    if (item.explicit !== null) return item.explicit;
    const byName = readmeRank.get(basename(item.path).toLowerCase()) ?? readmeRank.get(stem(item.path).toLowerCase());
    return byName ?? null;
  };
  const anyExplicit = items.some((i) => rankOf(i) !== null);
  const anyPrefix = items.some((i) => numericPrefix(basename(i.path)) !== null);
  const sorted = [...items].sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== null || rb !== null) {
      if (ra === null) return 1;
      if (rb === null) return -1;
      if (ra !== rb) return ra - rb;
    }
    const pa = numericPrefix(basename(a.path));
    const pb = numericPrefix(basename(b.path));
    if (pa !== null || pb !== null) {
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (pa !== pb) return pa - pb;
    }
    return naturalCompare(basename(a.path), basename(b.path)) || naturalCompare(a.path, b.path);
  });
  return { items: sorted, source: anyExplicit ? "explicit" : anyPrefix ? "prefix" : "name" };
}

/** A folder looks like an ordered sequence when most of its documents carry a sequence marker. */
export function looksSequenced(names: string[]): boolean {
  if (names.length < 2) return false;
  const numbered = names.filter((n) => numericPrefix(n) !== null).length;
  return numbered >= 2 && numbered * 2 >= names.length;
}
