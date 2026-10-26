import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NoteCard } from "@/components/pages/topics-parts";
import { JsonLd } from "@/components/seo/json-ld";
import { PageHeader } from "@/components/ui/page-header";
import { graph, webPageSchema } from "@/lib/seo/json-ld";
import { isNotesTopic } from "@/lib/site-config";
import { siteUrl } from "@/server/env";
import { pageMetadata } from "@/server/seo/metadata";
import { getTopicDirectory } from "@/server/services/public-content";
import { getFeaturedTopics } from "@/server/services/settings";

export const revalidate = 3600;

/** Every top-level topic outside Technology, Career and Money: same URLs, same pieces, gathered in one place. */
async function notes() {
  const [directory, featured] = await Promise.all([getTopicDirectory(), getFeaturedTopics()]);
  return directory.filter((d) => isNotesTopic(d.topic, featured));
}

export async function generateMetadata(): Promise<Metadata> {
  const directory = await notes();
  const names = directory.map((d) => d.topic.name).join(", ");
  return pageMetadata({
    title: "Notes — everything else I write about",
    description: names ? `Notes on ${names}: everything outside technology, careers and money.` : "Everything outside technology, careers and money.",
    path: "/notes",
    noindex: directory.length === 0,
  });
}

export default async function NotesPage() {
  const directory = await notes();
  if (!directory.length) notFound();
  const base = siteUrl();
  return (
    <>
      <JsonLd data={graph(webPageSchema({ siteUrl: base, url: `${base}/notes`, name: "Notes", type: "CollectionPage" }))} />
      <PageHeader
        breadcrumb={[
          { label: "Library", href: "/library" },
          { label: "Topics", href: "/topics" },
        ]}
        currentLast={false}
        eyebrow="Notes"
        title="Everything else I write about"
        lede={
          <>
            Life, learning, travel and the rest, kept here so the guides stay focused on technology, careers and money. For the full map, see{" "}
            <Link href="/topics" className="font-semibold text-accent-ink underline underline-offset-4">
              all topics
            </Link>
            .
          </>
        }
      />
      <ul className="container-page grid gap-5 pb-20 pt-10 sm:pb-24 md:grid-cols-2 lg:grid-cols-3">
        {directory.map((entry) => (
          <NoteCard key={entry.topic.id} entry={entry} picks />
        ))}
      </ul>
    </>
  );
}
