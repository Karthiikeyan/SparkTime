import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { CardGrid } from "@/components/content/cards";
import { TemplateListing } from "@/components/content/listing";
import { JsonLd } from "@/components/seo/json-ld";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { absoluteUrl, typeIndexPath } from "@/lib/content/paths";
import type { Identity } from "@/lib/settings";
import { breadcrumbSchema, graph, itemListSchema, webPageSchema } from "@/lib/seo/json-ld";
import { safeHref } from "@/lib/url";
import type { TypeShelf, WorkPageData } from "@/server/services/hub-page";

/**
 * Work: what I build, for builders and recruiters alike. It is reached by its address (it is not in
 * the menus): SparkTribe first, what is in progress, then each kind of work on its own shelf.
 */

const pieces = (n: number) => `${n} ${n === 1 ? "piece" : "pieces"}`;

function Shelf({ shelf }: { shelf: TypeShelf }) {
  const more = shelf.total > shelf.items.length;
  return (
    <section aria-labelledby={`shelf-${shelf.type.slug}`}>
      <SectionHeading id={`shelf-${shelf.type.slug}`} title={shelf.type.pluralName} size="md" intro={shelf.type.description || undefined} link={more ? { href: typeIndexPath(shelf.type), label: `All ${shelf.total} →` } : null} />
      {shelf.type.template === "project" ? <CardGrid cards={shelf.items} /> : <TemplateListing template={shelf.type.template} cards={shelf.items} />}
    </section>
  );
}

/** What a recruiter looks for first: the day job and the tools, one quiet line, with the story one click away. */
function DayJob({ identity }: { identity: Identity }) {
  const role = [identity.jobTitle, identity.worksFor].filter(Boolean).join(" at ");
  if (!role && !identity.knowsAbout.length) return null;
  return (
    <dl className="flex flex-col gap-x-10 gap-y-2 text-[0.9375rem] sm:flex-row sm:flex-wrap sm:items-baseline">
      {role && (
        <div className="flex items-baseline gap-2">
          <dt className="caps text-muted">Day job</dt>
          <dd className="text-ink">{role}</dd>
        </div>
      )}
      {identity.knowsAbout.length > 0 && (
        <div className="flex items-baseline gap-2">
          <dt className="caps text-muted">Works with</dt>
          <dd>{identity.knowsAbout.slice(0, 6).join(" · ")}</dd>
        </div>
      )}
      <div>
        <dt className="sr-only">More</dt>
        <dd>
          <Link href="/about" className="inline-flex min-h-11 items-center font-semibold text-accent-ink hover:underline">
            The story so far →
          </Link>
        </dd>
      </div>
    </dl>
  );
}

export function WorkHubView({ data, identity, sparktribeUrl, siteUrl }: { data: WorkPageData; identity: Identity; sparktribeUrl: string; siteUrl: string }) {
  const { hub, inProgress, shelves, sparktribe } = data;
  const url = safeHref(sparktribeUrl);
  const empty = !sparktribe && !inProgress.length && !shelves.length;
  const pageUrl = absoluteUrl(siteUrl, hub.path);
  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl, url: pageUrl, name: hub.title, description: hub.intro, type: "CollectionPage" }),
          breadcrumbSchema([
            { name: "Home", url: siteUrl },
            { name: hub.title, url: pageUrl },
          ]),
          itemListSchema(hub.title, [...inProgress, ...shelves.flatMap((s) => s.items)].map((c) => ({ name: c.title, url: absoluteUrl(siteUrl, c.path) }))),
        )}
      />
      <PageHeader eyebrow={hub.count ? `Work · ${pieces(hub.count)}` : "Work"} title={hub.title} lede={hub.intro || undefined} meta={<DayJob identity={identity} />} />
      <div className="container-page space-y-16 pb-20 pt-10 sm:space-y-20 sm:pb-24 sm:pt-14">
        {sparktribe && (
          <section aria-labelledby="flagship-heading" className="flex flex-wrap items-end justify-between gap-8 rounded-2xl bg-feature p-6 text-feature-text sm:p-10">
            <div className="flex-[1_1_28rem]">
              <p className="caps text-feature-muted">Founder · building now</p>
              <h2 id="flagship-heading" className="mt-2 font-serif text-[2rem] font-medium leading-tight sm:text-[2.5rem]">
                {sparktribe.title}
              </h2>
              {sparktribe.excerpt && <p className="mt-3 max-w-xl text-[1.0625rem] text-feature-2">{sparktribe.excerpt}</p>}
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={sparktribe.path} className="inline-flex min-h-12 items-center rounded-[8px] bg-feature-button px-5 font-semibold text-feature-button-text hover:opacity-90">
                The story →
              </Link>
              {url && (
                <a href={url} rel="noopener" className="inline-flex min-h-12 items-center gap-1.5 rounded-[8px] border border-feature-muted/50 px-5 font-semibold hover:border-feature-muted">
                  Visit {sparktribe.title} <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              )}
            </div>
          </section>
        )}
        {inProgress.length > 0 && (
          <section aria-labelledby="in-progress">
            <SectionHeading id="in-progress" title="In progress" size="md" />
            <CardGrid cards={inProgress} />
          </section>
        )}
        {shelves.map((shelf) => (
          <Shelf key={shelf.type.id} shelf={shelf} />
        ))}
        {empty && (
          <EmptyState title="Nothing published here yet">
            <p>
              Projects and experiments will appear here as they’re written up. Meanwhile, <Link href="/about" className="font-semibold text-accent-ink underline underline-offset-2">read the story so far</Link>.
            </p>
          </EmptyState>
        )}
      </div>
    </>
  );
}
