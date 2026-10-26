import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocContent } from "@/components/content/renderer";
import { JsonLd } from "@/components/seo/json-ld";
import { AuthorCard } from "@/components/ui/author-card";
import { PageHeader } from "@/components/ui/page-header";
import { absoluteUrl } from "@/lib/content/paths";
import { stripPlaceholders } from "@/lib/content/placeholders";
import { firstSentence } from "@/lib/home";
import { breadcrumbSchema, graph, webPageSchema } from "@/lib/seo/json-ld";
import { siteUrl } from "@/server/env";
import { documentMetadata } from "@/server/seo/metadata";
import { getStartGoals } from "@/server/services/library";
import { getRootPage, mediaForDoc, resolveReferences } from "@/server/services/public-content";
import { loadAllSettings } from "@/server/services/settings";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getRootPage("start-here");
  return doc ? documentMetadata(doc) : { title: "Start here", robots: { index: false } };
}

const STEPS = [
  { title: "Pick one path", desc: "Start with the goal closest to you. You don’t need to read everything." },
  { title: "Read in order, do the exercises", desc: "Each lesson builds on the last and ends with exercises and worked solutions." },
  { title: "Check yourself against real questions", desc: "Use the interview pages to see what companies actually asked." },
];

/**
 * Orientation by goal: each course that answers a goal ("Get my first tech job"), then the interview
 * pages, with the counts the courses themselves hold. The page's own text, when it has any, closes it.
 */
export default async function StartHerePage() {
  const [doc, goals, settings, sparktribe] = await Promise.all([getRootPage("start-here"), getStartGoals(), loadAllSettings(), getRootPage("sparktribe")]);
  if (!doc) notFound();
  const base = siteUrl();
  const url = absoluteUrl(base, doc.path);
  // Placeholder prompts left in the page (a "[TODO]" callout) are never shown to readers.
  const body = stripPlaceholders(doc.content);
  const note = body.content.length > 0;
  const [refs, media] = note ? await Promise.all([resolveReferences(body), mediaForDoc(body)]) : [new Map(), new Map()];

  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl: base, url, name: doc.seoTitle || doc.title, description: doc.seoDescription || doc.excerpt, type: "CollectionPage" }),
          breadcrumbSchema([
            { name: "Home", url: base },
            { name: doc.title, url },
          ]),
        )}
      />
      <PageHeader
        eyebrow="Start here"
        title="What are you preparing for?"
        lede="Pick your goal. Each path is free, takes you from where you are to the next step, and you can stop and come back any time."
      />
      {goals.length > 0 && (
        <section aria-label="Goals" className="container-page pb-8 pt-10 sm:pt-14">
          <ol className="grid gap-5 sm:grid-cols-[repeat(auto-fill,minmax(21.25rem,1fr))]">
            {goals.map((g) => (
              <li key={g.href}>
                <Link href={g.href} className="group flex h-full flex-col gap-3 rounded-xl border border-line bg-surface p-6 transition-colors hover:border-line-field sm:p-[30px]">
                  <span aria-hidden="true" className="font-mono text-[0.8125rem] text-accent-ink">
                    {g.n}
                  </span>
                  <span className="font-serif text-[1.625rem] font-medium leading-[1.12] sm:text-[1.875rem]">{g.goal}</span>
                  <span className="text-base text-ink-2">{g.desc}</span>
                  <span className="mt-auto flex justify-between gap-3 border-t border-line-soft pt-4 text-sm">
                    <span className="text-muted">{g.path}</span>
                    <span className="whitespace-nowrap font-semibold text-accent-ink" aria-hidden="true">
                      Start →
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="how-to-use" className="container-page pt-10 sm:pt-12">
        <h2 id="how-to-use" className="font-serif text-[1.875rem] font-medium tracking-[-0.02em] sm:text-[2.5rem]">
          How to use {settings.site.name}
        </h2>
        <ol className="mt-6 grid border-t border-ink sm:grid-cols-[repeat(auto-fit,minmax(17.5rem,1fr))]">
          {STEPS.map((s, i) => (
            <li key={s.title} className="py-6 sm:pr-7">
              <span aria-hidden="true" className="font-serif text-5xl leading-none text-accent-ink">
                {i + 1}
              </span>
              <p className="mt-3 text-[1.1875rem] font-semibold">{s.title}</p>
              <p className="mt-1.5 text-base text-ink-2">{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {note && (
        <section aria-labelledby="a-note" className="container-page pt-10 sm:pt-12">
          <h2 id="a-note" className="mb-4 font-serif text-[1.875rem] font-medium tracking-[-0.02em]">
            A note from me
          </h2>
          <div className="max-w-[45rem]">
            <DocContent doc={body} context={{ refs, media }} className="[&>*]:mx-0" />
          </div>
        </section>
      )}

      <section className="container-page grid gap-6 pb-20 pt-12 sm:pb-24 md:grid-cols-[repeat(auto-fit,minmax(21.25rem,1fr))]">
        <AuthorCard variant="full" label="Who writes this" name={settings.identity.name || settings.site.name} headline={firstSentence(settings.site.authorSummary)} />
        {sparktribe && (
          <div className="flex flex-col justify-between gap-4 rounded-xl border border-feature-border bg-feature p-6 text-feature-text sm:p-8">
            <div>
              <p className="caps text-feature-muted">Learn in Tamil</p>
              <p className="mt-2 font-serif text-[1.625rem] font-medium leading-tight sm:text-[1.75rem]">Prefer learning in your mother tongue?</p>
              {sparktribe.excerpt && <p className="mt-2 text-[0.9375rem] text-feature-2">{sparktribe.excerpt}</p>}
            </div>
            <Link href={sparktribe.path} className="inline-flex min-h-11 items-center self-start rounded-[8px] bg-feature-button px-5 font-semibold text-feature-button-text hover:opacity-90">
              Visit SparkTribe →
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
