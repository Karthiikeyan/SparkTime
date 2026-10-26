import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SystemPage } from "@/components/pages/system-page";
import { documentMetadata } from "@/server/seo/metadata";
import { getRootPage } from "@/server/services/public-content";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getRootPage("now");
  return doc ? documentMetadata(doc) : { title: "Now", robots: { index: false } };
}

export default async function NowPage() {
  const [doc, about] = await Promise.all([getRootPage("now"), getRootPage("about")]);
  if (!doc) notFound();
  const segment = about ? [{ label: "About", href: about.path }, { label: "Now", href: doc.path }] : undefined;
  return <SystemPage doc={doc} eyebrow="Now" showUpdated segment={segment} />;
}
