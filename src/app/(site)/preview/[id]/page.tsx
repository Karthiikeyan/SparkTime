import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentView } from "@/components/templates/document-view";
import { requireAdminPage } from "@/server/auth/guard";
import { buildPreviewDocument } from "@/server/services/preview";
import { loadDocumentPage } from "@/server/services/document-page";

/**
 * Admin-only preview of exactly how a document (including staged edits,
 * drafts and private documents) will look. Rendered per request, never
 * cached, never indexed (X-Robots-Tag + robots meta), and unreachable
 * without an admin session — there are no shareable preview tokens.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminPage();
  const { id } = await params;
  const doc = await buildPreviewDocument(actor, id);
  if (!doc) notFound();
  const data = await loadDocumentPage(doc, { preview: true });
  return (
    <>
      <div className="sticky top-16 z-30 border-b border-accent/40 bg-accent-soft">
        <div className="container-page flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <p>
            <strong>Preview</strong> · {doc.status}
            {doc.visibility !== "public" && ` · ${doc.visibility}`} · only you can see this
          </p>
          <Link href={`/admin/documents/${id}`} className="font-medium underline underline-offset-4">
            Back to editor
          </Link>
        </div>
      </div>
      <DocumentView data={data} preview />
    </>
  );
}
