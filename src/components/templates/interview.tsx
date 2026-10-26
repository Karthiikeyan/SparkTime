import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { ArchivedNotice } from "@/components/content/document-parts";
import { ActiveSection } from "@/components/content/islands/active-section";
import { DocContent } from "@/components/content/renderer";
import { CopyAiButton, PracticeCard, PracticeProvider, QuestionsPanel, type PracticeRound } from "@/components/interviews/practice";
import { Callout } from "@/components/ui/callout";
import { InitialTile } from "@/components/ui/cards";
import { DashedCta } from "@/components/ui/dashed-cta";
import { PageHeader } from "@/components/ui/page-header";
import { Toc } from "@/components/ui/toc";
import type { Crumb } from "@/components/ui/breadcrumbs";
import { kindOf } from "@/lib/content/kind";
import { companyAccounts, companyHref, type DirectoryCompany, type GuidePageLink, type InterviewFacts } from "@/lib/interviews/directory";
import { share, yearRange } from "@/lib/interviews/display";
import { CANDIDATE_REPORTED_NOTE, commonSequence, countCategories, DIFFICULTY_LABELS, type InterviewGuide } from "@/lib/interviews/guide";
import { siteConfig } from "@/lib/site-config";
import { hostnameOf } from "@/lib/url";
import type { DocumentPageData } from "@/server/services/document-page";
import type { InterviewSidebar } from "@/server/services/interviews";

/**
 * Interview Experiences pages (template "interview"):
 *
 *  - a role's page (company + role): what candidates reported about the
 *    process, then every round and its questions with filters, search and
 *    Copy for AI. The page a candidate keeps open before the interview.
 *  - a company's page (no role): its roles, and what the company publishes
 *    officially. The same view, without a document, is the page built from a
 *    company's published roles when it has no page of its own.
 *
 * Candidate-reported and official information are always visibly separate.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
const cardTitle = "font-serif text-[1.625rem] font-medium leading-tight sm:text-[2rem]";
const h2 = "font-serif text-[1.75rem] font-medium leading-tight tracking-[-0.02em] sm:text-4xl";

/** Inline counts under a header: bold numbers with their labels, and the years the accounts cover. */
function Counts({ items, years }: { items: Array<[number, string]>; years?: string }) {
  return (
    <p className="flex flex-wrap gap-x-7 gap-y-1.5 text-[0.9375rem] text-muted">
      {items
        .filter(([n]) => n > 0)
        .map(([n, label]) => (
          <span key={label}>
            <strong className="text-lg font-semibold text-ink">{n}</strong> {n === 1 ? label : label === "company" ? "companies" : `${label}s`}
          </span>
        ))}
      {years && <span>{years}</span>}
    </p>
  );
}

