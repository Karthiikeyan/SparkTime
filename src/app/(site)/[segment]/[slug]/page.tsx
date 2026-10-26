import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { InterviewCompanyHubView, interviewCompanyHubMetadata } from "@/components/pages/interview-index-view";
import { DocumentView } from "@/components/templates/document-view";
import { siteUrl } from "@/server/env";
import { documentMetadata, pageMetadata } from "@/server/seo/metadata";
import { loadDocumentPage } from "@/server/services/document-page";
import { getInterviewCompany, getInterviewSidebar } from "@/server/services/interviews";
import { getDocumentByTypeAndSlug } from "@/server/services/public-content";
import { resolveRedirect } from "@/server/services/redirects";
import { resolveSegment } from "@/server/services/segment";

// ISR: rendered on first request, cached, and invalidated on publish.
export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ segment: string; slug: string }> };

/** /interviews/{company}: a page built from the company's published roles, when the company has no page (document) of its own. */
async function companyHub(segment: string, slug: string) {
  const target = await resolveSegment(segment);
  if (target.kind !== "type" || target.type.template !== "interview") return null;
  const company = await getInterviewCompany(target.type, slug);
  return company && !company.page ? { type: target.type, company } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { segment, slug } = await params;
  const doc = await getDocumentByTypeAndSlug(segment, slug);
  if (doc) return documentMetadata(doc);
  const hub = await companyHub(segment, slug);
  // A company's roles on one page: a way into each role's page, indexed like the directory above it.
  if (hub) return pageMetadata(interviewCompanyHubMetadata(hub.type, hub.company));
  return { title: "Not found", robots: { index: false } };
}

export default async function DocumentPage({ params }: Props) {
  const { segment, slug } = await params;
  const doc = await getDocumentByTypeAndSlug(segment, slug);
  if (!doc) {
    const hub = await companyHub(segment, slug);
    if (hub) return <InterviewCompanyHubView type={hub.type} company={hub.company} siteUrl={siteUrl()} sidebar={await getInterviewSidebar(hub.type, hub.company.slug)} />;
    const target = await resolveRedirect(`/${segment}/${slug}`);
    if (target) (target.permanent ? permanentRedirect : redirect)(target.location);
    notFound();
  }
  const data = await loadDocumentPage(doc);
  return <DocumentView data={data} />;
}
