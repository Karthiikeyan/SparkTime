import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MainTopic, NoteCard } from "@/components/pages/topics-parts";
import { JsonLd } from "@/components/seo/json-ld";
import { Band } from "@/components/ui/band";
import { PageHeader } from "@/components/ui/page-header";
import { graph, webPageSchema } from "@/lib/seo/json-ld";
import { isNotesTopic } from "@/lib/site-config";
import { siteUrl } from "@/server/env";
import { pageMetadata } from "@/server/seo/metadata";
import { getTopicDirectory } from "@/server/services/public-content";
import { getFeaturedTopics } from "@/server/services/settings";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const directory = await getTopicDirectory();
  const names = directory.map((d) => d.topic.name).slice(0, 5).join(", ");
  return pageMetadata({ title: "Topics", description: names ? `Every subject in the library — ${names} and what sits beneath each.` : "Every subject in the library.", path: "/topics", noindex: directory.length === 0 });
}

/** The directory of subjects: the main topics in columns, everything else gathered as Notes. */
export default async function TopicsPage() {
  const [directory, featured] = await Promise.all([getTopicDirectory(), getFeaturedTopics()]);
  if (!directory.length) notFound();
  const main = directory.filter((d) => !isNotesTopic(d.topic, featured));
  const notes = directory.filter((d) => isNotesTopic(d.topic, featured));
  const base = siteUrl();
  return (
    <>
      <JsonLd data={graph(webPageSchema({ siteUrl: base, url: `${base}/topics`, name: "Topics", type: "CollectionPage" }))} />
      <PageHeader
        eyebrow="The library"
        title="Topics"
        lede={main.length && notes.length ? `${main.length === 1 ? "One main subject" : `${main.length} main subjects`}, plus notes on everything else I write about.` : "Every subject I write about, and what sits beneath each."}
      />
      {main.length > 0 && (
        <section aria-label="Main topics" className="container-page pb-6 pt-10 sm:pt-14">
          <div className="grid border-t border-ink md:grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
            {main.map((entry) => (
              <MainTopic key={entry.topic.id} entry={entry} />
            ))}
          </div>
        </section>
      )}
      {notes.length > 0 && (
        <Band id="notes" labelledBy="notes-heading" className="mt-10" innerClassName="sm:py-16">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="notes-heading" className="font-serif text-[2rem] font-medium tracking-[-0.02em] sm:text-[2.5rem]">
                Notes
              </h2>
              <p className="mt-1.5 text-ink-2">Everything else I write about: learning, building, life and the in-between.</p>
            </div>
            <Link href="/notes" className="inline-flex min-h-11 items-center font-semibold text-accent-ink hover:underline">
              Open the Notes page →
            </Link>
          </div>
          <ul className="mt-7 grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))]">
            {notes.map((entry) => (
              <NoteCard key={entry.topic.id} entry={entry} />
            ))}
          </ul>
        </Band>
      )}
      <section className="container-page py-14 text-center sm:pb-24">
        <p className="font-serif text-[1.75rem]">Looking for something specific?</p>
        <Link href="/search" className="mt-3.5 inline-flex min-h-12 items-center rounded-[8px] bg-accent px-5.5 font-semibold text-accent-contrast hover:bg-accent-hover">
          Search the library
        </Link>
      </section>
    </>
  );
}
