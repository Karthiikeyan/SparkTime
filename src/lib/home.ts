/**
 * Pure text helpers for the home page's cards. Titles and excerpts are the
 * owner's own words, shortened rather than rewritten.
 */

/** "Java From Zero to Job-Ready: A Practical Path…" → "Java From Zero to Job-Ready". */
export function shortTitle(title: string): string {
  const cut = title.indexOf(":");
  return (cut > 0 ? title.slice(0, cut) : title).trim();
}

/** The excerpt's first sentence, for a one-line description. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^[\s\S]+?[.!?](?=\s+["'“‘(]?[A-Z0-9]|$)/);
  return (match ? match[0] : trimmed).trim();
}

/** Reading time as the course pages show it: "45 min" under an hour and a half, "7 h" from there. */
export function hoursLabel(minutes: number): string {
  return minutes >= 90 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
}

/**
 * A company card's role line: the first two named roles, and "more" when there
 * are others (a role whose level the candidates didn't state never leads).
 */
export function roleLine(roles: string[]): { shown: string[]; more: boolean } {
  const named = roles.filter((r) => !/unspecified/i.test(r));
  const shown = (named.length ? named : roles).slice(0, 2);
  return { shown, more: roles.length > shown.length };
}
