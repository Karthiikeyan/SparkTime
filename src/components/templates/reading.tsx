import Link from "next/link";
import { CourseBar, CourseOutline, LessonPager, LessonStickyBar } from "@/components/content/course-parts";
import { ActionLinks, ArchivedNotice, FactsList, NextStep, Passages, REVIEW_ROLES, ReviewedItem, SeriesNav, Sources, propertyString } from "@/components/content/document-parts";
import { ActiveSection } from "@/components/content/islands/active-section";
import { MediaImage } from "@/components/content/media-image";
import { AtAGlance, ConnectedReading, KeepReading, KeyTakeaways, ReadingMeta, ShareBox } from "@/components/content/reading-parts";
import { DocContent } from "@/components/content/renderer";
import { AuthorCard } from "@/components/ui/author-card";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { TagLink, TagList } from "@/components/ui/pill";
import { TocDisclosure, TocRail } from "@/components/ui/toc";
import { cn } from "@/lib/cn";
import { intentLabel } from "@/lib/content/intent";
import { lessonTitle } from "@/lib/content/kind";
import { absoluteUrl, categoryPath, tagPath } from "@/lib/content/paths";
import { outlineIds, PROGRESS_MIN_WORDS, readingOutline } from "@/lib/content/outline";
import { firstSentence } from "@/lib/home";
import { siteUrl } from "@/server/env";
import type { DocumentPageData } from "@/server/services/document-page";
import { ArrowRight, ArrowUpRight } from "lucide-react";

/**
 * A piece to read in full: a lesson of a course (course bar, the course's
 * lessons on the left, the text, the outline on the right) or a standalone
 * guide (the text and the outline, with a share box). Everything is rendered
 * on the server; the only scripts are the copy buttons and the outline's
 * "you are here" marker.
 */
export function ReadingTemplate({ data }: { data: DocumentPageData }) {
  const { doc, course } = data;
  const lesson = course !== null;
  const outline = readingOutline(data.headings, doc.wordCount);
  const reviewItem = propertyString(doc, "itemName");
  const coverId = propertyString(doc, "coverImage");
  const hero = !lesson && doc.image && doc.image.id !== coverId ? doc.image : null;
  const topic = doc.categories[0];
  const intent = intentLabel(doc.type);
  const moduleName = course ? course.modules[course.moduleIndex]?.name : "";
  const url = absoluteUrl(siteUrl(), doc.path);
  const more = topic ? { label: `More in ${topic.name}`, href: categoryPath(topic.slug) } : { label: "The whole library", href: "/library" };

  const crumbs: Crumb[] = course
    ? [
        { label: course.typeName, href: course.typePath },
        { label: course.title, href: course.path },
        { label: `Lesson ${course.number}`, href: doc.path },
      ]
    : [...data.trail];
  const eyebrow = course ? `Lesson ${course.number}${moduleName ? ` · ${moduleName}` : ""}` : [intent ?? "Guide", topic?.name].filter(Boolean).join(" · ");

  return (
    <article>
      {doc.wordCount >= PROGRESS_MIN_WORDS && <div className="reading-progress" aria-hidden="true" />}
      {course && <CourseBar course={course} />}
      <div className={cn(lesson ? "container-wide" : "mx-auto w-full max-w-[68.75rem] px-4 sm:px-8", "pb-4 pt-8 sm:pt-12")}>
        <div className={cn(lesson ? "rail:grid rail:grid-cols-[15.5rem_minmax(0,1fr)_13.75rem] rail:gap-12" : "rail:grid rail:grid-cols-[minmax(0,1fr)_15rem] rail:gap-16")}>
          {course && (
            <aside aria-label="Lessons in this course" className="hidden rail:block">
              <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pb-4 pr-1">
                <CourseOutline course={course} scope="rail" />
              </div>
            </aside>
          )}

          <div className="min-w-0 max-w-[45rem]">
            <Breadcrumbs items={crumbs} currentLast={lesson} className="mb-5 sm:mb-7" />
            {doc.status === "archived" && <ArchivedNotice />}
            <p className="caps text-accent-ink">{eyebrow}</p>
            <h1 className="t-page-reading mt-2.5 sm:mt-3">{lesson ? lessonTitle(doc.title) : doc.title}</h1>
            {doc.excerpt && <p className="t-lede mt-4 sm:mt-[18px]">{doc.excerpt}</p>}
            <ReadingMeta doc={doc} authorName={data.authorName} standalone={!lesson} />
            {lesson ? <div className="hidden sm:block"><AtAGlance doc={doc} /></div> : <AtAGlance doc={doc} />}
            {outline && <TocDisclosure items={outline} className="mt-4" />}
            <KeyTakeaways doc={doc} />

            {hero && (
              <figure className="mt-8">
                <MediaImage asset={hero} priority sizes="(min-width: 1040px) 720px, 100vw" className="rounded-xl" />
                {hero.caption && <figcaption className="mt-2.5 text-sm text-muted">{hero.caption}</figcaption>}
              </figure>
            )}
            <div className="mt-8 space-y-6 sm:mt-10">
              <ReviewedItem doc={doc} media={data.media} />
              <FactsList doc={doc} refs={data.refs} media={data.media} omitRoles={REVIEW_ROLES} className="grid-cols-2 rounded-lg border border-line p-5 sm:grid-cols-3" />
              <Passages doc={doc} />
              {!reviewItem && !lesson && <ActionLinks doc={doc} media={data.media} />}
            </div>
            <div className="mt-8 sm:mt-10">
              <DocContent doc={doc.content} context={{ refs: data.refs, media: data.media }} className="[&>*]:mx-0" />
            </div>
            <Sources doc={doc} />

            <TagList label="Filed under" className="mt-10 border-t border-line pt-6">
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

            <div className="mt-8 space-y-6 sm:mt-10 sm:space-y-8">
              {course ? <LessonPager course={course} /> : data.series && <SeriesNav series={data.series} />}
              <AuthorCard name={data.authorName} headline={firstSentence(data.authorSummary)} />
              {data.sparktribe && <SparkTribeNote {...data.sparktribe} />}
              <ConnectedReading outgoing={data.outgoing} incoming={data.incoming} lesson={lesson} collections={data.collections} />
            </div>
          </div>

          {(outline || !lesson) && (
            <TocRail items={outline} className="mt-0">
              {!lesson && <ShareBox url={url} title={doc.title} />}
            </TocRail>
          )}
        </div>
      </div>
      <KeepReading items={data.recommendations} more={more} />
      {course && <LessonStickyBar course={course} />}
      {outline && <ActiveSection ids={outlineIds(outline)} />}
    </article>
  );
}

function SparkTribeNote({ title, excerpt, path, url }: NonNullable<DocumentPageData["sparktribe"]>) {
  return (
    <NextStep
      eyebrow="Preparing for placements?"
      title={`${title} is the path I wish I'd had.`}
      action={
        <>
          <Link href={path} className="btn btn-ghost">
            About {title} <ArrowRight size={15} aria-hidden="true" />
          </Link>
          {url && (
            <a href={url} className="btn btn-ghost" rel="noopener">
              Visit <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          )}
        </>
      }
    >
      {excerpt && <p className="mt-1 max-w-md text-sm text-muted">{excerpt}</p>}
    </NextStep>
  );
}

