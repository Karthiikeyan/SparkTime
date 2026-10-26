import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/admin-shell";
import { Badge } from "@/components/admin/badge";
import { ContentIcon } from "@/components/ui/icon";
import { TEMPLATE_INFO } from "@/lib/content/model";
import { requireAdminPage } from "@/server/auth/guard";
import { listContentTypes } from "@/server/services/content-types";
import { dashboardStats } from "@/server/services/documents";

export const metadata: Metadata = { title: "Content types" };

export default async function TypesPage() {
  const actor = await requireAdminPage();
  const [types, stats] = await Promise.all([listContentTypes(), dashboardStats(actor)]);
  return (
    <div>
      <PageHeader
        title="Content types"
        description="Every document has a type. Create new types — fields, template, URL — without touching code."
        actions={
          <Link href="/admin/types/new" className="btn btn-accent btn-md">
            New content type
          </Link>
        }
      />
      <ul className="grid gap-3 px-6 py-8 sm:grid-cols-2 lg:px-10 xl:grid-cols-3">
        {types.map((t) => (
          <li key={t.id}>
            <Link href={`/admin/types/${t.id}`} className="flex h-full items-start gap-3 rounded-md border border-line bg-surface p-4 hover:border-accent">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-line text-muted">
                <ContentIcon name={t.icon} size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-medium">
                  {t.name} {t.isSystem && <Badge>system</Badge>} {t.archivedAt && <Badge>archived</Badge>}
                </span>
                <span className="block font-mono text-xs text-subtle">{t.routing === "root" ? "/{slug}" : `/${t.slug}/{slug}`}</span>
                <span className="mt-1 block text-xs text-muted">
                  {TEMPLATE_INFO[t.template].label} · {t.fields.length} fields · {stats.byType[t.id] ?? 0} docs
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
