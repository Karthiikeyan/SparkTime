import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocContent } from "@/components/content/renderer";
import { JsonLd } from "@/components/seo/json-ld";
import { MediaImage } from "@/components/content/media-image";
import { ListRow } from "@/components/ui/list-row";
import { FeatureCard } from "@/components/ui/cards";
import { rowMeta } from "@/components/pages/library-view";
import { type BlockNode, type Doc } from "@/lib/content/blocks";
import { asStats, listOnly, splitSections, titleAndText } from "@/lib/content/page-sections";
import { stripPlaceholders } from "@/lib/content/placeholders";
import { absoluteUrl } from "@/lib/content/paths";
import { breadcrumbSchema, founderOrganizationSchema, graph, webPageSchema } from "@/lib/seo/json-ld";
import { safeExternalUrl, safeHref } from "@/lib/url";
import { siteUrl } from "@/server/env";
import { documentMetadata } from "@/server/seo/metadata";
import { getRootPage, listPublished, mediaForDoc, resolveReferences } from "@/server/services/public-content";
import { loadAllSettings } from "@/server/services/settings";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getRootPage("sparktribe");
  return doc ? documentMetadata(doc) : { title: "SparkTribe", robots: { index: false } };
}

const asDoc = (nodes: BlockNode[]): Doc => ({ type: "doc", content: nodes }) as Doc;

/**
 * SparkTribe is its own brand; this page connects to it without merging identities. Everything on it is
 * the page's own text, laid out: a list of figures becomes the stat strip, a list of offers becomes
 * cards, anything else stays prose. Prompts the owner hasn't filled in yet are never shown.
 */
