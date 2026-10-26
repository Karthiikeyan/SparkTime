"use client";

import { ArchiveRestore, Eye, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDate } from "@/lib/dates";
import { api, errorMessage } from "./api";
import { ConfirmDialog } from "./modal";
import { useToast } from "./toast";

/** What the editor route shows for a document in the Trash: it is frozen, so only restore or delete. */
export function TrashedDocument({ doc }: { doc: { id: string; title: string; slug: string; typeName: string; trashedAt: string | null; trashedBy: string | null; wordCount: number } }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const restore = async () => {
    setBusy(true);
    try {
      const result = await api<{ failed: number; items: Array<{ message?: string }> }>("/api/admin/documents/bulk", { method: "POST", body: { operationId: crypto.randomUUID(), ids: [doc.id], action: { action: "restore" } } });
      if (result.failed) throw new Error(result.items[0]?.message ?? "It couldn’t be restored.");
      toast.success("Restored as a draft.");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-wider text-danger">In the Trash</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{doc.title || "Untitled"}</h1>
      <p className="mt-2 text-sm text-muted">
        {doc.typeName} · {doc.wordCount.toLocaleString("en-IN")} words
        {doc.trashedAt && ` · moved to the Trash ${formatDate(doc.trashedAt, "medium")}`}
        {doc.trashedBy && ` by ${doc.trashedBy}`}
      </p>
      <p className="mt-6 text-sm text-muted">It’s hidden from the site and can’t be edited. Restoring brings it back as a draft with its topics, tags, links and collection places.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-md" onClick={() => void restore()} disabled={busy}>
          <ArchiveRestore size={15} aria-hidden="true" /> Restore as draft
        </button>
        <a href={`/preview/${doc.id}`} target="_blank" rel="noopener" className="btn btn-ghost btn-md">
          <Eye size={15} aria-hidden="true" /> Preview
        </a>
        <button type="button" className="btn btn-md text-danger hover:bg-danger/10" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={15} aria-hidden="true" /> Delete permanently…
        </button>
        <Link href="/admin/trash" className="btn btn-ghost btn-md ml-auto">
          Back to Trash
        </Link>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        destructive
        title="Permanently delete this document?"
        body={<p>This cannot be undone. Its topic and tag links, relationships and collection places are removed too; media files stay in the library.</p>}
        requireText={doc.slug}
        confirmLabel="Permanently delete"
        onConfirm={async (typed) => {
          try {
            await api(`/api/admin/documents/${doc.id}`, { method: "DELETE", body: { confirmation: typed } });
            toast.success("Permanently deleted.");
            router.push("/admin/trash");
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
