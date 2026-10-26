import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/admin-shell";
import { SettingsEditor } from "@/components/admin/settings-editor";
import { isDevLoginEnabled } from "@/server/auth/allowlist";
import { isGitHubConfigured } from "@/server/auth/github";
import { requireAdminPage } from "@/server/auth/guard";
import { env, mediaConfig, siteUrl } from "@/server/env";
import { listContentTypes } from "@/server/services/content-types";
import { listDocuments } from "@/server/services/documents";
import { getMediaAssets } from "@/server/services/media";
import { loadAllSettings } from "@/server/services/settings";
import { listCategories, listTags } from "@/server/services/taxonomy";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireAdminPage();
  const [settings, types, categories, tags] = await Promise.all([loadAllSettings(), listContentTypes(), listCategories(), listTags()]);
  const collectionTypeIds = types.filter((t) => t.template === "collection").map((t) => t.id);
  const collections = (await Promise.all(collectionTypeIds.map((typeId) => listDocuments(actor, { typeId, limit: 200 })))).flatMap((r) => r.items);
  const portrait = settings.identity.imageMediaId ? (await getMediaAssets([settings.identity.imageMediaId])).get(settings.identity.imageMediaId) ?? null : null;
  const e = env();
  let mediaDriver = "local";
  try {
    mediaDriver = mediaConfig().driver;
  } catch {
    mediaDriver = "unconfigured";
  }
  const dbUrl = e.DATABASE_URL;
  const database = /supabase/.test(dbUrl) ? "Supabase Postgres" : /127\.0\.0\.1|localhost/.test(dbUrl) ? "Local Postgres (PGlite)" : "PostgreSQL";

  return (
    <div>
      <PageHeader title="Settings" description="Identity, SEO, the site's name and wording, the home page, sections and page bindings." />
      <SettingsEditor
        initial={{
          ...settings,
          portrait,
          types: types.map((t) => ({ id: t.id, name: t.name })),
          // What the Site sections editor needs to preview each section's automatic formats as you edit.
          sectionTypes: types.map((t) => ({ id: t.id, name: t.pluralName, template: t.template, routing: t.routing, archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null, fields: t.fields.map((f) => ({ role: f.role })) })),
          collections: collections.map((c) => ({ id: c.id, name: `${c.title || "Untitled"}${c.status !== "published" ? ` (${c.status})` : ""}` })),
          categories: categories.map((c) => ({ id: c.id, name: c.name })),
          tags: tags.map((t) => ({ id: t.id, name: t.name })),
          topics: categories.filter((c) => !c.parentId && !c.archivedAt).map((c) => ({ slug: c.slug, name: c.name })),
          system: {
            siteUrl: siteUrl(),
            mediaDriver,
            github: isGitHubConfigured(),
            allowlist: e.ADMIN_GITHUB_ID ? `GitHub id ${e.ADMIN_GITHUB_ID}` : e.ADMIN_GITHUB_LOGIN ? `@${e.ADMIN_GITHUB_LOGIN} (prefer ADMIN_GITHUB_ID)` : "not set",
            database,
            devLogin: isDevLoginEnabled(),
          },
        }}
      />
    </div>
  );
}
