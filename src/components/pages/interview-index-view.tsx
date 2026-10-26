import { Search } from "lucide-react";
import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { CompanyView } from "@/components/templates/interview";
import { InitialTile } from "@/components/ui/cards";
import { DashedCta } from "@/components/ui/dashed-cta";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { absoluteUrl, typeIndexPath } from "@/lib/content/paths";
import { companyAccounts, companyHref, type DirectoryCompany } from "@/lib/interviews/directory";
import { yearRange } from "@/lib/interviews/display";
import { breadcrumbSchema, graph, itemListSchema, webPageSchema } from "@/lib/seo/json-ld";
import { siteConfig } from "@/lib/site-config";
import type { InterviewSidebar } from "@/server/services/interviews";
import type { ContentType } from "@/server/services/public-content";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * /interviews: every company with its published role pages. A candidate who
 * knows the company and role is one click from the questions.
 */
export function InterviewIndexView({ type, companies, siteUrl }: { type: ContentType; companies: DirectoryCompany[]; siteUrl: string }) {
  const typePath = typeIndexPath(type);
  const url = absoluteUrl(siteUrl, typePath);
  const roles = companies.flatMap((c) => c.roles);
  const stats = [
    { value: companies.length, label: companies.length === 1 ? "company" : "companies" },
    { value: roles.length, label: roles.length === 1 ? "role" : "roles" },
    { value: companies.reduce((n, c) => n + companyAccounts(c), 0), label: "candidate accounts" },
    { value: roles.reduce((n, r) => n + r.questions, 0), label: "questions" },
  ].filter((s) => s.value > 0);
  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl, url, name: type.pluralName, description: type.description, type: "CollectionPage" }),
          breadcrumbSchema([
            { name: "Home", url: siteUrl },
            { name: type.pluralName, url },
          ]),
          itemListSchema(type.pluralName, roles.map((r) => ({ name: r.title, url: absoluteUrl(siteUrl, r.path) }))),
        )}
      />
      <PageHeader
        eyebrow="Interview experiences"
        title="Interview questions, round by round"
        lede="What candidates actually faced at each company and role, compiled by hand from public first-hand accounts. No answers by design: the point is what was asked."
      >
        <form role="search" action="/search" className="mt-7 max-w-140 sm:mt-8">
          <label htmlFor="int-search" className="sr-only">
            Search companies and roles
          </label>
          <div className="flex min-h-14 items-center gap-3 rounded-xl border border-line-field bg-surface px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent sm:px-[18px]">
            <Search size={18} aria-hidden="true" className="shrink-0 text-muted" />
            <input id="int-search" name="q" type="search" placeholder="Search a company or role" className="min-w-0 flex-1 bg-transparent text-[1.0625rem] outline-none placeholder:text-muted" />
            <input type="hidden" name="type" value="interview" />
          </div>
        </form>
        <StatRow items={stats} size="lg" className="mt-8 sm:mt-10" />
      </PageHeader>

      <div className="container-page space-y-6 pb-10 pt-10 sm:pt-14">
        {companies.length === 0 ? (
          <EmptyState title="No interview experiences yet">
            <p>
              Check back soon, or{" "}
              <Link href="/library" className="font-semibold text-accent-ink underline underline-offset-2">
                browse the library
              </Link>
              .
            </p>
          </EmptyState>
        ) : (
          companies.map((company) => {
            const accounts = companyAccounts(company);
            const href = companyHref(typePath, company);
            return (
              <section key={company.slug} id={company.slug} aria-labelledby={`${company.slug}-name`} className="scroll-mt-24 overflow-hidden rounded-xl border border-line bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft px-5 py-5 sm:px-7 sm:py-6">
                  <div className="flex items-center gap-4">
                    <InitialTile name={company.name} size={52} />
                    <div>
                      <h2 id={`${company.slug}-name`} className="font-serif text-[1.625rem] font-medium leading-tight sm:text-[1.875rem]">
                        <Link href={href} className="hover:text-accent-ink">
                          {company.name}
                        </Link>
                      </h2>
                      <p className="text-sm text-muted">{[plural(company.roles.length, "role"), accounts > 0 && plural(accounts, "candidate account")].filter(Boolean).join(" · ")}</p>
                    </div>
                  </div>
                  <Link href={href} className="inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-accent-ink hover:underline">
                    About {company.name} interviews →
                  </Link>
                </div>
                <ul>
                  {company.roles.map((r) => (
                    <li key={r.id} className="border-b border-line-soft last:border-b-0">
                      <Link href={r.path} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 px-5 py-4 hover:bg-bg sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:px-7 sm:py-[18px]">
                        <span className="min-w-0">
                          <span className="block text-lg font-semibold">{r.role}</span>
                          {yearRange([r.period]) && <span className="block text-sm text-muted">{yearRange([r.period])}</span>}
                        </span>
                        <span aria-hidden="true" className="font-semibold text-accent-ink sm:order-last">
                          →
                        </span>
                        <span className="col-span-2 text-sm text-muted sm:col-span-1 sm:whitespace-nowrap">
                          {plural(r.rounds.length, "round")} · {plural(r.questions, "question")}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {company.roles.length === 0 && <li className="px-7 py-4 text-sm text-muted">No role has been published yet.</li>}
                </ul>
              </section>
            );
          })
        )}
      </div>

      <section className="container-page grid gap-6 pb-20 pt-4 sm:pb-24 md:grid-cols-2">
        <div className="rounded-lg bg-bg-tint p-6 sm:px-8 sm:py-7">
          <h2 className="font-serif text-[1.5rem] font-medium sm:text-[1.625rem]">How these pages are made</h2>
          <p className="mt-2.5 text-ink-2">
            Compiled by hand from public first-hand accounts on sites such as LeetCode Discuss, Medium and GeeksforGeeks. A question is listed only when a candidate stated it, in the round they said it came from. Reposts of one account count once.
          </p>
        </div>
        <DashedCta href={siteConfig.shareInterviewHref} title="Interviewed somewhere recently?" body="Share the rounds and questions you faced. It helps the next person prepare." action="Share your experience →" />
      </section>
    </>
  );
}

/** /interviews/{company} when the company has published roles but no page of its own. */
export function InterviewCompanyHubView({ type, company, siteUrl, sidebar = { others: [], prepare: [] } }: { type: ContentType; company: DirectoryCompany; siteUrl: string; sidebar?: InterviewSidebar }) {
  const typePath = typeIndexPath(type);
  const url = absoluteUrl(siteUrl, companyHref(typePath, company));
  const title = `${company.name} ${type.pluralName}`;
  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl, url, name: title, description: `Interview experiences candidates have reported for ${company.name}.`, type: "CollectionPage" }),
          breadcrumbSchema([
            { name: "Home", url: siteUrl },
            { name: type.pluralName, url: absoluteUrl(siteUrl, typePath) },
            { name: company.name, url },
          ]),
        )}
      />
      <CompanyView
        company={company}
        crumbs={[
          { label: type.pluralName, href: typePath },
          { label: company.name, href: companyHref(typePath, company) },
        ]}
        title={company.name}
        lead={`What candidates report about ${company.name} interviews, role by role: the rounds they had and the questions they were asked.`}
        guide={null}
        sidebar={sidebar}
        typePath={typePath}
      />
    </>
  );
}

export function interviewCompanyHubMetadata(type: ContentType, company: DirectoryCompany) {
  const questions = company.roles.reduce((n, r) => n + r.questions, 0);
  return {
    title: `${company.name} ${type.pluralName}`,
    description: `Interview rounds and questions candidates have publicly reported for ${company.name}: ${plural(company.roles.length, "role")}, ${plural(questions, "question")}. Candidate-reported, not an official process.`,
    path: companyHref(typeIndexPath(type), company),
  };
}
