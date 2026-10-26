import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { CourseLesson, CourseModule } from "@/lib/courses";
import type { CourseContext } from "@/server/services/document-page";

const pad = (n: number) => String(n).padStart(2, "0");

const btn = "min-h-11 items-center rounded-[8px] px-3.5 text-sm font-semibold transition-colors";

/**
 * The strip under the header on a lesson: which course, "Lesson 12 of 41", how
 * far along that is, and the neighbouring lessons. Below the width where the
 * lesson list has its own column, "Lessons" opens the list from here.
 */
export function CourseBar({ course }: { course: CourseContext }) {
  const percent = Math.round((course.number / course.total) * 100);
  return (
    <div className="relative border-b border-line bg-surface">
      <div className="container-wide flex flex-wrap items-center gap-x-6 gap-y-1 py-1.5 sm:py-2">
        <Link href={course.path} className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-[0.9375rem] font-semibold sm:flex-none">
          <BookOpen size={18} strokeWidth={2} aria-hidden="true" className="shrink-0 text-accent-ink" />
          <span className="truncate sm:whitespace-normal">{course.title}</span>
        </Link>
        <span className="hidden text-sm text-muted sm:inline">
          Lesson {course.number} of {course.total}
        </span>
        <div
          role="progressbar"
          aria-label="Course progress"
          aria-valuenow={course.number}
          aria-valuemin={0}
          aria-valuemax={course.total}
          className="order-last hidden h-1.5 min-w-[12rem] flex-1 overflow-hidden rounded-full bg-surface-2 sm:order-none sm:block"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
        {course.previous && (
          <Link href={course.previous.path} className={cn(btn, "hidden border border-line-strong text-ink hover:border-line-field sm:inline-flex")}>
            ← Lesson {course.previous.number}
          </Link>
        )}
        {course.next && (
          <Link href={course.next.path} className={cn(btn, "hidden bg-accent text-accent-contrast hover:bg-accent-hover sm:inline-flex")}>
            Lesson {course.next.number} →
          </Link>
        )}
        <details className="group rail:hidden">
          <summary className={cn(btn, "inline-flex cursor-pointer list-none border border-line-strong bg-surface text-ink hover:border-line-field [&::-webkit-details-marker]:hidden")}>
            Lessons
            <ChevronDown size={15} aria-hidden="true" className="ml-1.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="absolute inset-x-0 top-full z-30 max-h-[70dvh] overflow-y-auto border-b border-line bg-surface shadow-float">
            <div className="container-wide py-4">
              <CourseOutline course={course} scope="all" />
            </div>
          </div>
        </details>
        <div className="flex basis-full items-center gap-3 sm:hidden">
          <span className="text-xs text-muted">
            Lesson {course.number} of {course.total}
          </span>
          <div role="presentation" className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LessonLink({ lesson, current }: { lesson: CourseLesson; current: boolean }) {
  return (
    <Link
      href={lesson.path}
      aria-current={current ? "page" : undefined}
      className={cn("flex min-h-11 items-baseline gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors", current ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
    >
      <span className={cn("shrink-0 font-mono text-xs", current ? "text-accent-ink" : "text-muted")}>{pad(lesson.number)}</span>
      <span className="leading-snug">{lesson.title}</span>
    </Link>
  );
}

function moduleName(m: CourseModule): string {
  return m.name ? `${m.number} · ${m.name}` : "Lessons";
}

/**
 * The course's lessons by module. "rail" is the left column: the module being
 * read is open with its lessons, its neighbours are collapsed, and "All N
 * lessons" leads to the course page. "all" is the same list for the Lessons
 * menu, with every module available. Plain <details>: no script.
 */
export function CourseOutline({ course, scope }: { course: CourseContext; scope: "rail" | "all" }) {
  const here = course.moduleIndex;
  const shown = course.modules.map((m, i) => ({ m, i })).filter(({ i }) => scope === "all" || Math.abs(i - here) <= 1);
  const flat = course.modules.length === 1 && !course.modules[0]!.name;
  return (
    <div className="space-y-1.5 text-sm">
      {scope === "rail" && <p className="caps mb-2 text-muted">Course lessons</p>}
      {shown.map(({ m, i }) => {
        const open = i === here;
        if (flat) {
          return (
            <ul key={m.key} className="space-y-0.5">
              {m.lessons.map((l) => (
                <li key={l.id}>
                  <LessonLink lesson={l} current={l.number === course.number} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <details key={m.key} open={open} className={cn("group rounded-xl", open && "border border-line bg-surface p-2")}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-2.5 text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
              <span className={cn("leading-snug", open && "font-semibold text-ink")}>{moduleName(m)}</span>
              <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-muted transition-transform group-open:rotate-90" />
            </summary>
            <ul className="space-y-0.5 pb-1">
              {m.lessons.map((l) => (
                <li key={l.id}>
                  <LessonLink lesson={l} current={l.number === course.number} />
                </li>
              ))}
            </ul>
          </details>
        );
      })}
      {scope === "rail" && (
        <Link href={course.path} className="inline-flex min-h-11 items-center px-2.5 font-semibold text-accent-ink hover:underline hover:underline-offset-4">
          All {course.total} lessons →
        </Link>
      )}
    </div>
  );
}

/** Previous and next lesson as cards; the next one is the filled accent card. On a phone the way forward comes first. */
export function LessonPager({ course }: { course: CourseContext }) {
  if (!course.previous && !course.next) return null;
  return (
    <nav aria-label="Lesson navigation" className="grid gap-3 sm:grid-cols-2 sm:gap-4">
      {course.previous ? (
        <Link href={course.previous.path} className="order-2 flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-field sm:order-1 sm:gap-1.5 sm:rounded-lg sm:p-6">
          <span className="text-[0.8125rem] text-muted sm:text-sm">← Previous · Lesson {course.previous.number}</span>
          <span className="font-serif text-[1.25rem] font-medium leading-snug sm:text-[1.375rem]">{course.previous.title}</span>
        </Link>
      ) : (
        <span className="order-2 hidden sm:order-1 sm:block" />
      )}
      {course.next && (
        <Link href={course.next.path} className="order-1 flex flex-col gap-1 rounded-xl bg-accent p-4 text-accent-contrast transition-colors hover:bg-accent-hover sm:order-2 sm:gap-1.5 sm:rounded-lg sm:p-6 sm:text-right">
          <span className="text-[0.8125rem] opacity-85 sm:text-sm">Next · Lesson {course.next.number} →</span>
          <span className="font-serif text-[1.25rem] font-medium leading-snug sm:text-[1.375rem]">{course.next.title}</span>
        </Link>
      )}
    </nav>
  );
}

/** A phone's bottom bar: back one lesson, on to the next. It stays at the foot of the screen while the lesson is read. */
export function LessonStickyBar({ course }: { course: CourseContext }) {
  return (
    <div className="sticky bottom-0 z-30 flex gap-2 border-t border-line bg-surface px-4 pb-3.5 pt-2.5 sm:hidden">
      {course.previous ? (
        <Link href={course.previous.path} aria-label={`Previous lesson: ${course.previous.title}`} className="flex min-h-12 w-12 items-center justify-center rounded-md border border-line-strong text-ink">
          ←
        </Link>
      ) : (
        <span aria-hidden="true" className="flex min-h-12 w-12 items-center justify-center rounded-md border border-line text-subtle opacity-60">
          ←
        </span>
      )}
      {course.next ? (
        <Link href={course.next.path} className="flex min-h-12 flex-1 items-center justify-center rounded-md bg-accent text-[0.9375rem] font-semibold text-accent-contrast">
          Next lesson →
        </Link>
      ) : (
        <Link href={course.path} className="flex min-h-12 flex-1 items-center justify-center rounded-md bg-accent text-[0.9375rem] font-semibold text-accent-contrast">
          Back to the course →
        </Link>
      )}
    </div>
  );
}
