import Link from "next/link";
import { cn } from "@/lib/cn";
import { hoursLabel } from "@/lib/home";
import { Pill, topicTone } from "./pill";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "41 lessons · 11 h": what a course is made of, from its counted lessons and summed reading time. */
export function courseMeta(lessons: number, minutes: number): string {
  return `${plural(lessons, "lesson")}${minutes > 0 ? ` · ${hoursLabel(minutes)}` : ""}`;
}

export type CourseCardData = { path: string; title: string; topic?: { name: string; slug: string } | null; oneLiner?: string; lessons: number; minutes: number };

/**
 * A course as a card. "lg" is the full card (topic pill, serif title, a line
 * about it, lessons and time); "sm" is the compact one beneath a page ("More
 * free courses", "Courses in Technology"). `compactOnMobile` tightens the
 * large card on a phone, as on the home page.
 */
export function CourseCard({ course, size = "lg", compactOnMobile = false, showStart = size === "lg", className }: { course: CourseCardData; size?: "lg" | "sm"; compactOnMobile?: boolean; showStart?: boolean; className?: string }) {
  const meta = courseMeta(course.lessons, course.minutes);
  if (size === "sm") {
    return (
      <Link href={course.path} className={cn("group flex h-full flex-col gap-2.5 rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-field sm:p-6", className)}>
        {course.topic && <span className="text-[0.8125rem] font-semibold text-muted">{course.topic.name}</span>}
        <span className="font-serif text-[1.25rem] font-medium leading-[1.2] sm:text-[1.375rem]">{course.title}</span>
        <span className="mt-auto flex justify-between gap-3 border-t border-line-soft pt-3 text-sm text-muted">
          <span>{meta}</span>
          {showStart && (
            <span className="font-semibold text-accent-ink" aria-hidden="true">
              Start →
            </span>
          )}
        </span>
      </Link>
    );
  }
  return (
    <Link
      href={course.path}
      className={cn(
        "group flex h-full flex-col rounded-lg border border-line bg-surface transition-colors hover:border-line-field",
        compactOnMobile ? "gap-2 rounded-xl p-5 sm:gap-3.5 sm:rounded-lg sm:p-8" : "gap-3.5 p-6 sm:p-8",
        className,
      )}
    >
      {course.topic && (
        <Pill tone={topicTone(course.topic.slug)} className={cn("self-start px-2.5 py-1", compactOnMobile && "hidden sm:inline-flex")}>
          {course.topic.name}
        </Pill>
      )}
      <span className={cn("font-serif font-medium", compactOnMobile ? "text-[1.375rem] leading-[1.2] sm:text-[1.75rem] sm:leading-[1.15]" : "text-[1.625rem] leading-[1.15] sm:text-[1.75rem]")}>{course.title}</span>
      {course.oneLiner && <span className={cn("text-base leading-relaxed text-ink-2", compactOnMobile && "hidden sm:block")}>{course.oneLiner}</span>}
      <span className={cn("mt-auto flex justify-between gap-4 border-line-soft pt-4 text-sm text-muted", compactOnMobile ? "border-0 pt-0 sm:border-t sm:pt-4" : "border-t")}>
        <span>{meta}</span>
        {showStart && (
          <span className="font-semibold text-accent-ink" aria-hidden="true">
            Start →
          </span>
        )}
      </span>
    </Link>
  );
}

/** A company's initial on an ink tile. */
export function InitialTile({ name, size = 40, className }: { name: string; size?: 40 | 52 | 60 | 72; className?: string }) {
  const sizes = { 40: "size-10 rounded-md text-base", 52: "size-[3.25rem] rounded-xl text-[1.375rem]", 60: "size-[3.75rem] rounded-lg text-[1.625rem]", 72: "size-[4.5rem] rounded-[16px] text-[2rem]" };
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center bg-ink font-bold text-bg", sizes[size], className)}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** A numbered tile with a title and a line: what SparkTribe gives you, how a lesson works. */
export function FeatureCard({ n, title, children, className }: { n?: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border border-line bg-surface p-6 sm:p-7", className)}>
      {n && (
        <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-md bg-accent-soft font-bold text-accent-ink">
          {n}
        </span>
      )}
      <h3 className="mt-1 font-serif text-[1.375rem] font-medium leading-tight sm:text-[1.625rem]">{title}</h3>
      <div className="text-base text-ink-2">{children}</div>
    </div>
  );
}
