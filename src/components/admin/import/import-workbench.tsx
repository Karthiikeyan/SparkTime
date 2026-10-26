"use client";

import { FileArchive, FolderOpen, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { IMPORT_LIMITS } from "@/lib/portability/limits";
import type { ImportDecisions } from "@/lib/portability/plan-types";
import type { PlanView } from "@/lib/portability/plan-view";
import type { RunResult } from "@/server/services/import/execute";
import type { ImportJobView } from "@/server/services/import/jobs";
import { cn } from "@/lib/cn";
import { api, ApiError, errorMessage } from "../api";
import { InterviewImportWorkbench } from "../interviews/import-workbench";
import { useToast } from "../toast";
import { blobIndex, findBlob, formatBytes, fromDataTransfer, fromFileList, ingest, stage, type PickedFile } from "./ingest";
import { PlanPreview, type TopicOption, type TypeOption } from "./plan-preview";
import { RunPanel } from "./run-panel";

type Phase = "pick" | "reading" | "preview" | "running" | "done" | "interview";

/** Interview research packages are one JSON file with this format; anything else goes through the folder importer. */
const INTERVIEW_FORMATS = ["interview-import", "interview-research-package"];
const MAX_INTERVIEW_BYTES = 4 * 1024 * 1024;

/** A single picked JSON file that is a company's interview research, parsed; otherwise null. */
async function interviewPackage(picked: PickedFile[]): Promise<{ pkg: unknown; fileName: string } | null> {
  if (picked.length !== 1 || !/\.json$/i.test(picked[0]!.path) || picked[0]!.blob.size > MAX_INTERVIEW_BYTES) return null;
  try {
    const pkg: unknown = JSON.parse(await picked[0]!.blob.text());
    const format = pkg && typeof pkg === "object" ? (pkg as { format?: unknown }).format : null;
    return typeof format === "string" && INTERVIEW_FORMATS.includes(format) ? { pkg, fileName: picked[0]!.path } : null;
  } catch {
    return null;
  }
}
type JobWithPlan = ImportJobView & { plan: PlanView | null };

export function ImportWorkbench({ types, topics, resumeId }: { types: TypeOption[]; topics: TopicOption[]; resumeId: string | null }) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>(resumeId ? "reading" : "pick");
  const [progress, setProgress] = useState<{ message: string; done: number; total: number } | null>(null);
  const [job, setJob] = useState<JobWithPlan | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [decisions, setDecisions] = useState<ImportDecisions>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<Array<{ path: string; reason: string }>>([]);
  const [dragging, setDragging] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const [interview, setInterview] = useState<{ pkg: unknown; fileName: string } | null>(null);
  const blobs = useRef(new Map<string, Blob>());
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const running = useRef(false);

  const applyJob = useCallback((loaded: JobWithPlan) => {
    setJob(loaded);
    setPlan(loaded.plan);
    setDecisions(loaded.decisions ?? {});
  }, []);

  const loadJob = useCallback(
    async (id: string) => {
      const loaded = await api<JobWithPlan>(`/api/admin/import/jobs/${id}`);
      applyJob(loaded);
      return loaded;
    },
    [applyJob],
  );

  const analyze = useCallback(
    async (jobId: string, next: ImportDecisions) => {
      setBusy(true);
      try {
        const result = await api<PlanView>(`/api/admin/import/jobs/${jobId}/analyze`, { method: "POST", body: { decisions: next } });
        setPlan(result);
        setDirty(false);
        setPhase("preview");
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const start = async (picked: PickedFile[]) => {
    if (!picked.length) return;
    const research = await interviewPackage(picked);
    if (research) {
      setInterview(research);
      setPhase("interview");
      return;
    }
    setPhase("reading");
    setRejected([]);
    try {
      const report = (message: string, done: number, total: number) => setProgress({ message, done, total });
      const result = await ingest(picked, report);
      if (!result.files.length) throw new Error("No importable files were found.");
      blobs.current = blobIndex(result.files);
      const { id } = await api<{ id: string }>("/api/admin/import/jobs", { method: "POST", body: { sourceName: result.sourceName, options: { obsidianVault: result.obsidianVault } } });
      const staged = await stage(id, result.files, report);
      setRejected([...result.rejected, ...staged.skipped]);
      setProgress({ message: "Analysing (dry run — nothing is written)", done: 0, total: 0 });
      // Shallow URL update (no navigation): a reload resumes this import, while the
      // files chosen in this tab stay in memory for the media upload step.
      window.history.replaceState(null, "", `/admin/import?job=${id}`);
      const loaded = await loadJob(id);
      await analyze(loaded.id, {});
    } catch (e) {
      toast.error(errorMessage(e));
      setPhase("pick");
    } finally {
      setProgress(null);
    }
  };

  const loop = useCallback(
    async (jobId: string) => {
      if (running.current) return;
      running.current = true;
      try {
        for (;;) {
          const result = await api<RunResult>(`/api/admin/import/jobs/${jobId}/run`, { method: "POST" });
          setRun(result);
          if (result.needsAssets.length) {
            const available = result.needsAssets.filter((a) => findBlob(blobs.current, a.path));
            if (!available.length) break; // RunPanel asks for the files again, or to skip them
            for (const asset of available) {
              const form = new FormData();
              form.append("key", asset.key);
              form.append("file", findBlob(blobs.current, asset.path)!, asset.path.split("/").pop());
              await api(`/api/admin/import/jobs/${jobId}/assets`, { method: "POST", body: form });
            }
            continue;
          }
          if (result.status !== "running") {
            await loadJob(jobId);
            setPhase("done");
            break;
          }
        }
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) toast.error(errorMessage(e));
      } finally {
        running.current = false;
      }
    },
    [loadJob, toast],
  );

  // Resume an import from history (?job=...). State is only set in the request's callbacks.
  useEffect(() => {
    if (!resumeId) return;
    let live = true;
    api<JobWithPlan>(`/api/admin/import/jobs/${resumeId}`)
      .then((loaded) => {
        if (!live) return;
        applyJob(loaded);
        setPhase(loaded.status === "analyzed" && loaded.plan ? "preview" : loaded.status === "running" ? "running" : loaded.status === "staging" ? "pick" : "done");
        if (loaded.status === "running") void loop(loaded.id);
      })
      .catch((e) => {
        if (!live) return;
        toast.error(errorMessage(e));
        setPhase("pick");
      });
    return () => {
      live = false;
    };
  }, [resumeId, applyJob, loop, toast]);

  const approve = async () => {
    if (!job || !plan) return;
    setBusy(true);
    try {
      await api(`/api/admin/import/jobs/${job.id}/approve`, { method: "POST", body: { hash: plan.hash } });
      await loadJob(job.id);
      setPhase("running");
      void loop(job.id);
    } catch (e) {
      if (e instanceof ApiError && e.details?.stale) {
        const loaded = await loadJob(job.id);
        setPlan(loaded.plan);
        toast.error("The site changed since this preview. The preview was refreshed — review it and approve again.");
      } else toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setJob(null);
    setPlan(null);
    setDecisions({});
    setRun(null);
    setInterview(null);
    setPhase("pick");
    window.history.replaceState(null, "", "/admin/import");
  };

  if (phase === "interview" && interview) {
    return <InterviewImportWorkbench key={interview.fileName} initialPackage={interview.pkg} fileName={interview.fileName} onReset={reset} />;
  }

  if (phase === "pick") {
    return (
      <div className="max-w-4xl space-y-6 px-6 py-8 lg:px-10">
        <div
          className={cn("rounded-lg border-2 border-dashed p-8 text-center transition-colors", dragging ? "border-accent bg-accent-soft/40" : "border-line-strong")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragging(false);
            void start(await fromDataTransfer(e.dataTransfer));
          }}
        >
          <Upload size={28} className="mx-auto text-subtle" aria-hidden="true" />
          <p className="mt-3 font-medium">Drop a folder, files or a ZIP archive here</p>
          <p className="mt-1 text-sm text-muted">Nothing is written until you have reviewed a full preview and approved it.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <input ref={folderInput} type="file" className="sr-only" aria-label="Choose a folder" onChange={(e) => e.target.files && void start(fromFileList(e.target.files))} {...{ webkitdirectory: "", directory: "" }} />
            <input ref={filesInput} type="file" multiple className="sr-only" aria-label="Choose files or a ZIP" accept=".md,.markdown,.mdx,.txt,.html,.htm,.json,.zip,.csv,image/*,application/pdf,audio/mpeg,audio/mp4" onChange={(e) => e.target.files && void start(fromFileList(e.target.files))} />
            <button type="button" className="btn btn-accent btn-md" onClick={() => folderInput.current?.click()}>
              <FolderOpen size={15} aria-hidden="true" /> Choose folder
            </button>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => filesInput.current?.click()}>
              <FileArchive size={15} aria-hidden="true" /> Choose files or ZIP
            </button>
          </div>
        </div>
        <section aria-labelledby="formats" className="grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <h2 id="formats" className="font-medium">What can be imported</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>Markdown (.md) and MDX (.mdx, never executed) with YAML front matter</li>
              <li>HTML, plain text, and folders of them</li>
              <li>ZIP archives, including Notion exports (Markdown or HTML)</li>
              <li>Obsidian vaults: wikilinks, embeds, attachments, aliases</li>
              <li>Packages exported from this studio (manifest.json), and older JSON backups</li>
              <li>Interview research: a company&apos;s <code className="font-mono text-xs">import.json</code> (research/interviews/&lt;company&gt;/) opens its own preview</li>
              <li>Images (JPEG, PNG, GIF, WebP, AVIF), PDFs and MP3/M4A referenced by the content</li>
            </ul>
          </div>
          <div>
            <h2 className="font-medium">How it works</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>Top-level folders suggest topics; numbered files suggest courses. README files describe their folder.</li>
              <li>Everything is imported as <strong>drafts</strong> unless you choose Published or Unlisted in the preview. A file&apos;s own status never publishes anything by itself.</li>
              <li>Existing documents are never overwritten: for each duplicate you choose skip, update (field by field) or copy.</li>
              <li>
                Limits: {IMPORT_LIMITS.maxFiles} files, {IMPORT_LIMITS.maxDocuments} documents, {formatBytes(IMPORT_LIMITS.maxTextFileBytes)} per text file, ZIPs up to {formatBytes(IMPORT_LIMITS.maxArchiveBytes)}; each media file must fit the upload limit.
              </li>
            </ul>
          </div>
        </section>
        <p className="text-sm text-muted">
          <Link href="/admin/import/history" className="underline underline-offset-2 hover:text-ink">Import history</Link> lists earlier imports, their results and anything that can be retried.
        </p>
      </div>
    );
  }

  if (phase === "reading" || (phase === "preview" && !plan)) {
    return (
      <div className="flex max-w-4xl items-center gap-3 px-6 py-16 lg:px-10" role="status" aria-live="polite">
        <Loader2 size={18} className="animate-spin text-accent" aria-hidden="true" />
        <div>
          <p className="font-medium">{progress?.message ?? "Loading…"}</p>
          {progress && progress.total > 0 && (
            <p className="text-sm text-muted">
              {progress.done} of {progress.total}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (phase === "preview" && plan && job) {
    return (
      <PlanPreview
        plan={plan}
        jobId={job.id}
        sourceName={job.sourceName}
        decisions={decisions}
        types={types}
        topics={topics}
        dirty={dirty}
        busy={busy}
        rejected={rejected}
        onDecisions={(next) => {
          setDecisions(next);
          setDirty(true);
        }}
        onApply={() => analyze(job.id, decisions)}
        onApprove={approve}
        onDiscard={async () => {
          try {
            await api(`/api/admin/import/jobs/${job.id}`, { method: "DELETE" });
          } catch (e) {
            toast.error(errorMessage(e));
          }
          reset();
        }}
      />
    );
  }

  return (
    <RunPanel
      job={job}
      run={run}
      finished={phase === "done"}
      missing={(run?.needsAssets ?? []).filter((a) => !findBlob(blobs.current, a.path))}
      onProvideFiles={async (picked) => {
        const result = await ingest(picked, () => undefined);
        blobIndex(result.files, blobs.current);
        if (job) void loop(job.id);
      }}
      onSkipMissing={async () => {
        if (!job) return;
        await api(`/api/admin/import/jobs/${job.id}/control`, { method: "POST", body: { action: "skipAssets" } });
        void loop(job.id);
      }}
      onCancel={async () => {
        if (!job) return;
        try {
          const r = await api<{ status: string }>(`/api/admin/import/jobs/${job.id}/control`, { method: "POST", body: { action: "cancel" } });
          if (r.status === "cancelled") {
            await loadJob(job.id);
            setPhase("done");
          }
        } catch (e) {
          toast.error(errorMessage(e));
        }
      }}
      onRetry={async () => {
        if (!job) return;
        try {
          await api(`/api/admin/import/jobs/${job.id}/control`, { method: "POST", body: { action: "retry" } });
          await loadJob(job.id);
          setPhase("running");
          void loop(job.id);
        } catch (e) {
          toast.error(errorMessage(e));
        }
      }}
      onNew={reset}
    />
  );
}
