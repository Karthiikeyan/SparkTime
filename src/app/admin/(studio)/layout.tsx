import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { ToastProvider } from "@/components/admin/toast";
import { requireAdminPage } from "@/server/auth/guard";
import { unreadCount } from "@/server/services/contact";
import { listContentTypes } from "@/server/services/content-types";

export const metadata: Metadata = { title: { default: "Studio", template: "%s · Studio" }, robots: { index: false, follow: false } };

/** Layer 2 of admin protection: every studio page re-validates the session server-side. */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAdminPage();
  const [types, unread] = await Promise.all([listContentTypes(), unreadCount(actor)]);
  return (
    <ToastProvider>
      <AdminShell login={actor.login} unread={unread} types={types.filter((t) => t.showInQuickCreate && !t.archivedAt).map((t) => ({ id: t.id, name: t.name }))}>
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
