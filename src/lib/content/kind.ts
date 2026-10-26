/**
 * What a piece is, in a reader's words: a guide to read, a course to work
 * through, an interview page to prepare from. Decided by the content type's
 * template and schema, never by its name, so a type the owner adds later
 * lands in the right place. Anything else (a project, a talk, a series) keeps
 * its own type name.
 */

export type KindableType = { template: string; slug: string; name?: string; schemaType?: string | null; routing?: string; archivedAt?: Date | string | null };

export type ContentKind = "guide" | "course" | "interview" | "other";

/** Courses are collection-template types whose schema is Course (the seeded "Course" type). */
export function isCourseType(t: KindableType): boolean {
  return t.template === "collection" && (t.routing === undefined || t.routing === "type") && !t.archivedAt && (t.schemaType === "Course" || t.slug === "course");
}

export function isInterviewType(t: KindableType): boolean {
  return t.template === "interview" && (t.routing === undefined || t.routing === "type") && !t.archivedAt;
}

/** Written pieces: the library's "Guides". */
export function isGuideType(t: KindableType): boolean {
  return (t.routing === undefined || t.routing === "type") && !t.archivedAt && (t.template === "editorial" || t.template === "minimal");
}

export function kindOf(t: KindableType): ContentKind {
  if (isCourseType(t)) return "course";
  if (isInterviewType(t)) return "interview";
  if (isGuideType(t)) return "guide";
  return "other";
}

export const KIND_LABELS: Record<Exclude<ContentKind, "other">, { singular: string; plural: string }> = {
  guide: { singular: "Guide", plural: "Guides" },
  course: { singular: "Course", plural: "Courses" },
  interview: { singular: "Interview", plural: "Interviews" },
};

/** The pill on a list row: "Guide", "Course", "Interview", or the type's own name. */
export function kindLabel(t: KindableType): string {
  const kind = kindOf(t);
  return kind === "other" ? (t.name ?? "Page") : KIND_LABELS[kind].singular;
}

/**
 * A lesson's title as the page shows it: authors number lessons in the title
 * ("Lesson 12: Maps and How HashMap Works"), and the page prints the number
 * itself ("Lesson 12 of 41"), so the prefix is dropped.
 */
export function lessonTitle(title: string): string {
  return title.replace(/^\s*(?:lesson|part|chapter)\s+\d+\s*[:.–—-]\s*/i, "").trim() || title;
}

export type ModuleLabel = { number: number | null; name: string };

/**
 * A collection's group label as a course module: "Module 4: Collections and
 * Generics" → { number: 4, name: "Collections and Generics" }. A label with no
 * number keeps its text and takes its place in the list as the number.
 */
export function parseModuleLabel(label: string): ModuleLabel {
  const match = label.trim().match(/^(?:module|unit|section|part|chapter)?\s*(\d{1,3})\s*[:.–—·)-]\s*(.+)$/i);
  if (match) return { number: Number(match[1]), name: match[2]!.trim() };
  return { number: null, name: label.trim() };
}
