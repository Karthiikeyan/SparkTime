import { headingRanker } from "./content/derive";
import type { BlockNode, Doc } from "./content/blocks";
import { lessonTitle, parseModuleLabel } from "./content/kind";
import { shortTitle } from "./home";

/**
 * A course as readers meet it: lessons numbered in the collection's order and
 * gathered into modules by the collection's group labels ("Module 4:
 * Collections and Generics"). Pure: built from a collection's entries, so the
 * lesson page, the course page and search describe a course in the same words.
 */

export type CourseLesson = { id: string; path: string; number: number; title: string; fullTitle: string; minutes: number; excerpt: string };
export type CourseModule = { key: string; number: number; name: string; lessons: CourseLesson[]; minutes: number };

type EntryLike = { card: { id: string; path: string; title: string; readingMinutes: number; excerpt: string }; groupLabel: string };

export function buildModules(entries: EntryLike[]): CourseModule[] {
  const modules: CourseModule[] = [];
  let label: string | null = null;
  entries.forEach((entry, index) => {
    const lesson: CourseLesson = {
      id: entry.card.id,
      path: entry.card.path,
      number: index + 1,
      title: lessonTitle(entry.card.title),
      fullTitle: entry.card.title,
      minutes: entry.card.readingMinutes,
      excerpt: entry.card.excerpt,
    };
    if (label === null || entry.groupLabel !== label) {
      label = entry.groupLabel;
      const parsed = parseModuleLabel(label);
      modules.push({ key: `m${modules.length + 1}`, number: parsed.number ?? modules.length + 1, name: parsed.name, lessons: [], minutes: 0 });
    }
    const current = modules[modules.length - 1]!;
    current.lessons.push(lesson);
    current.minutes += lesson.minutes;
  });
  return modules;
}

/** Every lesson in reading order. */
export function courseLessons(modules: CourseModule[]): CourseLesson[] {
  return modules.flatMap((m) => m.lessons);
}

/** "43 min", "1 h 16 min", "2 h": a module's reading time. */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "Java From Zero to Job-Ready: A Practical Path…" → { title: "Java From Zero to Job-Ready", subtitle: "A Practical Path…" }. */
export function splitCourseTitle(full: string): { title: string; subtitle: string } {
  const title = shortTitle(full);
  const cut = full.indexOf(":");
  return { title, subtitle: cut > 0 ? full.slice(cut + 1).trim() : "" };
}

// ---------------------------------------------------------------------------
// A course page's own text: its README, split into the parts the page lays out
// ---------------------------------------------------------------------------

export type CourseSectionKind = "expect" | "lessons" | "limits" | "skip" | "other";
export type CourseSection = { heading: string; kind: CourseSectionKind; nodes: BlockNode[] };

function plain(node: BlockNode): string {
  return node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(plain).join("");
}

/**
 * What a section of a course's own text is for. The course page lays out
 * "What you can expect", "How each lesson works" and "Honest limits" in its side
 * column and drops the module table (the curriculum is the list of modules);
 * anything else stays as text under the curriculum, so nothing the author
 * wrote is lost.
 */
export function classifyCourseSection(heading: string): CourseSectionKind {
  const h = heading.trim();
  if (/^(?:what (?:you(?:'|’)?ll|you will|you can|to) (?:get|expect|learn)|what to expect|outcomes?)\b/i.test(h)) return "expect";
  if (/^how (?:every|each) (?:lesson|article|chapter) (?:is built|works)|^how lessons? (?:are built|work)/i.test(h)) return "lessons";
  if (/^(?:honest limits?|limits?|limitations|what (?:was|could|couldn(?:'|’)?t) (?:not )?be verified|not verified|what is not verified|caveats)\b/i.test(h)) return "limits";
  if (/^(?:the )?(?:modules?|curriculum|course (?:map|outline)|contents|lessons?)(?:\s+(?:table|list|overview|map|at a glance|and lessons))?\.?$/i.test(h)) return "skip";
  return "other";
}

/** The text before the first section, and the sections after it (split at the document's top heading level). */
export function splitCourseBody(doc: Doc): { intro: BlockNode[]; sections: CourseSection[] } {
  const rank = headingRanker(doc);
  const intro: BlockNode[] = [];
  const sections: CourseSection[] = [];
  for (const node of doc.content) {
    if (node.type === "heading" && rank(node.attrs?.level) === 1) {
      const heading = plain(node).trim();
      sections.push({ heading, kind: classifyCourseSection(heading), nodes: [] });
    } else if (sections.length) sections[sections.length - 1]!.nodes.push(node);
    else intro.push(node);
  }
  return { intro, sections };
}
