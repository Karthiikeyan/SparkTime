import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/admin-shell";
import { NavigationEditor, type NavDraft } from "@/components/admin/navigation-editor";
import type { NavigationItemRow } from "@/server/db/schema";
import { requireAdminPage } from "@/server/auth/guard";
import { listContentTypes } from "@/server/services/content-types";
import { documentTitles } from "@/server/services/documents";
import { listNavigationItems } from "@/server/services/navigation";
import { listCategories } from "@/server/services/taxonomy";

export const metadata: Metadata = { title: "Navigation" };

export default async function NavigationPage() {
  const actor = await requireAdminPage();
  const [rows, types, categories] = await Promise.all([listNavigationItems(actor), listContentTypes(), listCategories()]);
  const titles = await documentTitles(actor, rows.filter((r) => r.linkType === "document" && r.refId).map((r) => r.refId!));
  const build = (location: string, parentId: string | null): NavDraft[] =>
    rows
      .filter((r: NavigationItemRow) => r.location === location && r.parentId === parentId)
      .sort((a, b) => a.position - b.position)
      .map((r) => ({
        key: r.id,
        label: r.label,
        linkType: r.linkType as NavDraft["linkType"],
        href: r.href ?? "",
        refId: r.refId ?? "",
        refLabel: r.refId ? titles[r.refId] ?? "" : "",
        visible: r.visible,
        children: build(location, r.id),
      }));

  return (
    <div>
      <PageHeader title="Navigation" description="Menus link to content by reference, so renames and new URLs never break them." />
      <NavigationEditor
        primary={build("primary", null)}
        footer={build("footer", null)}
        types={types.filter((t) => t.routing === "type").map((t) => ({ id: t.id, name: t.pluralName }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
