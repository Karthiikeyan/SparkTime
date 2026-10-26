import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { ActionLinks, ArchivedNotice, AudienceBar, FactsList } from "@/components/content/document-parts";
import { DocContent } from "@/components/content/renderer";
import { AuthorAvatar } from "@/components/ui/author-card";
import { Band } from "@/components/ui/band";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { CourseCard } from "@/components/ui/cards";
import { TagLink, TagList } from "@/components/ui/pill";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatRow, type Stat } from "@/components/ui/stat-row";
import { cn } from "@/lib/cn";
import { categoryPath, tagPath, typeIndexPath } from "@/lib/content/paths";
import { minutesLabel, splitCourseBody, splitCourseTitle, type CourseModule, type CourseSection } from "@/lib/courses";
import { hoursLabel } from "@/lib/home";
import type { Doc } from "@/lib/content/blocks";
import type { DocumentPageData } from "@/server/services/document-page";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pad = (n: number) => String(n).padStart(2, "0");

/** A few lines of the course's own text, in a card of the side column. */
function Side({ section, tone = "plain" }: { section: CourseSection; tone?: "plain" | "warn" }) {
  const doc = { type: "doc", content: section.nodes } as Doc;
  return (
    <div className={cn("rounded-lg p-5 sm:p-6", tone === "warn" ? "bg-warn-tint" : "border border-line bg-surface")}>
      <h2 className={cn("text-base font-bold", tone === "warn" && "text-warn-text")}>{section.heading}</h2>
      <div className="mt-2.5">
        <DocContent doc={doc} context={{ refs: new Map(), media: new Map() }} className="text-[0.9375rem] leading-relaxed [&>*]:mx-0 [&_li+li]:mt-1" />
      </div>
    </div>
  );
}

function Lesson({ lesson }: { lesson: CourseModule["lessons"][number] }) {
  return (
    <li>
      <Link href={lesson.path} className="grid min-h-14 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-line-soft px-5 py-3.5 transition-colors hover:bg-bg sm:px-[22px] sm:py-4">
        <span className="font-mono text-[0.8125rem] text-muted">{pad(lesson.number)}</span>
        <span className="text-base font-medium leading-snug sm:text-[1.0625rem]">{lesson.title}</span>
        <span className="whitespace-nowrap text-sm text-muted">{lesson.minutes} min</span>
      </Link>
    </li>
  );
}