export default async function SparkTribePage() {
  const [doc, settings] = await Promise.all([getRootPage("sparktribe"), loadAllSettings()]);
  if (!doc) notFound();
  const { sparktribe } = settings.pages;
  const siteLink = safeHref(sparktribe.url);
  const related =
    sparktribe.tagId || sparktribe.categoryId
      ? await listPublished({ tagIds: sparktribe.tagId ? [sparktribe.tagId] : undefined, categoryIds: sparktribe.categoryId ? [sparktribe.categoryId] : undefined, limit: 6 })
      : { items: [] };

  const body = stripPlaceholders(doc.content);
  const { intro, sections } = splitSections(body);
  const statsAt = sections.findIndex((s) => asStats(listOnly(s.nodes)?.items ?? []));
  const stats = statsAt >= 0 ? asStats(listOnly(sections[statsAt]!.nodes)!.items) : null;
  const rest = sections.filter((_, i) => i !== statsAt);
  const [refs, media] = await Promise.all([resolveReferences(body), mediaForDoc(body)]);

  const official = safeExternalUrl(sparktribe.url);
  const base = siteUrl();
  const url = absoluteUrl(base, doc.path);
  const organization = official ? founderOrganizationSchema({ siteUrl: base, pageUrl: absoluteUrl(base, "/sparktribe"), name: "SparkTribe", url: official, description: doc.seoDescription || doc.excerpt, founderName: settings.identity.name || "Karthikeyan A" }) : null;
  const hasStory = intro.length > 0 || rest.length > 0;

  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl: base, url, name: doc.seoTitle || doc.title, description: doc.seoDescription || doc.excerpt, type: "WebPage" }),
          breadcrumbSchema([
            { name: "Home", url: base },
            { name: doc.title, url },
          ]),
          organization,
        )}
      />
      <header className="bg-feature text-feature-text">
        <div className="container-page flex flex-wrap items-center gap-x-12 gap-y-10 pb-12 pt-12 sm:pb-[72px] sm:pt-20">
          <div className="min-w-0 flex-[1_1_32rem]">
            <p className="caps text-feature-muted">A project I founded</p>
            <h1 className="mt-3 font-serif text-[3rem] font-medium leading-none tracking-[-0.03em] sm:text-[4.75rem]">{doc.title}</h1>
            {doc.excerpt && <p className="mt-5 font-serif text-[1.375rem] leading-[1.3] text-feature-2 sm:text-[1.75rem]">{doc.excerpt}</p>}
            <div className="mt-8 flex flex-wrap gap-3">
              {siteLink && (
                <a href={siteLink} rel="noopener" className="inline-flex min-h-13 items-center gap-1.5 rounded-[8px] bg-feature-button px-6 font-semibold text-feature-button-text hover:opacity-90">
                  Visit SparkTribe <ExternalLink size={15} aria-hidden="true" />
                </a>
              )}
              {hasStory && (
                <a href="#story" className="inline-flex min-h-13 items-center rounded-[8px] border border-feature-muted/50 px-5.5 font-semibold text-feature-text hover:border-feature-muted">
                  Read the story
                </a>
              )}
            </div>
          </div>
          {doc.image && (
            <div className="w-full flex-[1_1_26rem] overflow-hidden rounded-2xl border border-feature-border">
              <MediaImage asset={doc.image} priority sizes="(min-width: 1024px) 520px, 90vw" />
            </div>
          )}
        </div>
        {stats && (
          <div className="border-t border-feature-muted/20">
            <dl className="container-page grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
              {stats.map((s) => (
                <div key={s.label} className="py-6 pr-4 sm:py-7">
                  <dd className="font-serif text-[2rem] font-medium leading-none sm:text-[2.5rem]">{s.value}</dd>
                  <dt className="mt-1.5 text-sm text-feature-muted">{s.label}</dt>
                </div>
              ))}
            </dl>
            <p className="container-page pb-6 text-[0.8125rem] text-feature-muted">Numbers as of writing. They’ll change.</p>
          </div>
        )}
      </header>

      {intro.length > 0 && (
        <section id="story" aria-label="About SparkTribe" className="container-page scroll-mt-24 pt-14 sm:pt-20">
          <div className="max-w-[45rem]">
            <DocContent doc={asDoc(intro)} context={{ refs, media }} className="[&>*]:mx-0" />
          </div>
        </section>
      )}

      {rest.map((s, i) => {
        const list = listOnly(s.nodes);
        const offers = list && !list.ordered && list.items.length >= 3 ? list.items : null;
        const steps = list?.ordered && list.items.length >= 3 && list.items.every((t) => t.length <= 70) ? list.items : null;
        return (
          <section key={s.id} id={intro.length === 0 && i === 0 ? "story" : s.id} aria-labelledby={`${s.id}-h`} className="container-page scroll-mt-24 pt-14 sm:pt-20">
            <h2 id={`${s.id}-h`} className="font-serif text-[1.875rem] font-medium leading-tight tracking-[-0.02em] sm:text-[2.75rem]">
              {s.heading}
            </h2>
            {offers ? (
              <ul className="mt-7 grid gap-5 sm:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
                {offers.map((item, n) => {
                  const { title, text } = titleAndText(item);
                  return (
                    <li key={item}>
                      <FeatureCard n={String(n + 1)} title={title} className="h-full">
                        {text}
                      </FeatureCard>
                    </li>
                  );
                })}
              </ul>
            ) : steps ? (
              <ol className="mt-7 max-w-md">
                {steps.map((label, n) => (
                  <li key={label} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-4 pb-4">
                    <span aria-hidden="true" className={n === steps.length - 1 ? "flex size-7 items-center justify-center rounded-full bg-accent text-[0.8125rem] font-bold text-accent-contrast" : "flex size-7 items-center justify-center rounded-full bg-line text-[0.8125rem] font-bold text-ink-2"}>
                      {n + 1}
                    </span>
                    <span className="pt-0.5 text-[1.0625rem] font-medium">{label}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-5 max-w-[45rem]">
                <DocContent doc={asDoc(s.nodes)} context={{ refs, media }} className="[&>*]:mx-0" />
              </div>
            )}
          </section>
        );
      })}

      {related.items.length > 0 && (
        <section aria-labelledby="st-related" className="container-page pt-14 sm:pt-20">
          <h2 id="st-related" className="font-serif text-[1.875rem] font-medium tracking-[-0.02em] sm:text-4xl">
            Updates &amp; related writing
          </h2>
          <div className="mt-4 max-w-[62rem]">
            {related.items.map((c) => (
              <ListRow key={c.id} href={c.path} type={c.type} topic={c.primaryCategory} meta={rowMeta(c)} title={c.title} excerpt={c.excerpt} />
            ))}
          </div>
        </section>
      )}

      <section className="container-page pb-20 pt-14 sm:pb-24 sm:pt-20">
        <div className="flex flex-wrap items-center justify-between gap-8 rounded-2xl bg-bg-tint p-6 sm:p-11">
          <div className="flex-[1_1_30rem]">
            <h2 className="font-serif text-[1.875rem] font-medium leading-[1.15] sm:text-4xl">Built for the student I used to be</h2>
            <p className="mt-2.5 text-ink-2">So that more students can say: “Okay. I know what to do next.”</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {siteLink && (
              <a href={siteLink} rel="noopener" className="inline-flex min-h-13 items-center gap-1.5 rounded-[8px] bg-accent px-6 font-semibold text-accent-contrast hover:bg-accent-hover">
                Explore SparkTribe <ExternalLink size={15} aria-hidden="true" />
              </a>
            )}
            <Link href="/contact?reason=Collaboration" className="inline-flex min-h-13 items-center rounded-[8px] border border-line-strong bg-surface px-5.5 font-semibold hover:border-line-field">
              Collaborate
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
