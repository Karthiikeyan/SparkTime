import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { DocContent } from "@/components/content/renderer";
import { MediaImage } from "@/components/content/media-image";
import { PartsRibbon } from "@/components/content/editorial";
import {
  ActionLinks,
  ArchivedNotice,
  AudienceBar,
  Breadcrumbs,
  Byline,
  Connections,
  ContinueExploring,
  docCrumbs,
  NextStep,
  FactsList,
  Passages,
  PlaceLine,
  PrevNext,
  propertyString,
  SeriesLine,
  SeriesNav,
  SourceLine,
  Sources,
  Takeaways,
  TaxonomyChips,
  TypeEyebrow,
} from "@/components/content/document-parts";
import { YouTubePlayer } from "@/components/content/islands/youtube-player";
import { CompanyPage, RoleGuide } from "./interview";
import { CoursePage } from "./course-page";
import { SystemLayout } from "@/components/pages/system-page";
import { ReadingTemplate } from "./reading";
import { ReadingLayout } from "@/components/content/reading-layout";
import { ContentAnalytics } from "@/components/analytics/content-analytics";
import { JsonLd } from "@/components/seo/json-ld";
import { AuthorCard } from "@/components/ui/author-card";
import { formatDateOnly, formatPeriod } from "@/lib/dates";
import type { Template } from "@/lib/content/model";
import { categoryPath } from "@/lib/content/paths";
import { OUTLINE_MIN_WORDS, readingOutline } from "@/lib/content/outline";
import { labelFor } from "@/lib/content/properties";
import { parseYouTubeId } from "@/lib/embeds";
import { firstSentence } from "@/lib/home";
import type { DocumentPageData } from "@/server/services/document-page";

/**
 * Chooses the presentation template for a document. Templates are a fixed,
 * allowlisted set of React components; a content type only *selects* one.
 */
export function DocumentView({ data, preview = false }: { data: DocumentPageData; preview?: boolean }) {
  const { template, doc } = data;
  return (
    <>
      {!preview && <JsonLd data={data.jsonLd} />}
      {!preview && (
        <ContentAnalytics type={doc.type.slug} slug={doc.slug} title={doc.title} longRead={READING_TEMPLATES.has(template) && doc.wordCount >= OUTLINE_MIN_WORDS} />
      )}
      {template === "editorial" && <ReadingTemplate data={data} />}
      {template === "project" && <ProjectTemplate data={data} />}
      {template === "media" && <MediaTemplate data={data} />}
      {template === "resource" && <ResourceTemplate data={data} />}
      {template === "story" && <StoryTemplate data={data} />}
      {template === "collection" && (data.courseOverview ? <CoursePage data={data} /> : <CollectionTemplate data={data} />)}
      {template === "minimal" && (doc.fullType.routing === "root" ? <SystemLayout doc={doc} refs={data.refs} media={data.media} /> : <MinimalTemplate data={data} />)}
      {template === "interview" && <InterviewTemplate data={data} />}
    </>
  );
}

/** Long-form templates (those built on ReadingLayout); a long piece in one is a "long read" for reading progress. */
const READING_TEMPLATES: ReadonlySet<Template> = new Set(["editorial", "project", "story", "minimal"]);

function Title({ children, size = "headline" }: { children: React.ReactNode; size?: "display" | "headline" | "title" }) {
  const cls = size === "display" ? "t-display" : size === "title" ? "t-title" : "t-headline";
  return <h1 className={`${cls} mt-4`}>{children}</h1>;
}

function Lead({ text }: { text: string }) {
  if (!text) return null;
  return <p className="t-deck mt-5 max-w-2xl">{text}</p>;
}

/**
 * The author card only where it's true: essays and chapters are written, projects
 * are built. A page about someone else's tool, a collection, a video or a
 * three-line note already names its author in the byline, or has none.
 */
const AUTHOR_LABEL: Partial<Record<Template, string>> = { editorial: "Written by", story: "Written by", project: "Built by" };

/**
 * After the piece: who wrote it, then the most natural next step first — the
 * series' next part, an invitation (a talk) or SparkTribe (a career piece),
 * explicit connections, then recommendations named for the section.
 */
