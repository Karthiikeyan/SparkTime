import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoursesIndex } from "@/components/pages/courses-index";
import { isCourseType } from "@/lib/content/kind";
import { typeIndexPath } from "@/lib/content/paths";
import { siteUrl } from "@/server/env";
import { pageMetadata } from "@/server/seo/metadata";
import { listContentTypes } from "@/server/services/content-types";
import { listSeries } from "@/server/services/public-content";

type Props = { searchParams: Promise<{ topic?: string | string[] }> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 80) ?? "";

async function load() {
  const type = (await listContentTypes()).find(isCourseType);
  if (!type) return null;
  return { type, all: await listSeries({ typeIds: [type.id], limit: 100 }) };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const data = await load();
  const filtered = Boolean(first((await searchParams).topic));
  // A filtered view is a second address for the same list: it points at /course and stays out of the index.
  return pageMetadata({
    title: "Courses",
    description: "Free courses on technology and careers: structured paths you read in order, every lesson with exercises.",
    path: data ? typeIndexPath(data.type) : "/course",
    noindex: !data || data.all.length === 0 || filtered,
  });
}

export default async function CoursesPage({ searchParams }: Props) {
  const data = await load();
  if (!data) notFound();
  const topic = first((await searchParams).topic) || null;
  const courses = topic ? data.all.filter((c) => c.primaryCategory?.slug === topic) : data.all;
  return <CoursesIndex courses={courses} all={data.all} topic={topic} path={typeIndexPath(data.type)} siteUrl={siteUrl()} startHereHref="/start-here" />;
}
