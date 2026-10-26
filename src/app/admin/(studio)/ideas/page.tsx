import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/admin-shell";
import { IdeaList } from "@/components/admin/idea-list";
import { QuickCapture } from "@/components/admin/quick-capture";
import { requireAdminPage } from "@/server/auth/guard";
import { listContentTypes } from "@/server/services/content-types";
import { listDocuments } from "@/server/services/documents";

export const metadata: Metadata = { title: "Ideas" };

export default async function IdeasPage() {
  const actor = await requireAdminPage();
  const [types, ideas] = await Promise.all([listContentTypes(), listDocuments(actor, { status: "idea", limit: 200, sort: "created" })]);
  const creatable = types.filter((t) => !t.archivedAt && t.routing === "type").map((t) => ({ id: t.id, name: t.name }));
  return (
    <div>
      <PageHeader title="Ideas" description="Capture fast, shape later. Converting an idea keeps its words, tags and links — nothing is duplicated." />
      <div className="max-w-4xl space-y-8 px-6 py-8 lg:px-10">
        <QuickCapture types={creatable} defaultTypeId={types.find((t) => t.slug === "note")?.id ?? creatable[0]?.id ?? ""} />
        <IdeaList
          ideas={ideas.items.map((i) => ({ id: i.id, title: i.title, excerpt: i.excerpt, typeName: i.typeName, typeId: i.typeId, createdAt: i.createdAt.toISOString() }))}
          types={creatable}
        />
      </div>
    </div>
  );
}