function Footer({ data, noun }: { data: DocumentPageData; noun: string }) {
  const { doc } = data;
  const authorLabel = AUTHOR_LABEL[data.template];
  const isTalk = data.template === "media" && doc.fullType.fields.some((f) => f.role === "eventName");
  const primary = doc.categories[0];
  const more = primary ? { label: `More in ${primary.name}`, href: categoryPath(primary.slug) } : { label: "The whole library", href: "/library" };
  return (
    <>
      <div className="container-narrow mt-14 space-y-10">
        <TaxonomyChips doc={doc} />
        {/* In a series, the way on is the series' own order, not whatever was published next. */}
        {data.series && <SeriesNav series={data.series} />}
        {authorLabel && <AuthorCard name={data.authorName} headline={firstSentence(data.authorSummary)} label={authorLabel} />}
        {isTalk && <SpeakingInvite />}
        {data.sparktribe && !isTalk && <SparkTribeNext {...data.sparktribe} />}
        <Connections outgoing={data.outgoing} incoming={data.incoming} collections={data.collections} />
        {!data.series && <PrevNext previous={data.previous} next={data.next} noun={noun} />}
      </div>
      {data.recommendations.length > 0 && (
        <div className="container-page mt-20">
          <ContinueExploring items={data.recommendations} heading="Read next" more={more} />
        </div>
      )}
    </>
  );
}