function Official({ company, notes }: { company: string; notes: InterviewGuide["official"] }) {
  if (!notes.length) return null;
  return (
    <section aria-labelledby="official-heading" className="rounded-lg border border-line bg-surface p-6 sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-full bg-tech-tint px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.06em] text-tech-text">Official</span>
        <h2 id="official-heading" className="font-serif text-[1.375rem] font-medium sm:text-[1.625rem]">
          What {company} publishes about its process
        </h2>
      </div>
      <div className="mt-4 space-y-4">
        {notes.map((o) => (
          <div key={o.url}>
            <p className="font-semibold">
              <a href={o.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-ink hover:underline">
                {o.title}
                <ArrowUpRight size={14} aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
            {o.points.length > 0 && (
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-2 marker:text-muted">
                {o.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Bullets({ id, title, items }: { id: string; title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
      <h2 id={`${id}-heading`} className="font-serif text-[1.625rem] font-medium leading-tight sm:text-[2rem]">
        {title}
      </h2>
      <ul className="mt-3.5 list-disc space-y-2 pl-5 text-ink-2 marker:text-muted">
        {items.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
    </section>
  );
}

/** Which rounds candidates reported and how often, in the order rounds usually came; links open the round below. */
function ReportedProcess({ guide }: { guide: InterviewGuide }) {
  const top = commonSequence(guide);
  return (
    <section id="process" aria-labelledby="process-heading" className="scroll-mt-24">
      <h2 id="process-heading" className={h2}>
        The process candidates reported
      </h2>
      <p className="mt-2 text-muted">How many of the {plural(guide.accounts, "account")} mention each round, in the order rounds usually came.</p>
      {guide.sequences.length > 0 && (
        <div className="mt-6 rounded-xl bg-accent-soft p-5 sm:px-7 sm:py-6">
          {top ? (
            <>
              <p className="caps text-accent-ink">
                Most common path · {top.reports} of {guide.accounts} accounts
              </p>
              <ol className="mt-3.5 space-y-2 sm:hidden">
                {top.steps.map((s, i) => (
                  <li key={s} className="flex items-center gap-3 text-[0.9375rem] font-semibold">
                    <span aria-hidden="true" className="w-5 font-mono text-xs font-normal text-accent-ink">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
              <p className="mt-3.5 hidden flex-wrap items-center gap-2 sm:flex">
                {top.steps.map((s, i) => (
                  <span key={s} className="flex items-center gap-2">
                    <span className="rounded-md bg-surface px-3.5 py-2 text-[0.9375rem] font-semibold">{s}</span>
                    {i < top.steps.length - 1 && (
                      <span aria-hidden="true" className="font-bold text-accent-ink">
                        →
                      </span>
                    )}
                  </span>
                ))}
              </p>
            </>
          ) : (
            <p className="text-ink-2">No two candidates describe the same sequence of rounds, so treat any order as one candidate’s experience.</p>
          )}
          {guide.sequences.length > 1 && (
            <details className="mt-3">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-[0.9375rem] font-semibold text-accent-ink">See all {guide.sequences.length} reported sequences</summary>
              <p className="mt-1.5 text-[0.9375rem] text-ink-2">Candidates describe {guide.sequences.length} different orders, so treat any order as one candidate’s experience.</p>
              <ul className="mt-3 space-y-2 text-[0.9375rem]">
                {guide.sequences.map((s) => (
                  <li key={s.steps.join(">")}>
                    {s.steps.join(" → ")} <span className="text-muted">· {plural(s.reports, "account")}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <ol className="mt-6">
        {guide.rounds.map((r, i) => (
          <li key={r.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-line py-3.5 sm:grid-cols-[2.25rem_minmax(0,1fr)_9.5rem] sm:gap-x-4">
            <span aria-hidden="true" className="font-mono text-[0.8125rem] text-muted">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <a href={`#round-${r.id}`} className="font-semibold text-ink hover:text-accent-ink">
                {r.name}
              </a>
              <span aria-hidden="true" className="mt-2 block h-2 overflow-hidden rounded-full bg-surface-2">
                <span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.max(share(r.reports, guide.accounts), 2)}%` }} />
              </span>
            </span>
            <span className="col-start-2 text-sm text-muted sm:col-start-auto sm:text-right">
              {r.reports} of {guide.accounts} · {plural(r.questions.length, "question")}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AboutPages({ guide, company, className }: { guide: Pick<InterviewGuide, "accounts" | "period">; company: string; className?: string }) {
  return (
    <section aria-labelledby="about-heading" className={className}>
      <h2 id="about-heading" className="text-base font-bold">
        About these pages
      </h2>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">
        Compiled by hand from {guide.accounts ? plural(guide.accounts, "public first-hand account") : "public first-hand accounts"} of {company} interviews{guide.period ? ` (${guide.period})` : ""} on sites such as LeetCode Discuss, Medium and GeeksforGeeks. A question is listed only when a candidate stated it, in the round they said it came from; reposts of one account count once. Wording is the candidate’s. There are no answers here by design: the point is what was asked.
      </p>
    </section>
  );
}

function PrepareWith({ cards, className }: { cards: InterviewSidebar["prepare"]; className?: string }) {
  if (!cards.length) return null;
  return (
    <section aria-labelledby="prepare-with" className={`rounded-lg border border-line bg-surface p-5 sm:p-[22px] ${className ?? ""}`}>
      <h2 id="prepare-with" className="text-[0.9375rem] font-bold">
        Prepare with
      </h2>
      <ul className="mt-1">
        {cards.map((c) => (
          <li key={c.id} className="border-b border-line-soft last:border-b-0">
            <Link href={c.path} className="block py-2.5 text-[0.9375rem] text-ink hover:text-accent-ink">
              {c.title}
              {kindOf(c.type) === "course" && <span className="text-muted"> · course</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OtherCompanies({ companies, typePath }: { companies: DirectoryCompany[]; typePath: string }) {
  if (!companies.length) return null;
  return (
    <section aria-labelledby="other-companies">
      <h2 id="other-companies" className="caps mb-2.5 text-muted">
        Other companies
      </h2>
      <ul className="space-y-2">
        {companies.map((c) => {
          const accounts = companyAccounts(c);
          return (
            <li key={c.slug}>
              <Link href={companyHref(typePath, c)} className="flex min-h-13 items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 hover:border-line-field">
                <span className="font-semibold">{c.name}</span>
                <span className="text-sm text-muted">{[plural(c.roles.length, "role"), accounts > 0 && plural(accounts, "account")].filter(Boolean).join(" · ")}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RoleGuide({ data, facts, directory, typePath, sidebar }: { data: DocumentPageData; facts: InterviewFacts; directory: DirectoryCompany | null; typePath: string; sidebar: InterviewSidebar }) {
  const { doc } = data;
  const { guide, guideField } = facts;
  const choices = guideField?.options.choices;
  const labels = new Map((choices ?? []).map((c) => [c.value, c.label]));
  const questions = guide.rounds.flatMap((r) => r.questions);
  const categories = countCategories(questions, choices).map((c) => ({ value: c.value, label: c.label }));
  const rounds: PracticeRound[] = guide.rounds.map((r) => ({
    id: r.id,
    name: r.name,
    reports: r.reports,
    summary: r.summary,
    questions: r.questions.map((q) => ({
      id: q.id,
      text: q.text,
      category: q.category,
      categoryLabel: labels.get(q.category) ?? q.category,
      difficulty: q.difficulty ? DIFFICULTY_LABELS[q.difficulty] : null,
      practiceUrl: q.practiceUrl,
      practiceHost: q.practiceUrl ? hostnameOf(q.practiceUrl) : "",
      reports: q.reports,
    })),
  }));
  const others = (directory?.roles ?? []).filter((r) => r.id !== doc.id);
  const companyPage = directory ? companyHref(typePath, directory) : null;
  const hasBody = (doc.content.content?.length ?? 0) > 0;
  const hasGuide = guide.rounds.length > 0;
  const outline = [
    ...(hasGuide ? [{ id: "process", text: "The process", children: [] }] : []),
    { id: "questions", text: "Questions", children: [] },
    ...(guide.preparation.length ? [{ id: "prepare", text: "How candidates prepared", children: [] }] : []),
  ];
  const stats: Array<[number, string]> = [
    [guide.accounts, "account"],
    [guide.rounds.length, "round"],
    [questions.length, "question"],
  ];

  return (
    <PracticeProvider company={facts.company} role={facts.role} path={doc.path} slug={doc.slug} accounts={guide.accounts} rounds={rounds} categories={categories}>
      <article>
        <PageHeader
          size="reading"
          breadcrumb={[...data.trail, { label: facts.role || doc.title, href: doc.path }]}
          leading={<InitialTile name={facts.company || doc.title} size={60} />}
          eyebrow={`${facts.company} · Interview experiences`}
          title={facts.role || doc.title}
          lede={doc.excerpt || undefined}
          meta={
            <div className="space-y-5 sm:flex sm:flex-wrap sm:items-center sm:gap-x-8 sm:gap-y-4 sm:space-y-0">
              <dl className="grid grid-cols-3 gap-3 sm:hidden">
                {stats.map(([n, label]) => (
                  <div key={label}>
                    <dd className="font-serif text-[1.625rem] font-medium leading-none text-ink">{n}</dd>
                    <dt className="mt-1 text-[0.8125rem]">{n === 1 ? label : `${label}s`}</dt>
                  </div>
                ))}
              </dl>
              <div className="hidden sm:block">
                <Counts items={stats} years={guide.period} />
              </div>
              {questions.length > 0 && (
                <div className="flex gap-2.5">
                  <a href="#questions" className="inline-flex min-h-12 flex-1 items-center justify-center rounded-md bg-accent px-5 text-[0.9375rem] font-semibold text-accent-contrast hover:bg-accent-hover sm:flex-none">
                    Jump to questions
                  </a>
                  <CopyAiButton variant="ghost">Practise with AI</CopyAiButton>
                </div>
              )}
            </div>
          }
        >
          {doc.status === "archived" && <ArchivedNotice />}
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">{CANDIDATE_REPORTED_NOTE}</p>
        </PageHeader>

        <div className="container-page flex flex-wrap items-start gap-x-14 gap-y-12 pb-20 pt-10 sm:pt-14 lg:flex-nowrap">
          <div className="min-w-0 flex-[1_1_40rem] space-y-14 sm:space-y-16">
            {hasGuide && <ReportedProcess guide={guide} />}
            <Official company={facts.company} notes={guide.official} />
            {hasBody && (
              <div className="max-w-2xl">
                <DocContent doc={doc.content} context={{ refs: data.refs, media: data.media }} />
              </div>
            )}
            <section id="questions" aria-labelledby="questions-heading" className="scroll-mt-24">
              <h2 id="questions-heading" className={h2}>
                Questions candidates reported
              </h2>
              <p className="mt-2 max-w-3xl text-muted">
                Pick a round or topic, or search. <strong className="font-semibold text-ink">Copy for AI</strong> copies the questions you’re viewing as a ready-made prompt for ChatGPT, Claude or Gemini. Wording is the candidate’s.
              </p>
              {rounds.length > 0 ? <QuestionsPanel /> : <p className="mt-6 text-muted">No rounds have been published for this role yet.</p>}
            </section>
            <Bullets id="prepare" title="How candidates prepared" items={guide.preparation} />
            <Bullets id="stands-out" title="What stands out in these accounts" items={guide.highlights} />
            <div className="grid gap-5 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
              {others.slice(0, 3).map((r) => (
                <Link key={r.id} href={r.path} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-6 hover:border-line-field">
                  <span className="caps text-muted">More {facts.company} roles</span>
                  <span className="font-serif text-[1.625rem] font-medium leading-tight">{r.role}</span>
                  <span className="text-sm text-muted">{[r.accounts > 0 && plural(r.accounts, "account"), plural(r.rounds.length, "round"), plural(r.questions, "question")].filter(Boolean).join(" · ")}</span>
                </Link>
              ))}
              <DashedCta href={siteConfig.shareInterviewHref} title={`Interviewed at ${facts.company} recently?`} action="Share your experience →" compact />
            </div>
            {companyPage && (
              <p>
                <Link href={companyPage} className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent-ink hover:underline">
                  All about {facts.company} interviews <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </p>
            )}
            <AboutPages guide={guide} company={facts.company} className="border-t border-line pt-5" />
          </div>

          <aside aria-label="About this page" className="w-full space-y-5 lg:sticky lg:top-24 lg:w-75 lg:shrink-0">
            <div className="hidden lg:block">
              <Toc items={outline} showLabel />
            </div>
            {questions.length > 0 && <PracticeCard />}
            <PrepareWith cards={sidebar.prepare} />
          </aside>
        </div>
        <ActiveSection ids={outline.map((o) => o.id)} />
      </article>
    </PracticeProvider>
  );
}

function RoleCard({ role }: { role: GuidePageLink }) {
  const names = role.rounds.map((r) => r.name);
  return (
    <Link href={role.path} className="flex flex-col gap-3.5 rounded-lg border border-line bg-surface p-6 transition-colors hover:border-line-field sm:p-7">
      <span className={cardTitle}>{role.role}</span>
      <span className="text-[0.9375rem] text-muted">{[role.accounts > 0 && plural(role.accounts, "account"), role.period].filter(Boolean).join(" · ")}</span>
      <span className="grid grid-cols-2 gap-2 border-y border-line-soft py-3.5">
        <span>
          <span className="block font-serif text-[1.75rem] leading-none">{role.rounds.length}</span>
          <span className="text-[0.8125rem] text-muted">rounds reported</span>
        </span>
        <span>
          <span className="block font-serif text-[1.75rem] leading-none">{role.questions}</span>
          <span className="text-[0.8125rem] text-muted">questions</span>
        </span>
      </span>
      {names.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {names.slice(0, 5).map((n) => (
            <span key={n} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[0.8125rem] text-ink-2">
              {n}
            </span>
          ))}
          {names.length > 5 && <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[0.8125rem] text-ink-2">+{names.length - 5} more</span>}
        </span>
      )}
      <span className="font-semibold text-accent-ink">See rounds and questions →</span>
    </Link>
  );
}

/**
 * A company's page. `page` is its own document (title, lead, official
 * sources, highlights, body); without one, the page is built from the
 * company's published roles alone.
 */
export function CompanyView({
  company,
  crumbs,
  title,
  lead,
  guide,
  body,
  archived = false,
  sidebar,
  typePath,
}: {
  company: DirectoryCompany | null;
  crumbs: Crumb[];
  title: string;
  lead: string;
  guide: InterviewGuide | null;
  body?: React.ReactNode;
  archived?: boolean;
  sidebar: InterviewSidebar;
  typePath: string;
}) {
  const roles = company?.roles ?? [];
  const accounts = company ? companyAccounts(company) : (guide?.accounts ?? 0);
  const questions = sum(roles.map((r) => r.questions));
  const name = company?.name ?? title;
  const years = yearRange(roles.map((r) => r.period)) || guide?.period || "";
  return (
    <article>
      <PageHeader
        breadcrumb={crumbs}
        leading={<InitialTile name={name} size={72} />}
        eyebrow="Interview experiences"
        title={name}
        lede={lead || undefined}
        meta={
          <Counts
            items={[
              [accounts, "candidate account"],
              [roles.length, "role"],
              [questions, "question"],
            ]}
            years={years}
          />
        }
      >
        {archived && <ArchivedNotice />}
      </PageHeader>
      <div className="container-page flex flex-wrap items-start gap-x-12 gap-y-12 pb-20 pt-10 sm:pt-14 lg:flex-nowrap">
        <div className="min-w-0 flex-[1_1_38rem] space-y-10">
          <section aria-labelledby="roles-heading">
            <h2 id="roles-heading" className={`mb-5 ${h2}`}>
              Choose a role
            </h2>
            {roles.length ? (
              <div className="grid gap-5 sm:grid-cols-[repeat(auto-fit,minmax(17.5rem,1fr))]">
                {roles.map((r) => (
                  <RoleCard key={r.id} role={r} />
                ))}
              </div>
            ) : (
              <p className="text-muted">No role has been published yet.</p>
            )}
          </section>
          {guide && <Official company={name} notes={guide.official} />}
          {guide && <Bullets id="across" title="Across the accounts" items={guide.highlights} />}
          {body && <div className="max-w-2xl">{body}</div>}
          <Callout tone="warn" icon="info" label="How to read these pages">
            <p>{CANDIDATE_REPORTED_NOTE}</p>
          </Callout>
        </div>
        <aside aria-label="Beside this page" className="w-full space-y-5 lg:w-85 lg:shrink-0">
          <AboutPages guide={{ accounts, period: years }} company={name} className="rounded-lg bg-bg-tint p-6" />
          <PrepareWith cards={sidebar.prepare} />
          <OtherCompanies companies={sidebar.others} typePath={typePath} />
        </aside>
      </div>
    </article>
  );
}

export function CompanyPage({ data, facts, directory, sidebar, typePath }: { data: DocumentPageData; facts: InterviewFacts; directory: DirectoryCompany | null; sidebar: InterviewSidebar; typePath: string }) {
  const { doc } = data;
  const hasBody = (doc.content.content?.length ?? 0) > 0;
  return (
    <CompanyView
      company={directory}
      crumbs={[...data.trail, { label: facts.company || doc.title, href: doc.path }]}
      title={facts.company || doc.title}
      lead={doc.excerpt}
      guide={facts.guide}
      archived={doc.status === "archived"}
      sidebar={sidebar}
      typePath={typePath}
      body={hasBody ? <DocContent doc={doc.content} context={{ refs: data.refs, media: data.media }} /> : undefined}
    />
  );
}
