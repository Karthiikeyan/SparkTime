"use client";

import { CheckCircle2, CircleAlert, FolderOpen, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import type { RunResult } from "@/server/services/import/execute";
import type { ImportJobView } from "@/server/services/import/jobs";
import { Badge } from "../badge";
import { fromFileList, type PickedFile } from "./ingest";

const RESULT_LABELS: Array<[string, string]> = [
  ["created", "Created"],
  ["updated", "Updated"],
  ["copied", "Copied"],
  ["topicsCreated", "Topics created"],
  ["tagsCreated", "Tags created"],
  ["mediaUploaded", "Media uploaded"],
  ["collections", "Collections"],
  ["relationSets", "Documents with relationships"],
  ["published", "Published"],
  ["failed", "Failed steps"],
  ["cancelled", "Cancelled steps"],
];

export function RunPanel({
  job,
  run,
  finished,
  missing,
  onProvideFiles,
  onSkipMissing,
  onCancel,
  onRetry,
  onNew,
}: {
  job: ImportJobView | null;
  run: RunResult | null;
  finished: boolean;
  missing: Array<{ key: string; path: string; size: number }>;
  onProvideFiles: (files: PickedFile[]) => void;
  onSkipMissing: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onNew: () => void;
}) {
  const folder = useRef<HTMLInputElement>(null);
  const progress = run?.progress ?? (job ? { done: job.progress.done, failed: job.progress.failed, pending: job.progress.pending, total: job.progress.total } : null);
  const total = progress?.total ?? 0;
  const handled = progress ? progress.total - progress.pending : 0;
  const pct = total ? Math.round((handled / total) * 100) : 0;
  const status = finished ? job?.status : "running";
  const result = (job?.summary?.result ?? null) as Record<string, number> | null;

  return (
    <div className="max-w-3xl space-y-6 px-6 py-8 lg:px-10">
      <div className="rounded-md border border-line bg-surface p-5" role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          {!finished ? (
            <Loader2 size={20} className="animate-spin text-accent" aria-hidden="true" />
          ) : status === "completed" ? (
            <CheckCircle2 size={20} className="text-success" aria-hidden="true" />
          ) : status === "cancelled" ? (
            <XCircle size={20} className="text-subtle" aria-hidden="true" />
          ) : (
            <CircleAlert size={20} className="text-warning" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {!finished ? "Importing…" : status === "completed" ? "Import complete" : status === "partial" ? "Import finished with problems" : status === "cancelled" ? "Import cancelled" : "Import failed"}
            </p>
            <p className="truncate text-sm text-muted">{!finished ? (run?.current ?? "Starting") : job?.sourceName}</p>
          </div>
          {status && <Badge tone={status === "completed" ? "success" : status === "running" ? "info" : status === "cancelled" ? "neutral" : "warning"}>{status}</Badge>}
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={handled} aria-label="Import progress">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        {progress && (
          <p className="mt-2 text-xs text-muted">
            {handled} of {total} steps · {progress.failed} failed
          </p>
        )}
        {!finished && (
          <p className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-muted">
            <strong className="font-medium text-ink">Keep this tab open.</strong> This import runs from your browser, not in the background. Closing the tab or the browser pauses it. You can continue from Import history, but after a reload you may need to choose the source folder or files again so media can be uploaded.
          </p>
        )}
        {!finished && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel import
            </button>
            <p className="text-xs text-subtle">Cancelling stops before the next step. Documents already imported stay as private drafts.</p>
          </div>
        )}
      </div>

      {!finished && missing.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-5 text-sm">
          <p className="font-medium">{missing.length} media file{missing.length === 1 ? " is" : "s are"} needed to continue</p>
          <p className="mt-1 text-muted">This page was reloaded, so the files you chose are no longer available. Choose the same folder or archive again, or continue without them (a visible placeholder marks each spot and blocks publishing until replaced).</p>
          <ul className="mt-2 max-h-32 overflow-y-auto font-mono text-xs text-muted">
            {missing.slice(0, 50).map((m) => (
              <li key={m.key}>{m.path}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <input ref={folder} type="file" multiple className="sr-only" aria-label="Choose the folder again" onChange={(e) => e.target.files && onProvideFiles(fromFileList(e.target.files))} {...{ webkitdirectory: "", directory: "" }} />
            <button type="button" className="btn btn-accent btn-sm" onClick={() => folder.current?.click()}>
              <FolderOpen size={14} aria-hidden="true" /> Choose folder again
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onSkipMissing}>
              Continue without them
            </button>
          </div>
        </div>
      )}

      {finished && result && (
        <section aria-labelledby="result-heading">
          <h2 id="result-heading" className="text-sm font-medium">Result</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {RESULT_LABELS.filter(([key]) => result[key]).map(([key, label]) => (
              <div key={key} className="rounded-sm border border-line px-3 py-2">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className={key === "failed" ? "text-lg font-semibold text-danger" : "text-lg font-semibold"}>{result[key]}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {finished && (
        <div className="flex flex-wrap gap-2">
          {job && (
            <Link href={`/admin/import/history/${job.id}`} className="btn btn-primary btn-md">
              View report
            </Link>
          )}
          {(job?.status === "partial" || job?.status === "failed") && (
            <button type="button" className="btn btn-ghost btn-md" onClick={onRetry}>
              Retry failed steps
            </button>
          )}
          <Link href="/admin/documents?status=draft" className="btn btn-ghost btn-md">
            Open drafts
          </Link>
          <button type="button" className="btn btn-ghost btn-md" onClick={onNew}>
            Start another import
          </button>
        </div>
      )}
    </div>
  );
}