/** Modules as native disclosures: the first two open, the rest one line each. They work without JavaScript. */
function Curriculum({ modules, lessons, minutes }: { modules: CourseModule[]; lessons: number; minutes: number }) {
  const flat = modules.length === 1 && !modules[0]!.name;
  return (
    <section id="curriculum" aria-labelledby="curriculum-heading" className="min-w-0 scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 id="curriculum-heading" className="font-serif text-[2rem] font-medium leading-tight tracking-[-0.02em] sm:text-[2.5rem]">
          Curriculum
        </h2>
        <p className="text-sm text-muted">
          {!flat && `${plural(modules.length, "module")} · `}
          {plural(lessons, "lesson")}
          {minutes > 0 && ` · about ${hoursLabel(minutes)}`}
        </p>
      </div>
      <div className="mt-5 space-y-3">
        {flat ? (
          <ol className="overflow-hidden rounded-lg border border-line bg-surface">
            {modules[0]!.lessons.map((l) => (
              <Lesson key={l.id} lesson={l} />
            ))}
          </ol>
        ) : (
          modules.map((m, i) => (
            <details key={m.key} open={i < 2} className="group overflow-hidden rounded-lg border border-line bg-surface">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 sm:px-[22px] sm:py-[18px] [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-[0.8125rem] font-semibold text-accent-ink">Module {m.number}</span>
                  <span className="mt-0.5 block font-serif text-[1.375rem] font-medium leading-tight sm:text-2xl">{m.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-muted">
                  <span className="hidden sm:inline">
                    {plural(m.lessons.length, "lesson")}
                    {m.minutes > 0 && ` · ${minutesLabel(m.minutes)}`}
                  </span>
                  <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <ol className="border-t border-line-soft [&>li:last-child_a]:border-b-0">
                {m.lessons.map((l) => (
                  <Lesson key={l.id} lesson={l} />
                ))}
              </ol>
            </details>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * A course's own page: a hero with the course's name, what it is and how to
 * start, the curriculum by module, what the author says to expect, and other
 * free courses. Counts, hours and lesson numbers come from the course's
 * entries; the course's projects are not structured data, so the page doesn't
 * promise any.
 */
export function CoursePage({ data }: { data: DocumentPageData }) {
  const { doc, courseOverview: course } = data;
  if (!course) return null;
  const { title, subtitle } = splitCourseTitle(doc.title);
  const topic = doc.categories[0];
  const body = splitCourseBody(doc.content);
  const sections = (kind: CourseSection["kind"]) => body.sections.filter((s) => s.kind === kind && s.nodes.length > 0);
  const rest = [...(body.intro.length ? [{ heading: "", kind: "other" as const, nodes: body.intro }] : []), ...sections("other")];
  const stats: Stat[] = [
    { value: course.lessons, label: course.lessons === 1 ? "lesson" : "lessons" },
    ...(course.modules.length > 1 && course.modules[0]!.name ? [{ value: course.modules.length, label: "modules" }] : []),
    ...(course.minutes > 0 ? [{ value: hoursLabel(course.minutes), label: "of reading" }] : []),
  ].filter((s) => s.value);
  const typePath = typeIndexPath(doc.fullType);
  const side = [...sections("expect"), ...sections("lessons")];
  const limits = sections("limits");

  return (
    <article>
      <header className="border-b border-line">
        <div className="container-page pb-10 pt-8 sm:pb-14 sm:pt-12">
          <Breadcrumbs items={[{ label: doc.fullType.pluralName, href: typePath }, { label: title, href: doc.path }]} className="mb-5 sm:mb-7" />
          {doc.status === "archived" && <ArchivedNotice />}
          <p className="caps text-accent-ink">{["Free course", topic?.name].filter(Boolean).join(" · ")}</p>
          <h1 className="t-page mt-2.5 max-w-[56rem] sm:mt-3">{title}</h1>
          {subtitle && <p className="mt-3.5 max-w-[44rem] font-serif text-[1.25rem] leading-snug text-ink-2 sm:text-2xl">{subtitle}</p>}
          {doc.excerpt && <p className="mt-4 max-w-[40rem] text-[1.0625rem] leading-relaxed text-ink-2 sm:mt-5 sm:text-lg">{doc.excerpt}</p>}
          <div className="mt-6 flex flex-wrap gap-3 sm:mt-7">
            {course.first && (
              <Link href={course.first.path} className="inline-flex min-h-13 items-center rounded-[8px] bg-accent px-6 text-base font-semibold text-accent-contrast transition-colors hover:bg-accent-hover">
                Start lesson 1 →
              </Link>
            )}
            <a href="#curriculum" className="inline-flex min-h-13 items-center rounded-[8px] border border-line-strong bg-surface px-5.5 text-base font-semibold text-ink transition-colors hover:border-line-field">
              See all {plural(course.lessons, "lesson")}
            </a>
          </div>
          <StatRow items={stats} size="md" className="mt-8 max-w-[44rem] sm:mt-10" />
        </div>
      </header>

      <div className="container-page flex flex-col gap-10 pb-14 pt-10 sm:pb-20 sm:pt-14 lg:flex-row lg:items-start lg:gap-14">
        <div className="min-w-0 flex-1 space-y-12 lg:flex-[1_1_37rem]">
          <Curriculum modules={course.modules} lessons={course.lessons} minutes={course.minutes} />
          {rest.length > 0 && (
            <section aria-label="About this course" className="space-y-8">
              {rest.map((s, i) => (
                <div key={i}>
                  {s.heading && <h2 className="font-serif text-[1.625rem] font-medium leading-tight sm:text-[2rem]">{s.heading}</h2>}
                  <DocContent doc={{ type: "doc", content: s.nodes } as Doc} context={{ refs: data.refs, media: data.media }} className={cn("[&>*]:mx-0", s.heading && "mt-4")} />
                </div>
              ))}
            </section>
          )}
        </div>

        <aside aria-label="About this course" className="flex min-w-0 flex-col gap-5 lg:w-[21.25rem] lg:shrink-0">
          <AudienceBar doc={doc} />
          <ActionLinks doc={doc} media={data.media} />
          <FactsList doc={doc} refs={data.refs} media={data.media} className="grid-cols-2 rounded-lg border border-line bg-surface p-5" />
          {side.map((s) => (
            <Side key={s.heading} section={s} />
          ))}
          {limits.map((s) => (
            <Side key={s.heading} section={s} tone="warn" />
          ))}
          {(doc.categories.length > 0 || doc.tags.length > 0) && (
            <div>
              <p className="caps mb-2.5 text-muted">Filed under</p>
              <TagList>
                {doc.categories.map((c) => (
                  <li key={c.id}>
                    <TagLink href={categoryPath(c.slug)}>{c.name}</TagLink>
                  </li>
                ))}
                {doc.tags.map((t) => (
                  <li key={t.id}>
                    <TagLink href={tagPath(t.slug)}>#{t.name}</TagLink>
                  </li>
                ))}
              </TagList>
            </div>
          )}
          <div className="flex items-center gap-3.5 rounded-lg border border-line bg-surface p-5">
            <AuthorAvatar size={52} alt="" className="size-[3.25rem]" />
            <div>
              <p className="caps text-xs text-muted">Written by</p>
              <Link href="/about" rel="author" className="font-serif text-xl font-medium">
                {data.authorName}
              </Link>
              <p className="sr-only">{data.authorSummary}</p>
            </div>
          </div>
        </aside>
      </div>

      {course.more.length > 0 && (
        <Band labelledBy="more-courses">
          <SectionHeading id="more-courses" size="md" title="More free courses" link={{ href: typePath, label: "All courses →" }} />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {course.more.map((c) => (
              <li key={c.id}>
                <CourseCard size="sm" showStart={false} course={{ path: c.path, title: splitCourseTitle(c.title).title, topic: c.primaryCategory, lessons: c.parts, minutes: c.minutes }} />
              </li>
            ))}
          </ul>
        </Band>
      )}
    </article>
  );
}