function SparkTribeNext({ title, excerpt, path, url }: NonNullable<DocumentPageData["sparktribe"]>) {
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

// ---------------------------------------------------------------------------
// Project — case study with a facts sidebar
// ---------------------------------------------------------------------------

function ProjectTemplate({ data }: { data: DocumentPageData }) {
  const { doc } = data;
  return (
    <article>
      <header className="container-page pt-10 sm:pt-14">
        <Breadcrumbs items={docCrumbs(doc, data.section)} currentLast={false} />
        {doc.status === "archived" && <ArchivedNotice />}
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <TypeEyebrow doc={doc} />
            <Title>{doc.title}</Title>
            <Lead text={doc.excerpt} />
            <SeriesLine series={data.series} className="mt-4" />
            {/* data-analytics: clicks here are counted as project_link_click (src/lib/analytics.ts). */}
            <div className="mt-7" data-analytics="project">
              <ActionLinks doc={doc} media={data.media} />
            </div>
          </div>
          <aside className="lg:col-span-4 lg:pt-10" aria-label="Project facts">
            <FactsList doc={doc} refs={data.refs} media={data.media} className="grid-cols-2 border-t border-line pt-5 lg:grid-cols-1" />
          </aside>
        </div>
      </header>
      {doc.image && (
        <figure className="container-page mt-12">
          <MediaImage asset={doc.image} priority sizes="(min-width: 1216px) 1152px, 100vw" className="rounded-md border border-line" />
        </figure>
      )}
      <ReadingLayout
        outline={readingOutline(data.headings, doc.wordCount)}
        wordCount={doc.wordCount}
        container="container-narrow"
        narrow
        className="mt-12"
        columnClassName="space-y-8"
        lead={
          <>
            <AudienceBar doc={doc} />
            <Passages doc={doc} />
            <Takeaways doc={doc} label="Highlights" />
          </>
        }
      >
        <DocContent doc={doc.content} context={{ refs: data.refs, media: data.media }} />
        <Sources doc={doc} />
      </ReadingLayout>
      <Footer data={data} noun="projects" />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Media — video/talk first
// ---------------------------------------------------------------------------

const EVENT_ROLES = ["eventName", "eventDate", "location"] as const;

/** A talk's natural next step for an organiser. */
function SpeakingInvite() {
  return (
    <NextStep
      eyebrow="Organising an event?"
      title="I’d be glad to hear about it."
      action={
        <>
          <Link href="/about#speaking" className="btn btn-ghost">
            What I speak about
          </Link>
          <Link href="/contact?reason=Speaking" className="btn btn-primary">
            Invite me to speak
          </Link>
        </>
      }
    />
  );
}

function MediaTemplate({ data }: { data: DocumentPageData }) {
  const { doc } = data;
  const videoId = parseYouTubeId(propertyString(doc, "videoUrl"));
  const transcript = propertyString(doc, "transcript");
  const eventName = propertyString(doc, "eventName");
  const eventDate = propertyString(doc, "eventDate");
  const location = propertyString(doc, "location");
  return (
    <article>
      <div className="container-page pt-10 sm:pt-14">
        <Breadcrumbs items={docCrumbs(doc, data.section)} currentLast={false} />
        {doc.status === "archived" && <ArchivedNotice />}
        {videoId ? (
          <YouTubePlayer videoId={videoId} title={doc.title} />
        ) : doc.image ? (
          <MediaImage asset={doc.image} priority sizes="(min-width: 1216px) 1152px, 100vw" className="rounded-md" />
        ) : null}
      </div>
      <header className="container-narrow mt-10">
        <TypeEyebrow doc={doc} />
        <Title size="title">{doc.title}</Title>
        {(eventName || eventDate || location) && (
          <p className="mt-3 text-muted">
            {[eventName, eventDate ? formatDateOnly(eventDate) : null, location].filter(Boolean).join(" · ")}
          </p>
        )}
        <Lead text={doc.excerpt} />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <Byline doc={doc} authorName={data.authorName} />
          <ActionLinks doc={doc} media={data.media} />
        </div>
        <SeriesLine series={data.series} className="mt-3" />
      </header>
      <div className="container-narrow mt-10 space-y-8">
        {/* The event line above already says where and when. */}
        <FactsList doc={doc} refs={data.refs} media={data.media} omitRoles={EVENT_ROLES} className="grid-cols-2 border-y border-line py-5 sm:grid-cols-3" />
        <AudienceBar doc={doc} />
        <Passages doc={doc} />
        <Takeaways doc={doc} />
        <DocContent doc={doc.content} context={{ refs: data.refs, media: data.media }} />
        {transcript && (
          <details className="rounded-md border border-line px-5 py-4">
            <summary className="cursor-pointer font-medium">Transcript</summary>
            <div className="mt-4 max-h-[32rem] overflow-y-auto whitespace-pre-line text-[0.95rem] leading-relaxed text-muted">{transcript}</div>
          </details>
        )}
        <Sources doc={doc} />
      </div>
      <Footer data={data} noun={doc.type.pluralName.toLowerCase()} />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Resource — a useful thing to go and use
// ---------------------------------------------------------------------------

function ResourceTemplate({ data }: { data: DocumentPageData }) {
  const { doc } = data;
  return (
    <article>
      <header className="container-narrow pt-10 sm:pt-14">
        <Breadcrumbs items={docCrumbs(doc, data.section)} currentLast={false} />
        {doc.status === "archived" && <ArchivedNotice />}
        <TypeEyebrow doc={doc} />
        <Title size="title">{doc.title}</Title>
        <Lead text={doc.excerpt} />
        <SeriesLine series={data.series} className="mt-4" />
        <div className="mt-7">
          <ActionLinks doc={doc} media={data.media} />
        </div>
      </header>
      <div className="container-narrow mt-10 space-y-8">
        <FactsList doc={doc} refs={data.refs} media={data.media} className="grid-cols-2 border-y border-line py-5 sm:grid-cols-3" />
        <AudienceBar doc={doc} />
        <Passages doc={doc} />
        <DocContent doc={doc.content} context={{ refs: data.refs, media: data.media }} />
      </div>
      <Footer data={data} noun="resources" />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Story — a chapter with a period, turning points and lessons
// ---------------------------------------------------------------------------

/** Shown in the story header, so not repeated in its facts. */
const STORY_HEADER_ROLES = ["period", "startDate", "endDate", "projectStatus"] as const;

function StoryTemplate({ data }: { data: DocumentPageData }) {
  const { doc, place } = data;
  const periodLabel = propertyString(doc, "period") || formatPeriod(propertyString(doc, "startDate"), propertyString(doc, "endDate"));
  const statusField = doc.fullType.fields.find((f) => f.role === "projectStatus");
  const statusValue = propertyString(doc, "projectStatus");
  const status = statusValue ? labelFor(statusField?.options.choices, statusValue) : null;
  return (
    <article>
      <header className="container-narrow pt-10 sm:pt-14">
        <Breadcrumbs items={docCrumbs(doc, data.section)} currentLast={false} />
        {doc.status === "archived" && <ArchivedNotice />}
        {(periodLabel || status) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm tracking-wide text-accent">
            {periodLabel}
            {status && <span className="rounded-xs border border-line px-1.5 py-0.5 text-[11px] uppercase tracking-wider text-muted">{status}</span>}
          </p>
        )}
        <Title>{doc.title}</Title>
        <Lead text={doc.excerpt} />
        {data.series ? <SeriesLine series={data.series} className="mt-4" /> : place && <PlaceLine {...place} className="mt-4" />}
      </header>
      {doc.image && (
        <figure className="container-narrow mt-10">
          <MediaImage asset={doc.image} priority sizes="(min-width: 768px) 720px, 100vw" className="rounded-md" />
        </figure>
      )}
      <ReadingLayout
        outline={readingOutline(data.headings, doc.wordCount)}
        wordCount={doc.wordCount}
        container="container-narrow"
        narrow
        className="mt-10"
        columnClassName="space-y-8"
        // The framing first — a hypothesis and its result, a turning point — then the story.
        lead={<Passages doc={doc} className="rounded-md border border-line bg-surface p-5 sm:p-6" />}
      >
        <DocContent doc={doc.content} context={{ refs: data.refs, media: data.media }} serif />
        <FactsList doc={doc} refs={data.refs} media={data.media} omitRoles={STORY_HEADER_ROLES} className="border-t border-line pt-6 sm:grid-cols-2" />
        <Takeaways doc={doc} label="Lessons" />
      </ReadingLayout>
      <Footer data={data} noun="chapters" />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Collection — curated, ordered, grouped
// ---------------------------------------------------------------------------

function CollectionTemplate({ data }: { data: DocumentPageData }) {
  const { doc, entries } = data;
  const groups: Array<{ label: string; items: typeof entries }> = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.label === entry.groupLabel) last.items.push(entry);
    else groups.push({ label: entry.groupLabel, items: [entry] });
  }
  let counter = 0;
  const isCourse = doc.fullType.schemaType === "Course";
  const noun = isCourse ? (entries.length === 1 ? "lesson" : "lessons") : entries.length === 1 ? "part" : "parts";
  const minutes = entries.reduce((sum, e) => sum + (e.card.readingMinutes || 0), 0);
  const first = entries[0]?.card;
  return (
    <article>
      <header className="container-page pt-10 sm:pt-14">
        <div className="grid gap-10 border-b border-line pb-10 lg:grid-cols-12 lg:items-end lg:gap-12">
          <div className={doc.image ? "lg:col-span-7" : "lg:col-span-9"}>
            <Breadcrumbs items={docCrumbs(doc, data.section)} currentLast={false} />
            {doc.status === "archived" && <ArchivedNotice />}
            <TypeEyebrow doc={doc} />
            <Title size="display">{doc.title}</Title>
            <Lead text={doc.excerpt} />
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
              {first && (
                <Link href={first.path} className="btn btn-primary">
                  Start with {isCourse ? "lesson" : "part"} 1 <ArrowRight size={16} aria-hidden="true" />
                </Link>
              )}
              <p className="meta font-mono tabular-nums">
                {entries.length} {noun}
                {minutes > 0 && ` · ${minutes >= 90 ? `${Math.round(minutes / 60)} h` : `${minutes} min`} of reading`}
              </p>
            </div>
            <PartsRibbon parts={entries.length} className="mt-5" />
            <div className="mt-6">
              <ActionLinks doc={doc} media={data.media} />
            </div>
          </div>
          {doc.image && (
            <div className="lg:col-span-5">
              <MediaImage asset={doc.image} priority sizes="(min-width: 1024px) 480px, 100vw" className="rounded-xs" />
            </div>
          )}
        </div>
      </header>
      <div className="container-narrow mt-10 space-y-10">
        <AudienceBar doc={doc} />
        <FactsList doc={doc} refs={data.refs} media={data.media} className="grid-cols-2 border-y border-line py-5 sm:grid-cols-3" />
        <Passages doc={doc} />
        <DocContent doc={doc.content} context={{ refs: data.refs, media: data.media }} />
        {groups.length > 0 && !groups[0]!.label && (
          <div className="section-rule">
            <h2>In this {isCourse ? "course" : "series"}</h2>
          </div>
        )}
        {groups.length === 0 ? (
          <p className="border-y border-line py-8 text-center text-muted">The first parts are on their way.</p>
        ) : (
          groups.map((group, gi) => (
            <section key={gi} aria-label={group.label || undefined}>
              {group.label && (
                <div className="section-rule">
                  <h2>{group.label}</h2>
                </div>
              )}
              <ol>
                {group.items.map((entry) => {
                  counter += 1;
                  const { card } = entry;
                  return (
                    <li key={card.id} className="group relative grid grid-cols-[3.25rem_1fr] gap-x-4 border-b border-line py-6 last:border-b-0">
                      <span className="font-serif text-3xl leading-none tabular-nums text-accent-ink" aria-hidden="true">
                        {String(counter).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <h3 className="t-story">
                          <Link href={card.path} className="story-link after:absolute after:inset-0">
                            <span className="sr-only">{isCourse ? "Lesson" : "Part"} {counter}: </span>
                            {card.title}
                          </Link>
                        </h3>
                        {(entry.note || card.excerpt) && <p className="mt-2 line-clamp-2 text-[0.9375rem] leading-relaxed text-muted">{entry.note || card.excerpt}</p>}
                        {card.readingMinutes > 1 && <p className="meta mt-2">{card.readingMinutes} min read</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}
      </div>
      <Footer data={data} noun="collections" />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Minimal — just the words
// ---------------------------------------------------------------------------

function MinimalTemplate({ data }: { data: DocumentPageData }) {
  const { doc } = data;
  return (
    <article>
      <header className="container-narrow pt-10 sm:pt-14">
        {doc.fullType.routing === "type" && <Breadcrumbs items={docCrumbs(doc, data.section)} currentLast={false} />}
        {doc.status === "archived" && <ArchivedNotice />}
        {doc.fullType.routing === "type" && <TypeEyebrow doc={doc} />}
        <Title size="title">{doc.title}</Title>
        {doc.fullType.routing === "type" && (
          <div className="mt-5">
            <Byline doc={doc} authorName={data.authorName} />
          </div>
        )}
        {doc.fullType.routing === "type" && <SeriesLine series={data.series} className="mt-3" />}
      </header>
      {/* Most notes are a few lines and stay just the words; a long, sectioned one gets the outline. */}
      <ReadingLayout outline={readingOutline(data.headings, doc.wordCount)} wordCount={doc.wordCount} container="container-narrow" narrow className="mt-8" columnClassName="space-y-8">
        <DocContent doc={doc.content} context={{ refs: data.refs, media: data.media }} />
        <SourceLine doc={doc} />
        <FactsList doc={doc} refs={data.refs} media={data.media} className="border-t border-line pt-6 sm:grid-cols-2" />
        <Passages doc={doc} className="border-t border-line pt-6" />
      </ReadingLayout>
      {doc.fullType.routing === "type" && <Footer data={data} noun={doc.type.pluralName.toLowerCase()} />}
    </article>
  );
}

/**
 * Interview Experiences: a company's page (no role) or a role's page, see
 * templates/interview.tsx. No answers, no solutions. The way on is the
 * company's other pages and the courses beside it.
 */
function InterviewTemplate({ data }: { data: DocumentPageData }) {
  const facts = data.interview;
  if (!facts) return null;
  return facts.role ? (
    <RoleGuide data={data} facts={facts} directory={facts.directory} typePath={facts.typePath} sidebar={facts.sidebar} />
  ) : (
    <CompanyPage data={data} facts={facts} directory={facts.directory} sidebar={facts.sidebar} typePath={facts.typePath} />
  );
}
