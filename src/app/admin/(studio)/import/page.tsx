import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/admin-shell";
import { ImportWorkbench } from "@/components/admin/import/import-workbench";
import { isUuid } from "@/lib/content/blocks";
import { requireAdminPage } from "@/server/auth/guard";
import { listContentTypes } from "@/server/services/content-types";
import { listCategories } from "@/server/services/taxonomy";

export const metadata: Metadata = { title: "Import" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ImportPage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage();
  const sp = await searchParams;
  const job = typeof sp.job === "string" && isUuid(sp.job) ? sp.job : null;
  const [types, categories] = await Promise.all([listContentTypes(), listCategories()]);
  return (
    <div>
      <PageHeader
        title="Import"
        description="Bring in folders of Markdown, Notion and Obsidian exports, packages from this studio, or a company's interview research. You see what every item will become — draft or published, indexed or not — before anything is written."
        actions={
          <Link href="/admin/import/history" className="btn btn-ghost btn-md">
            Import history
          </Link>
        }
      />
      <ImportWorkbench
        key={job ?? "new"}
        resumeId={job}
        types={types.filter((t) => !t.archivedAt).map((t) => ({ id: t.id, slug: t.slug, name: t.name, template: t.template, indexable: t.indexable }))}
        topics={categories.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
      />
    </div>
  );
}
