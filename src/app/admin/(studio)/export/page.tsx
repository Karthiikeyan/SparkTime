import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/admin-shell";
import { ExportWorkbench } from "@/components/admin/export/export-workbench";
import { requireAdminPage } from "@/server/auth/guard";
import { listContentTypes } from "@/server/services/content-types";
import { listDocuments } from "@/server/services/documents";
import { listCategories, listTags, taxonomyUsage } from "@/server/services/taxonomy";

export const metadata: Metadata = { title: "Export" };

export default async function ExportPage() {
  const actor = await requireAdminPage();
  const [types, categories, tags, usage] = await Promise.all([listContentTypes(), listCategories(), listTags(), taxonomyUsage(actor)]);
  const collectionTypes = types.filter((t) => t.template === "collection");
  const collections = (await Promise.all(collectionTypes.map((t) => listDocuments(actor, { typeId: t.id, limit: 200, sort: "title" })))).flatMap((r) => r.items);
  return (
    <div>
      <PageHeader
        title="Export"
        description="Download your content as a portable package, readable Markdown, a manifest or media — for backups, or to move to another site."
        actions={
          <Link href="/admin/import" className="btn btn-ghost btn-md">
            Import
          </Link>
        }
      />
      <ExportWorkbench
        types={types.map((t) => ({ id: t.id, name: t.pluralName || t.name }))}
        topics={categories.map((c) => ({ id: c.id, name: c.parentId ? `${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}` : c.name, count: usage.categories[c.id] ?? 0 }))}
        tags={tags.map((t) => ({ id: t.id, name: t.name, count: usage.tags[t.id] ?? 0 }))}
        collections={collections.map((d) => ({ id: d.id, name: `${d.title || "Untitled"} (${d.typeName})` }))}
      />
    </div>
  );
}
