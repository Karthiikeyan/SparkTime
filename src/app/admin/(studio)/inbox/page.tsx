import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/admin-shell";
import { InboxView } from "@/components/admin/inbox";
import { requireAdminPage } from "@/server/auth/guard";
import { listMessages } from "@/server/services/contact";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const actor = await requireAdminPage();
  const archived = (await searchParams).archived === "1";
  const messages = await listMessages(actor, { archived });
  return (
    <div>
      <PageHeader title="Inbox" description="Messages from the contact form. Stored in your database — nothing is emailed to third parties." />
      <InboxView
        archived={archived}
        messages={messages.map((m) => ({ id: m.id, name: m.name, email: m.email, reason: m.reason, message: m.message, createdAt: m.createdAt.toISOString(), read: Boolean(m.readAt), archived: Boolean(m.archivedAt) }))}
      />
    </div>
  );
}
