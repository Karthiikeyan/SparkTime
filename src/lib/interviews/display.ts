/**
 * Small pure helpers for how interview pages describe themselves. Every number
 * is a count of what the guides hold; nothing here invents one.
 */

export type QuestionTone = "tech" | "accent" | "warn" | "neutral";

const TECHNICAL = new Set(["dsa", "java", "spring-boot", "sql", "react", "javascript", "backend", "devops"]);

/** Colour of a question's topic tag: technical topics blue-grey, behavioural the accent tint, system design the warm tint. */
export function questionTone(category: string): QuestionTone {
  if (category === "behavioral") return "accent";
  if (category === "system-design") return "warn";
  return TECHNICAL.has(category) ? "tech" : "neutral";
}

/** "2021–2026" from every year mentioned in the given period strings; "" when none names a year. */
export function yearRange(periods: string[]): string {
  const years = periods.flatMap((p) => p.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number);
  if (!years.length) return "";
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

/** The share of accounts that mention something, as a whole percentage (never over 100). */
export function share(count: number, of: number): number {
  return of > 0 ? Math.min(100, Math.round((count / of) * 100)) : 0;
}

/** "Software Engineer (level unspecified)": a role whose level candidates didn't state. */
export function isUnspecifiedRole(role: string): boolean {
  return /unspecified/i.test(role);
}
