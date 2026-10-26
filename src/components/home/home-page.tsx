import { Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { firstSentence, hoursLabel } from "@/lib/home";
import { siteConfig } from "@/lib/site-config";
import type { HomeCompany, HomeCourse, HomeData, HomeTopic } from "@/server/services/home";
import type { Card } from "@/server/services/public-content";

/**
 * The home page: what it is and a way in (search), the courses, the interview
 * experiences, the guide topics, what's new, and who writes it. The wording and
 * which bands show come from Studio → Settings → Home page, every count from
 * getHomeData(); a band with nothing to show is left out.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const sentenceCount = (n: number) => WORDS[n] ?? String(n);
/** "{courses}" in the courses intro: "Three free courses". */
const coursesPhrase = (n: number) => `${sentenceCount(n)} free ${n === 1 ? "course" : "courses"}`;

// No display here: each use sets its own, so a "hidden" never competes with "inline-flex".
const sectionLink = "min-h-11 items-center font-semibold text-accent-ink hover:underline hover:underline-offset-4";

function SectionHead({ id, title, intro, mobileIntro, link }: { id: string; title: string; intro?: string; mobileIntro?: string; link?: { href: string; label: string } | null }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 sm:mb-8">
      <div>
        <h2 id={id} className="t-section">
          {title}
        </h2>
        {intro && (
          <p className="mt-2 max-w-[39rem] text-[0.9375rem] text-muted sm:text-[1.0625rem]">
            {mobileIntro ? (
              <>
                <span className="sm:hidden">{mobileIntro}</span>
                <span className="hidden sm:inline">{intro}</span>
              </>
            ) : (
              intro
            )}
          </p>
        )}
      </div>
      {link && (
        <Link href={link.href} className={cn(sectionLink, "hidden sm:inline-flex")}>
          {link.label}
        </Link>
      )}
    </div>
  );
}

/** The section's "see all" link, under the cards on a phone. */
function MobileMore({ link }: { link: { href: string; label: string } | null }) {
  return link ? (
    <Link href={link.href} className={cn(sectionLink, "mt-2 inline-flex sm:hidden")}>
      {link.label}
    </Link>
  ) : null;
}

// ---------------------------------------------------------------------------

