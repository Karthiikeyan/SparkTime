"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "../api";
import { ConfirmDialog } from "../modal";
import { useToast } from "../toast";

/** Retry / resume / cancel for one import in history. */
export function ImportJobActions({ id, status, failed }: { id: string; status: string; failed: number }) {
  const router = useRouter();
  const toast = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const control = async (action: "retry" | "cancel") => {
    try {
      await api(`/api/admin/import/jobs/${id}/control`, { method: "POST", body: { action } });
      if (action === "retry") router.push(`/admin/import?job=${id}`);
      else router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      {(status === "running" || status === "analyzed") && (
        <Link href={`/admin/import?job=${id}`} className="btn btn-primary btn-md">
          {status === "running" ? "Resume" : "Review and approve"}
        </Link>
      )}
      {(status === "partial" || status === "failed") && failed > 0 && (
        <button type="button" className="btn btn-primary btn-md" onClick={() => void control("retry")}>
          Retry {failed} failed step{failed === 1 ? "" : "s"}
        </button>
      )}
      {(status === "running" || status === "analyzed" || status === "staging") && (
        <button type="button" className="btn btn-ghost btn-md" onClick={() => setConfirmCancel(true)}>
          Cancel import
        </button>
      )}
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={async () => {
          setConfirmCancel(false);
          await control("cancel");
        }}
        title="Cancel this import?"
        confirmLabel="Cancel import"
        destructive
        body="Remaining steps won't run. Documents already imported stay as they are (private drafts unless you chose otherwise); delete them from Documents if you don't want them."
      />
    </>
  );
}
