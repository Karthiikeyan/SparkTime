import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocContent } from "@/components/content/renderer";
import { JsonLd } from "@/components/seo/json-ld";
import { ProfileIcon } from "@/components/site/profile-icon";
import { SectionHeading } from "@/components/ui/section-heading";
import { extractSnapshot } from "@/lib/content/derive";
import { absoluteUrl } from "@/lib/content/paths";
import { formatDate } from "@/lib/dates";
import type { Profile } from "@/lib/settings";
import { breadcrumbSchema, graph, webPageSchema } from "@/lib/seo/json-ld";
import { siteConfig } from "@/lib/site-config";
import { hostnameOf, safeHref } from "@/lib/url";
import { siteUrl } from "@/server/env";
import { documentMetadata } from "@/server/seo/metadata";
import { identityJsonLd } from "@/server/seo/person";
import { listContentTypes } from "@/server/services/content-types";
import { getSpeakingPage } from "@/server/services/hub-page";
import { getRootPage, listPublished, mediaForDoc, resolveReferences, typeListOrder } from "@/server/services/public-content";
import { loadAllSettings } from "@/server/services/settings";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getRootPage("about");
  return doc ? documentMetadata(doc) : { title: "About" };
}

const btnPrimary = "inline-flex min-h-13 items-center rounded-[8px] bg-accent px-6 font-semibold text-accent-contrast transition-colors hover:bg-accent-hover";
const btnGhost = "inline-flex min-h-13 items-center rounded-[8px] border border-line-strong bg-surface px-5.5 font-semibold text-ink transition-colors hover:border-line-field";
const card = "flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-6 sm:p-7";

