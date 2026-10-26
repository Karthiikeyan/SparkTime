import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/admin-shell";
import { TypeBuilder, type TypeDraft } from "@/components/admin/type-builder";
import { requireAdminPage } from "@/server/auth/guard";
import { listContentTypes } from "@/server/services/content-types";
import { dashboardStats } from "@/server/services/documents";

export const metadata: Metadata = { title: "Edit content type" };

export default async function TypePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminPage();
  const { id } = await params;
  const [types, stats] = await Promise.all([listContentTypes(), dashboardStats(actor)]);
  const all = types.map((t) => ({ id: t.id, name: t.name }));

  let draft: TypeDraft;
  if (id === "new") {
    draft = { name: "", pluralName: "", slug: "", description: "", template: "editorial", schemaType: "Article", icon: "file", indexable: true, inFeeds: true, showInQuickCreate: true, isSystem: false, fields: [], documentCount: 0 };
  } else {
    const type = types.find((t) => t.id === id);
    if (!type) notFound();
    draft = {
      id: type.id,
      name: type.name,
      pluralName: type.pluralName,
      slug: type.slug,
      description: type.description,
      template: type.template,
      schemaType: type.schemaType,
      icon: type.icon,
      indexable: type.indexable,
      inFeeds: type.inFeeds,
      showInQuickCreate: type.showInQuickCreate,
      isSystem: type.isSystem,
      fields: type.fields,
      documentCount: stats.byType[type.id] ?? 0,
    };
  }

  return (
    <div>
      <PageHeader title={id === "new" ? "New content type" : draft.name} description="Fields become a properties form in the editor; roles tell templates and structured data what each field means." />
      <TypeBuilder initial={draft} allTypes={all} />
    </div>
  );
}
