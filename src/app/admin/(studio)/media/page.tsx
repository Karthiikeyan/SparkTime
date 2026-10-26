import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/admin-shell";
import { MediaLibrary } from "@/components/admin/media-library";
import { requireAdminPage } from "@/server/auth/guard";
import { listMedia } from "@/server/services/media";

export const metadata: Metadata = { title: "Media" };

export default async function MediaPage() {
  const actor = await requireAdminPage();
  const { items, total } = await listMedia(actor, { limit: 200 });
  return (
    <div>
      <PageHeader title="Media" description="Images, PDFs and audio. Stored in Cloudflare R2 in production (locally in .data/media during development)." />
      <MediaLibrary initial={items} total={total} />
    </div>
  );
}