/** "Tell me about you" on one page: who I am, what I do, the journey, what I'm doing now, and how to invite me to speak. */
export default async function AboutPage() {
  const [doc, settings, identity, types, now, speaking] = await Promise.all([getRootPage("about"), loadAllSettings(), identityJsonLd(), listContentTypes(), getRootPage("now"), getSpeakingPage()]);
  if (!doc) notFound();
  const { identity: id, hubs } = settings;
  const base = siteUrl();
  const url = absoluteUrl(base, doc.path);
  const journeyType = types.find((t) => t.id === settings.pages.journeyTypeId);
  const [journey, refs, media] = await Promise.all([
    journeyType ? listPublished({ typeIds: [journeyType.id], limit: 40, propertyOrder: typeListOrder(journeyType) }) : Promise.resolve({ items: [] }),
    resolveReferences(doc.content),
    mediaForDoc(doc.content),
  ]);
  const snapshot = now ? extractSnapshot(now.content, 3) : [];
  const nowUpdated = now ? (now.modifiedAt ?? now.publishedAt) : null;
  const firstName = (id.name || siteConfig.author).split(" ")[0]!;
  const facts = [
    { k: "Currently", v: [id.jobTitle, id.worksFor].filter(Boolean).join(", ") },
    { k: "Based in", v: id.location },
    { k: "Works with", v: id.knowsAbout.slice(0, 5).join(", ") },
  ].filter((f) => f.v);
  const hasBody = (doc.content.content?.length ?? 0) > 0;
  const social: Profile[] = settings.site.social.map((s) => ({ ...s, handle: "", enabled: true, sameAs: true, note: "" }));
  const profiles = [...settings.profiles.filter((p) => p.enabled && p.url), ...social].filter((p, i, all) => all.findIndex((q) => q.url === p.url) === i);
  const talks = speaking.shelves.find((s) => s.type.fields.some((f) => f.role === "eventName" || f.role === "eventDate"));
  const speakingCta = hubs.speaking.cta ?? { label: "Invite me to speak", href: siteConfig.speakingHref };

  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl: base, url, name: doc.seoTitle || doc.title, description: doc.seoDescription || doc.excerpt, type: "ProfilePage", mainEntity: { "@id": `${base}/#person` } }),
          breadcrumbSchema([
            { name: "Home", url: base },
            { name: doc.title, url },
          ]),
          identity.person,
        )}
      />
      <header className="border-b border-line">
        <div className="container-page flex flex-wrap items-center gap-x-14 gap-y-10 pb-12 pt-10 sm:pb-16 sm:pt-[72px]">
          <div className="min-w-0 flex-[1_1_32rem]">
            <p className="caps text-accent-ink">About</p>
            <h1 className="mt-3 font-serif text-[2.5rem] font-medium leading-none tracking-[-0.03em] sm:text-[4.25rem]">Hi, I’m {firstName}.</h1>
            {id.headline && <p className="mt-5 font-serif text-[1.375rem] leading-[1.35] text-ink-2 sm:text-[1.625rem]">{id.headline}</p>}
            {(doc.excerpt || id.description) && <p className="mt-5 max-w-150 text-[1.0625rem] text-ink-2 sm:text-lg">{doc.excerpt || id.description}</p>}
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/contact" className={btnPrimary}>
                Get in touch
              </Link>
              <Link href="#speaking" className={btnGhost}>
                Invite me to speak
              </Link>
            </div>
          </div>
          <figure className="m-0 w-full max-w-105 min-w-70 flex-[0_1_26rem]">
            <Image
              src={siteConfig.authorPhoto.src}
              width={siteConfig.authorPhoto.width}
              height={siteConfig.authorPhoto.height}
              alt={`${id.name || siteConfig.author}`}
              priority
              sizes="(min-width: 1024px) 420px, 90vw"
              className="aspect-square w-full rounded-[20px] bg-line object-cover object-[52%_35%]"
            />
          </figure>
        </div>
      </header>

      {facts.length > 0 && (
        <section aria-label="At a glance" className="container-page">
          <dl className="grid border-b border-line sm:grid-cols-[repeat(auto-fit,minmax(13.75rem,1fr))]">
            {facts.map((f) => (
              <div key={f.k} className="py-5 pr-6 sm:py-6">
                <dt className="caps text-muted">{f.k}</dt>
                <dd className="mt-1.5 text-[1.0625rem] font-medium">{f.v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {id.pillars.length > 0 && (
        <section aria-labelledby="what-i-do" className="container-page pt-12 sm:pt-[72px]">
          <SectionHeading id="what-i-do" title="What I do" size="lg" className="mb-6" />
          <ul className="grid gap-5 sm:grid-cols-[repeat(auto-fit,minmax(18.75rem,1fr))]">
            {id.pillars.map((p) => {
              const href = safeHref(p.href);
              return (
                <li key={p.label} className={card}>
                  <span className="font-serif text-[1.625rem] font-medium leading-tight">{p.label}</span>
                  {p.description && <span className="text-base text-ink-2">{p.description}</span>}
                  {href && (
                    <Link href={href} className="mt-auto inline-flex min-h-11 items-center pt-2 font-semibold text-accent-ink hover:underline">
                      Read more →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {hasBody && (
        <section aria-labelledby="my-story" className="container-page pt-12 sm:pt-16">
          <SectionHeading id="my-story" title="My story" size="lg" className="mb-4 sm:mb-6" />
          <div className="max-w-[45rem]">
            <DocContent doc={doc.content} context={{ refs, media }} className="[&>*]:mx-0" />
          </div>
        </section>
      )}

      {(journey.items.length > 0 || snapshot.length > 0) && (
        <section aria-label="Journey and now" className="container-page flex flex-wrap gap-x-14 gap-y-12 pt-12 sm:pt-16">
          {journey.items.length > 0 && (
            <div className="min-w-0 flex-[1_1_32rem]">
              <h2 className="font-serif text-[1.875rem] font-medium tracking-[-0.02em] sm:text-[2.5rem]">A little of my journey</h2>
              <ol className="mt-6">
                {journey.items.map((c) => (
                  <li key={c.id} className="grid gap-x-5 gap-y-1 border-t border-line py-5 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                    <span className="text-sm font-semibold text-accent-ink">{c.meta ?? ""}</span>
                    <span>
                      <span className="block text-lg font-semibold">
                        <Link href={c.path} className="hover:text-accent-ink hover:underline">
                          {c.title}
                        </Link>
                      </span>
                      {c.excerpt && <span className="mt-1 block text-base text-ink-2">{c.excerpt}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {snapshot.length > 0 && now && (
            <aside aria-labelledby="right-now" className="w-full flex-[0_1_23.75rem] self-start rounded-lg bg-bg-tint p-6 sm:p-7">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="right-now" className="font-serif text-[1.625rem] font-medium">
                  Right now
                </h2>
                {nowUpdated && (
                  <span className="text-[0.8125rem] text-muted">
                    Updated <time dateTime={nowUpdated}>{formatDate(nowUpdated, "medium")}</time>
                  </span>
                )}
              </div>
              <ul className="mt-3.5 list-disc space-y-2.5 pl-4.5 text-[0.9375rem] text-ink-2 marker:text-muted">
                {snapshot.map((item) => (
                  <li key={item.label}>{item.text}</li>
                ))}
              </ul>
              <Link href={now.path} className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent-ink hover:underline">
                More on the Now page →
              </Link>
            </aside>
          )}
        </section>
      )}

      <section id="speaking" aria-labelledby="speaking-heading" className="container-page scroll-mt-24 pt-12 sm:pt-16">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-8 rounded-2xl bg-feature p-6 text-feature-text sm:p-10">
          <div className="flex-[1_1_26rem]">
            <p className="caps text-feature-muted">Speaking</p>
            <h2 id="speaking-heading" className="mt-2 font-serif text-[1.875rem] font-medium leading-[1.15] sm:text-4xl">
              Organising something for students or engineers?
            </h2>
            <p className="mt-3 text-[1.0625rem] text-feature-2">Tell me about the event, the audience and the date. I read every message.</p>
          </div>
          <div className="flex w-full flex-[0_1_20rem] flex-col gap-2.5">
            {hubs.speaking.topics.length > 0 && (
              <>
                <p className="text-sm font-semibold text-feature-muted">I speak about</p>
                <ul className="space-y-2.5">
                  {hubs.speaking.topics.map((t) => (
                    <li key={t} className="rounded-md border border-feature-border px-3.5 py-2.5 outline outline-1 -outline-offset-1 outline-feature-muted/30">
                      {t}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Link href={safeHref(speakingCta.href) ?? siteConfig.speakingHref} className="mt-1.5 inline-flex min-h-12 items-center justify-center rounded-[8px] bg-feature-button font-semibold text-feature-button-text hover:opacity-90">
              {speakingCta.label || "Invite me to speak"} →
            </Link>
          </div>
        </div>
        {talks && talks.items.length > 0 && (
          <div className="mt-8">
            <h3 className="caps mb-1 text-muted">Past sessions</h3>
            <ul>
              {talks.items.slice(0, 4).map((c) => (
                <li key={c.id} className="border-b border-line">
                  <Link href={c.path} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 py-3.5 hover:text-accent-ink">
                    <span className="text-lg font-semibold">{c.title}</span>
                    {c.meta && <span className="text-sm text-muted">{c.meta}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {profiles.length > 0 && (
        <section aria-labelledby="elsewhere" className="container-page pb-20 pt-12 sm:pb-24 sm:pt-16">
          <h2 id="elsewhere" className="font-serif text-[1.75rem] font-medium sm:text-[2rem]">
            Elsewhere
          </h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(13.75rem,1fr))]">
            {profiles.map((p) => (
              <li key={p.id}>
                <a href={p.url} rel="me noopener noreferrer" target="_blank" className="flex h-full flex-col gap-1 rounded-lg border border-line bg-surface px-6 py-5.5 transition-colors hover:border-line-field">
                  <span className="flex items-center gap-2 text-lg font-semibold">
                    <ProfileIcon platform={p.platform} size={17} /> {p.label || p.platform} ↗<span className="sr-only"> (opens in a new tab)</span>
                  </span>
                  <span className="text-sm text-muted">{p.handle || hostnameOf(p.url)}</span>
                </a>
              </li>
            ))}
            <li>
              <Link href="/sparktribe" className="flex h-full flex-col gap-1 rounded-lg border border-line bg-surface px-6 py-5.5 transition-colors hover:border-line-field">
                <span className="text-lg font-semibold">SparkTribe</span>
                <span className="text-sm text-muted">Learning in Tamil</span>
              </Link>
            </li>
          </ul>
        </section>
      )}
    </>
  );
}