function Hero({ stats, popular, config }: Pick<HomeData, "stats" | "popular"> & { config: HomeData["config"]["hero"] }) {
  const items = [
    { value: stats.pieces, label: "guides and articles", short: "guides" },
    { value: stats.courses, label: `${stats.courses === 1 ? "free course" : "free courses"}${stats.lessons ? ` · ${plural(stats.lessons, "lesson")}` : ""}`, short: stats.courses === 1 ? "free course" : "free courses" },
    { value: stats.accounts, label: "real interview accounts", short: "interview accounts" },
    { value: stats.questions, label: "interview questions collected", short: "interview questions" },
  ].filter((s) => s.value > 0 && config.showStats);
  const placeholder = (stats.pieces ? config.searchPlaceholder.replace("{count}", String(stats.pieces)) : config.searchPlaceholder.replace(/\{count\}\s*/g, "")).trim();
  return (
    <section aria-labelledby="home-title" className="container-page pb-8 pt-10 sm:pb-16 sm:pt-16 lg:pb-18 lg:pt-24">
      {config.eyebrow && <p className="caps caps-lg text-accent-ink">{config.eyebrow}</p>}
      <h1 id="home-title" className="t-hero mt-3.5 max-w-[55rem] sm:mt-5">
        {config.headline}
      </h1>
      {config.subheadline && <p className="mt-4 max-w-[40rem] text-[1.0625rem] leading-relaxed text-ink-2 sm:mt-7 sm:text-xl">{config.subheadline}</p>}

      <form action="/search" method="get" role="search" className="mt-6 max-w-[45rem] sm:mt-10">
        <label htmlFor="hero-search" className="sr-only">
          Search the library
        </label>
        <div className="flex min-h-13 items-center gap-3 rounded-[12px] border border-line-field bg-surface pl-4 pr-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent sm:min-h-16 sm:pl-5">
          <Search size={20} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            id="hero-search"
            name="q"
            type="search"
            maxLength={120}
            autoComplete="off"
            placeholder={placeholder}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted sm:text-[1.0625rem]"
          />
          <button type="submit" className="hidden min-h-12 items-center rounded-[8px] bg-accent px-5.5 text-[0.9375rem] font-semibold text-accent-contrast transition-colors hover:bg-accent-hover sm:inline-flex">
            Search
          </button>
        </div>
      </form>

      {popular.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-sm sm:mt-4">
          <span aria-hidden="true" className="hidden shrink-0 text-muted sm:inline">
            Popular:
          </span>
          <ul aria-label="Popular" className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {popular.map((p) => (
              <li key={p.label} className="shrink-0">
                <Link href={p.href} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-line-strong bg-surface px-3 text-ink transition-colors hover:border-line-field">
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length > 0 && (
        <ul className="mt-7 grid grid-cols-2 border-t border-line sm:mt-16 lg:grid-cols-4 lg:border-b">
          {items.map((s, i) => (
            <li key={s.short} className={cn("border-b border-line py-4 lg:border-b-0 lg:py-6", i % 2 === 1 ? "border-l pl-4" : "pr-4", "lg:pr-6", i > 0 ? "lg:border-l lg:pl-6" : "lg:pl-0")}>
              <p className="font-serif text-[1.875rem] font-medium leading-none tabular-nums lg:text-[2.5rem]">{s.value}</p>
              <p className="mt-1 text-[0.8125rem] text-muted lg:mt-1.5 lg:text-sm">
                <span className="lg:hidden">{s.short}</span>
                <span className="hidden lg:inline">{s.label}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function topicTag(slug: string) {
  return slug === "technology" ? "bg-tech-tint text-tech-text" : "bg-accent-soft text-accent-ink";
}

function Courses({ courses, path, config }: { courses: HomeCourse[]; path: string | null; config: HomeData["config"]["courses"] }) {
  const link = path ? { href: path, label: config.linkLabel } : null;
  const intro = config.intro.replace("{courses}", coursesPhrase(courses.length));
  return (
    <section id="courses" aria-labelledby="home-courses" className="container-page pb-8 pt-4 sm:pb-18 sm:pt-12">
      <SectionHead id="home-courses" title={config.title} intro={intro} link={link} />
      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {courses.map((c) => (
          <li key={c.id}>
            <Link href={c.path} className="group flex h-full flex-col gap-2 rounded-[12px] border border-line bg-surface p-5 transition-colors hover:border-line-field sm:gap-4 sm:rounded-[14px] sm:p-8">
              {c.topic && <span className={cn("hidden self-start rounded-full px-2.5 py-1 text-[0.8125rem] font-semibold sm:inline-flex", topicTag(c.topic.slug))}>{c.topic.name}</span>}
              <span className="font-serif text-[1.375rem] font-medium leading-[1.2] sm:text-[1.75rem] sm:leading-[1.15]">{c.title}</span>
              {c.oneLiner && <span className="hidden text-base text-ink-2 sm:block">{c.oneLiner}</span>}
              <span className="mt-auto flex justify-between gap-4 border-line text-sm text-muted sm:border-t sm:pt-4">
                <span>
                  {plural(c.lessons, "lesson")}
                  {c.minutes > 0 && ` · ${hoursLabel(c.minutes)}`}
                </span>
                <span className="font-semibold text-accent-ink" aria-hidden="true">
                  Start →
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <MobileMore link={link} />
    </section>
  );
}

function CompanyCard({ company }: { company: HomeCompany }) {
  const roles = [...company.roles, ...(company.moreRoles ? ["more"] : [])].join(" · ");
  const mobileRoles = company.moreRoles ? plural(company.roleCount, "role") : company.roles.join(" · ");
  return (
    <Link href={company.href} className="flex h-full items-center gap-3.5 rounded-[12px] border border-line bg-surface p-4 transition-colors hover:border-line-field sm:flex-col sm:items-start sm:gap-3 sm:rounded-[14px] sm:p-7">
      <span className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-ink font-bold text-bg">
          {company.name.charAt(0).toUpperCase()}
        </span>
        <span className="hidden text-[1.375rem] font-semibold sm:inline">{company.name}</span>
      </span>
      <span className="flex min-w-0 flex-col sm:hidden">
        <span className="text-[1.0625rem] font-semibold">{company.name}</span>
        <span className="text-[0.8125rem] text-muted">{[mobileRoles, plural(company.accounts, "account")].filter(Boolean).join(" · ")}</span>
      </span>
      {roles && <span className="hidden text-[0.9375rem] text-ink-2 sm:block">{roles}</span>}
      <span className="hidden text-sm text-muted sm:block">
        {plural(company.accounts, "account")} · {plural(company.questions, "question")}
      </span>
    </Link>
  );
}

function Interviews({ companies, path, config }: { companies: HomeCompany[]; path: string | null; config: HomeData["config"]["interviews"] }) {
  const link = path ? { href: path, label: config.linkLabel } : null;
  const share = config.shareCard;
  return (
    <section id="interviews" aria-labelledby="home-interviews" className="border-y border-line bg-bg-tint">
      <div className="container-page py-8 sm:py-20">
        <SectionHead
          id="home-interviews"
          title={config.title}
          intro={config.intro}
          link={link}
        />
        <ul className="grid gap-2.5 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
          {companies.map((c) => (
            <li key={c.href}>
              <CompanyCard company={c} />
            </li>
          ))}
          {share.enabled && (
            <li className="hidden sm:block">
              <Link href={share.href} className="flex h-full flex-col justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-line-field p-7 transition-colors hover:bg-surface">
                <span className="text-lg font-semibold">{share.title}</span>
                {share.text && <span className="text-[0.9375rem] text-muted">{share.text}</span>}
                <span className="text-[0.9375rem] font-semibold text-accent-ink">{share.linkLabel}</span>
              </Link>
            </li>
          )}
        </ul>
        <MobileMore link={link} />
      </div>
    </section>
  );
}

function Topics({ topics, config }: { topics: HomeTopic[]; config: HomeData["config"]["topics"] }) {
  return (
    <section aria-labelledby="home-topics" className="container-page pb-6 pt-10 sm:pb-12 sm:pt-20">
      <SectionHead id="home-topics" title={config.title} />
      <ul className="grid border-t border-rule lg:grid-cols-3">
        {topics.map((t, i) => (
          <li key={t.path} className={cn("border-b border-line lg:border-b-0", i > 0 && "lg:border-l")}>
            <Link href={t.path} className={cn("group flex h-full flex-col gap-2.5 py-6 sm:py-7", i > 0 ? "lg:px-7" : "lg:pr-7")}>
              <span className="flex items-baseline justify-between gap-4">
                <span className="story-link font-serif text-[1.625rem] font-medium sm:text-[1.875rem]">{t.name}</span>
                <span className="text-sm tabular-nums text-muted">
                  {t.count}
                  <span className="sr-only"> pieces</span>
                </span>
              </span>
              {t.description && <span className="text-base text-ink-2">{t.description}</span>}
              {t.subtopics.length > 0 && <span className="text-sm text-muted">{t.subtopics.map((s) => s.name).join(" · ")}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Latest({ items, config }: { items: Card[]; config: HomeData["config"]["latest"] }) {
  const link = { href: "/library#index", label: config.linkLabel };
  return (
    <section aria-labelledby="home-latest" className="container-page pb-8 pt-8 sm:pb-20 sm:pt-12">
      <SectionHead id="home-latest" title={config.title} link={link} />
      <ol>
        {items.map((card) => {
          const meta = [card.primaryCategory?.name, card.readingMinutes > 0 && `${card.readingMinutes} min`].filter(Boolean).join(" · ");
          return (
            <li key={card.id} className="border-b border-line">
              <Link href={card.path} className="group grid gap-1 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-8 sm:gap-y-2 sm:py-6">
                <span className="story-link font-serif text-xl font-medium leading-tight sm:col-start-1 sm:row-start-1 sm:text-2xl">{card.title}</span>
                {meta && <span className="text-[0.8125rem] text-muted sm:col-start-2 sm:row-start-1 sm:whitespace-nowrap sm:pt-1.5 sm:text-sm">{meta}</span>}
                {card.excerpt && <span className="hidden text-base text-muted sm:col-start-1 sm:row-start-2 sm:line-clamp-2">{firstSentence(card.excerpt)}</span>}
              </Link>
            </li>
          );
        })}
      </ol>
      <MobileMore link={link} />
    </section>
  );
}

const external = { rel: "me noopener noreferrer", target: "_blank" } as const;

function AuthorAndTribe({ brand, author, tribe }: { brand: HomeData["brand"]; author: HomeData["config"]["author"]; tribe: HomeData["config"]["tribe"] }) {
  const summaryLead = firstSentence(brand.authorSummary);
  if (!author.enabled && !tribe.enabled) return null;
  return (
    <section aria-label="Who writes this" className="container-page">
      <div className={cn("grid gap-3 sm:gap-6", author.enabled && tribe.enabled && "lg:grid-cols-2")}>
        {author.enabled && (
        <div className="flex items-start gap-4 rounded-[12px] border border-line bg-surface p-5 sm:gap-7 sm:rounded-[14px] sm:p-9">
          <Image
            src={siteConfig.authorPhoto.src}
            width={siteConfig.authorPhoto.width}
            height={siteConfig.authorPhoto.height}
            alt={brand.author}
            sizes="(min-width: 640px) 112px, 64px"
            className="size-16 shrink-0 rounded-full bg-line object-cover object-[52%_35%] sm:size-28"
          />
          <div className="min-w-0 flex-1">
            <p className="caps text-[0.75rem] text-muted sm:text-[0.8125rem]">{author.label}</p>
            <p className="mt-0.5 font-serif text-[1.375rem] font-medium sm:mt-1.5 sm:text-[1.875rem]">{brand.author}</p>
            <p className="mt-1.5 text-sm text-ink-2 sm:mt-2.5 sm:text-base">
              <span className="sm:hidden">{summaryLead}</span>
              <span className="hidden sm:inline">{brand.authorSummary}</span>
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-4.5 text-sm font-semibold sm:mt-3 sm:text-[0.9375rem]">
              <li>
                <Link href="/about" className="inline-flex min-h-11 items-center text-accent-ink hover:underline">
                  About me<span className="sm:hidden">&nbsp;→</span>
                </Link>
              </li>
              {brand.social.map((s) => (
                <li key={s.id} className="hidden sm:block">
                  <a href={s.url} {...external} className="inline-flex min-h-11 items-center hover:text-muted">
                    {s.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
              {author.speakLabel && (
                <li className="hidden sm:block">
                  <Link href={author.speakHref} className="inline-flex min-h-11 items-center hover:text-muted">
                    {author.speakLabel}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </div>
        )}
        {tribe.enabled && (
          <div className="flex flex-col justify-between gap-2 rounded-[12px] border border-feature-border bg-feature p-5 text-feature-text sm:gap-5 sm:rounded-[14px] sm:p-9">
            <div>
              {tribe.eyebrow && <p className="caps hidden text-feature-muted sm:block">{tribe.eyebrow}</p>}
              <p className="font-serif text-[1.375rem] font-medium leading-tight sm:mt-2.5 sm:text-[1.875rem]">{tribe.heading}</p>
              {tribe.body && <p className="mt-1.5 text-sm text-feature-2 sm:mt-3 sm:text-base">{tribe.body}</p>}
            </div>
            <Link href={tribe.href} className="mt-2 inline-flex min-h-11 items-center self-start rounded-[8px] bg-feature-button px-4 text-sm font-semibold text-feature-button-text transition-opacity hover:opacity-90 sm:mt-0 sm:px-5 sm:text-[0.9375rem]">
              {tribe.buttonLabel}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

export function HomePage({ data }: { data: HomeData }) {
  const { config } = data;
  return (
    <>
      <Hero stats={data.stats} popular={data.popular} config={config.hero} />
      {config.courses.enabled && data.courses.length > 0 && <Courses courses={data.courses} path={data.coursesPath} config={config.courses} />}
      {config.interviews.enabled && data.companies.length > 0 && <Interviews companies={data.companies} path={data.interviewsPath} config={config.interviews} />}
      {config.topics.enabled && data.topics.length > 0 && <Topics topics={data.topics} config={config.topics} />}
      {config.latest.enabled && data.latest.length > 0 && <Latest items={data.latest} config={config.latest} />}
      <AuthorAndTribe brand={data.brand} author={config.author} tribe={config.tribe} />
    </>
  );
}
