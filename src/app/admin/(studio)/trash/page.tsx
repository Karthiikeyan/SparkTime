import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/admin-shell";
import { ContentOperations } from "@/components/admin/content-operations";
import { requireAdminPage } from "@/server/auth/guard";
import { listDocuments } from "@/server/services/documents";

export const metadata: Metadata = { title: "Trash" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const PER_PAGE = 50;

export default async function TrashPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireAdminPage();
  const sp = await searchParams;
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const result = await listDocuments(actor, { status: "trashed", limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
  const pages = Math.max(1, Math.ceil(result.total / PER_PAGE));

  return (
    <div>
      <PageHeader
        title="Trash"
        description={`${result.total.toLocaleString("en-IN")} document${result.total === 1 ? "" : "s"}. Trashed documents are off the site and can’t be edited. Restore returns them as drafts; deleting permanently can’t be undone.`}
        actions={
          <Link href="/admin/documents" className="btn btn-ghost btn-md">
            Documents
          </Link>
        }
      />
      <ContentOperations
        mode="trash"
        total={result.total}
        filter={{ status: "trashed" }}
        rows={result.items.map((d) => ({
          id: d.id,
          title: d.title,
          path: d.path,
          typeName: d.typeName,
          status: d.status,
          visibility: d.visibility,
          robotsIndex: d.robotsIndex,
          typeIndexable: d.typeIndexable,
          featured: d.featured,
          hasStagedChanges: d.hasStagedChanges,
          publishedAt: d.publishedAt?.toISOString() ?? null,
          updatedAt: d.updatedAt.toISOString(),
          trashedAt: d.trashedAt?.toISOString() ?? null,
          trashedBy: d.trashedBy,
        }))}
        options={{ topics: [], tags: [], collections: [] }}
      />
      {pages > 1 && (
        <nav className="flex items-center justify-between px-6 pb-8 text-sm lg:px-10" aria-label="Pagination">
          {page > 1 ? <Link href={`/admin/trash?page=${page - 1}`} className="link-quiet">← Previous</Link> : <span />}
          <span className="text-subtle">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={`/admin/trash?page=${page + 1}`} className="link-quiet">Next →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
