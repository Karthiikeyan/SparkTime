import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { CourseCard } from "@/components/ui/cards";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPills } from "@/components/ui/pill";
import { PageHeader } from "@/components/ui/page-header";
import { absoluteUrl } from "@/lib/content/paths";
import { splitCourseTitle } from "@/lib/courses";
import { firstSentence } from "@/lib/home";
import { breadcrumbSchema, graph, itemListSchema, webPageSchema } from "@/lib/seo/json-ld";
import type { SeriesSummary } from "@/server/services/public-content";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * /course: every free course as a card, filtered by topic with plain links
 * (?topic=career), so the filter works without JavaScript. The counts are
 * the courses' own: courses listed and the lessons in them.
 */
export function CoursesIndex({ courses, all, topic, path, siteUrl, startHereHref }: { courses: SeriesSummary[]; all: SeriesSummary[]; topic: string | null; path: string; siteUrl: string; startHereHref: string | null }) {
  const topics = new Map<string, { name: string; slug: string; count: number }>();
  for (const c of all) {
    const t = c.primaryCategory;
    if (t) topics.set(t.slug, { name: t.name, slug: t.slug, count: (topics.get(t.slug)?.count ?? 0) + 1 });
  }
  const filters = [
    { label: "All", count: all.length, href: path, current: !topic },
    ...[...topics.values()].map((t) => ({ label: t.name, count: t.count, href: `${path}?topic=${t.slug}`, current: topic === t.slug })),
  ];
  const lessons = all.reduce((n, c) => n + c.parts, 0);
  const url = absoluteUrl(siteUrl, path);
  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl, url, name: "Courses", description: "Free courses, read in order.", type: "CollectionPage" }),
          breadcrumbSchema([
            { name: "Home", url: siteUrl },
            { name: "Courses", url },
          ]),
          itemListSchema("Courses", all.map((c) => ({ name: c.title, url: absoluteUrl(siteUrl, c.path) }))),
        )}
      />
      <PageHeader
        eyebrow="Free courses"
        title="Courses"
        lede="Structured paths you read in order, start to finish. Every lesson has exercises, and every course is free with no sign-up."
        meta={`${plural(all.length, "course")} · ${plural(lessons, "lesson")}`}
      />
      <section aria-label="Courses" className="container-page pb-8 pt-8 sm:pt-12">
        {filters.length > 2 && <FilterPills label="Filter by topic" items={filters} className="mb-6 sm:mb-8" />}
        {courses.length ? (
          <ul className="grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(21.25rem,1fr))] sm:gap-6">
            {courses.map((c) => (
              <li key={c.id}>
                <CourseCard course={{ path: c.path, title: splitCourseTitle(c.title).title, topic: c.primaryCategory, oneLiner: firstSentence(c.excerpt), lessons: c.parts, minutes: c.minutes }} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No courses yet">
            <p>
              Check back soon, or <Link href="/library" className="font-semibold text-accent-ink underline underline-offset-4">browse the library</Link>.
            </p>
          </EmptyState>
        )}
      </section>
      {startHereHref && (
        <section className="container-page pb-16 pt-6 sm:pb-24">
          <div className="flex flex-wrap items-center justify-between gap-5 rounded-lg bg-bg-tint px-6 py-7 sm:px-9 sm:py-8">
            <div>
              <p className="font-serif text-[1.5rem] font-medium leading-tight sm:text-[1.75rem]">Not sure which one to start with?</p>
              <p className="mt-1.5 text-ink-2">Pick your goal and get a suggested order.</p>
            </div>
            <Link href={startHereHref} className="inline-flex min-h-12 items-center rounded-[8px] bg-accent px-5.5 font-semibold text-accent-contrast transition-colors hover:bg-accent-hover">
              Start here →
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
