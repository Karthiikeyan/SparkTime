import Link from "next/link";
import { ActiveSection } from "@/components/content/islands/active-section";
import { DocContent } from "@/components/content/renderer";
import { JsonLd } from "@/components/seo/json-ld";
import { PageHeader } from "@/components/ui/page-header";
import { TocDisclosure, TocRail } from "@/components/ui/toc";
import { cn } from "@/lib/cn";
import { extractHeadings } from "@/lib/content/derive";
import { outlineIds, PROGRESS_MIN_WORDS, readingOutline } from "@/lib/content/outline";
import { absoluteUrl } from "@/lib/content/paths";
import { stripPlaceholders } from "@/lib/content/placeholders";
import { formatDate } from "@/lib/dates";
import { breadcrumbSchema, graph, webPageSchema, type JsonLd as JsonLdData } from "@/lib/seo/json-ld";
import { siteUrl } from "@/server/env";
import { mediaForDoc, resolveReferences, type Card, type PublicDocument } from "@/server/services/public-content";
import type { MediaAsset } from "@/lib/media";

export type Segment = Array<{ label: string; href: string }>;

/**
 * The layout of a CMS-backed page (/now, /uses, /privacy-policy, any page you add): a header with an
 * optional About / Now switch, then the page's own text in a reading column with "On this page" beside
 * it. The owner's unfilled prompts are left out; nothing is changed in the stored document.
 */
export function SystemLayout({
  doc,
  refs,
  media,
  eyebrow,
  showUpdated = false,
  segment,
  children,
}: {
  doc: PublicDocument;
  refs: Map<string, Card>;
  media: Map<string, MediaAsset>;
  eyebrow?: string;
  showUpdated?: boolean;
  segment?: Segment;
  children?: React.ReactNode;
}) {
  const body = stripPlaceholders(doc.content);
  const outline = readingOutline(extractHeadings(body), doc.wordCount);
  const updated = doc.modifiedAt ?? doc.publishedAt;
  const line = [eyebrow, showUpdated && updated ? `Updated ${formatDate(updated, "long")}` : null].filter(Boolean).join(" · ");
  return (
    <>
      {doc.wordCount >= PROGRESS_MIN_WORDS && <div className="reading-progress" aria-hidden="true" />}
      <PageHeader width="narrow" size="index" eyebrow={line || undefined} title={doc.title} lede={doc.excerpt || undefined}>
        {segment && segment.length > 1 && (
          <nav aria-label="Section" className="order-first mb-6 flex gap-1.5 sm:mb-7">
            {segment.map((s) => {
              const here = s.href === doc.path;
              return (
                <Link key={s.href} href={s.href} aria-current={here ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-full px-3.5 text-sm", here ? "bg-ink text-bg" : "border border-line-strong bg-surface text-ink hover:border-line-field")}>
                  {s.label}
                </Link>
              );
            })}
          </nav>
        )}
      </PageHeader>
      <div className="mx-auto w-full max-w-[68.75rem] px-4 pb-20 pt-10 sm:px-8 sm:pb-24 sm:pt-12">
        <div className={cn(outline && "rail:flex rail:items-start rail:justify-between rail:gap-16")}>
          <article className="min-w-0 max-w-[45rem] flex-[1_1_36rem]">
            {outline && <TocDisclosure items={outline} className="mb-8" />}
            <DocContent doc={body} context={{ refs, media }} className="[&>*]:mx-0" />
          </article>
          {outline && <TocRail items={outline} className="w-60 shrink-0" />}
        </div>
        {children}
      </div>
      {outline && <ActiveSection ids={outlineIds(outline)} />}
    </>
  );
}

/** A page of the CMS with its own structured data. */
export async function SystemPage({
  doc,
  eyebrow,
  showUpdated = false,
  jsonLdType = "WebPage",
  extraJsonLd = [],
  segment,
  children,
}: {
  doc: PublicDocument;
  eyebrow?: string;
  showUpdated?: boolean;
  jsonLdType?: "WebPage" | "ProfilePage" | "AboutPage" | "CollectionPage";
  extraJsonLd?: Array<JsonLdData | null>;
  segment?: Segment;
  children?: React.ReactNode;
}) {
  const [refs, media] = await Promise.all([resolveReferences(doc.content), mediaForDoc(doc.content)]);
  const base = siteUrl();
  const url = absoluteUrl(base, doc.path);
  return (
    <>
      <JsonLd
        data={graph(
          webPageSchema({ siteUrl: base, url, name: doc.seoTitle || doc.title, description: doc.seoDescription || doc.excerpt, type: jsonLdType, mainEntity: jsonLdType === "ProfilePage" ? { "@id": `${base}/#person` } : undefined }),
          breadcrumbSchema([
            { name: "Home", url: base },
            { name: doc.title, url },
          ]),
          ...extraJsonLd,
        )}
      />
      <SystemLayout doc={doc} refs={refs} media={media} eyebrow={eyebrow} showUpdated={showUpdated} segment={segment}>
        {children}
      </SystemLayout>
    </>
  );
}
