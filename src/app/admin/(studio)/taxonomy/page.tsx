import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/admin-shell";
import { TaxonomyManager } from "@/components/admin/taxonomy-manager";
import { extractPlainText } from "@/lib/content/derive";
import { requireAdminPage } from "@/server/auth/guard";
import { listCategories, listTags, taxonomyUsage } from "@/server/services/taxonomy";

export const metadata: Metadata = { title: "Topics & tags" };

export default async function TaxonomyPage() {
  const actor = await requireAdminPage();
  const [categories, tags, usage] = await Promise.all([listCategories(), listTags(), taxonomyUsage(actor)]);
  return (
    <div>
      <PageHeader title="Topics & tags" description="Categories are the hubs readers browse; tags are the finer threads that connect pieces across topics." />
      <TaxonomyManager
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description,
          introText: c.intro ? extractPlainText(c.intro) : "",
          parentId: c.parentId,
          accent: c.accent,
          featured: c.featured,
          seoTitle: c.seoTitle,
          seoDescription: c.seoDescription,
          robotsIndex: c.robotsIndex,
          archived: Boolean(c.archivedAt),
        }))}
        tags={tags.map((t) => ({ id: t.id, name: t.name, slug: t.slug, description: t.description, robotsIndex: t.robotsIndex }))}
        categoryUsage={usage.categories}
        tagUsage={usage.tags}
      />
    </div>
  );
}
