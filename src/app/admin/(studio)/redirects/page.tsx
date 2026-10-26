import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/admin-shell";
import { RedirectsManager } from "@/components/admin/redirects-manager";
import { requireAdminPage } from "@/server/auth/guard";
import { listRedirects } from "@/server/services/redirects";

export const metadata: Metadata = { title: "Redirects" };

export default async function RedirectsPage() {
  const actor = await requireAdminPage();
  const rows = await listRedirects(actor);
  return (
    <div>
      <PageHeader title="Redirects" description="Keep old links and search rankings working when URLs change." />
      <RedirectsManager rows={rows.map((r) => ({ ...r, lastHitAt: r.lastHitAt?.toISOString() ?? null }))} />
    </div>
  );
}
