"use client";

import { Download, Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { assemblePackage, ExportValidationError, type ExportFormat, type ManifestResponse } from "@/lib/portability/assemble";
import { EXPORT_LIMITS } from "@/lib/portability/limits";
import { browserDeflateRaw, supportsCompressionStreams } from "@/lib/portability/zip-browser";
import type { ExportSummary } from "@/server/services/portable-export";
import { api, errorMessage } from "../api";
import { Badge } from "../badge";
import { inputBase } from "../styles";
import { useToast } from "../toast";
import { formatBytes } from "../import/ingest";

export type Option = { id: string; name: string; count?: number };
type ScopeKind = "all" | "documents" | "types" | "topics" | "tags" | "collections";
type DocHit = { id: string; title: string; typeName: string; path: string };

const FORMATS: Array<{ value: ExportFormat; label: string; help: string }> = [
  { value: "portable", label: "Portable package (ZIP)", help: "Manifest, Markdown, exact editor documents and media. Re-imports here or into a future version of this site with identity, topics, relations and order." },
  { value: "markdown", label: "Readable Markdown (ZIP)", help: "Folders by topic, courses as numbered files, YAML front matter, media with relative paths. Works in Obsidian, GitHub or any static-site generator." },
  { value: "manifest", label: "Manifest only", help: "Metadata and identifiers without bodies or media — an inventory of the content." },
  { value: "media", label: "Media only", help: "The media used by the selection (or the whole library for “Entire site”), with a checksum manifest." },
];

const STAGE_LABEL: Record<string, string> = { manifest: "Preparing manifest", content: "Collecting documents", media: "Downloading media", packaging: "Building the ZIP", validating: "Checking the package" };

export function ExportWorkbench({ types, topics, tags, collections }: { types: Option[]; topics: Option[]; tags: Option[]; collections: Option[] }) {
  const toast = useToast();
  const [kind, setKind] = useState<ScopeKind>("all");
  const [ids, setIds] = useState<string[]>([]);
  const [docs, setDocs] = useState<DocHit[]>([]);
  const [format, setFormat] = useState<ExportFormat>("portable");
  const [includePrivate, setIncludePrivate] = useState(true);
  // Keyed by the request they answer, so a changed selection never shows a stale count.
  const [fetched, setFetched] = useState<{ key: string; summary: ExportSummary | null; error: string | null } | null>(null);
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [report, setReport] = useState<{ name: string; size: number; files: number; warnings: string[]; missing: string[] } | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Ids handed over from a Documents selection (sessionStorage, never the URL: a selection can be thousands of ids).
  const [handoff, setHandoff] = useState<number | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("from") !== "selection") return;
    try {
      const raw = sessionStorage.getItem("studio:export-selection");
      sessionStorage.removeItem("studio:export-selection");
      const parsed = raw ? (JSON.parse(raw) as { ids?: unknown }) : null;
      const handed = Array.isArray(parsed?.ids) ? parsed.ids.filter((id): id is string => typeof id === "string").slice(0, 5000) : [];
      if (!handed.length) return;
      // Adopting state handed over from another page on mount is a one-off sync with an external store.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setKind("documents");
      setIds(handed);
      setHandoff(handed.length);
    } catch {
      // Storage blocked or malformed: fall back to choosing documents here.
    }
  }, []);

  const scope = kind === "all" ? { kind } : { kind, ids };
  const ready = kind === "all" || ids.length > 0;
  const request = { scope, format, includePrivate };
  const requestKey = JSON.stringify(request);
  const summary = ready && fetched?.key === requestKey ? fetched.summary : null;
  const summaryError = ready && fetched?.key === requestKey ? fetched.error : null;

  useEffect(() => {
    if (!ready) return;
    let live = true;
    const timer = setTimeout(() => {
      api<ExportSummary>("/api/admin/export/portable/summary", { method: "POST", body: JSON.parse(requestKey) })
        .then((result) => live && setFetched({ key: requestKey, summary: result, error: null }))
        .catch((e) => live && setFetched({ key: requestKey, summary: null, error: errorMessage(e) }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [requestKey, ready]);

  const run = async () => {
    if (!supportsCompressionStreams()) {
      toast.error("This browser can't build ZIP files. Use a current version of Chrome, Edge, Firefox or Safari.");
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setReport(null);
    try {
      const result = await assemblePackage({
        format,
        signal: controller.signal,
        deflate: browserDeflateRaw,
        onProgress: (stage, done, total) => setProgress({ stage, done, total }),
        fetchManifest: () => api<ManifestResponse>("/api/admin/export/portable/manifest", { method: "POST", body: request, signal: controller.signal }),
        fetchPage: (page) => api<{ files: Array<{ path: string; text: string }> }>("/api/admin/export/portable/files", { method: "POST", body: { ...request, page }, signal: controller.signal }),
        fetchAsset: async (id) => {
          const res = await fetch(`/api/admin/export/assets/${id}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
          if (!res.ok) throw new Error(`Media ${id} failed (${res.status})`);
          return new Uint8Array(await res.arrayBuffer());
        },
      });
      const stamp = new Date().toISOString().slice(0, 10);
      const name = `studio-${format}-${stamp}.zip`;
      const url = URL.createObjectURL(new Blob(result.chunks as BlobPart[], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setReport({ name, size: result.size, files: result.files, warnings: result.warnings, missing: result.missingAssets });
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") toast.error("Export cancelled.");
      else toast.error(e instanceof ExportValidationError ? e.message : errorMessage(e));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const tooLarge = Boolean(summary) && format !== "manifest" && (summary?.assetBytes ?? 0) > EXPORT_LIMITS.maxPackageMediaBytes;
  const options = kind === "types" ? types : kind === "topics" ? topics : kind === "tags" ? tags : kind === "collections" ? collections : [];

  return (
    <div className="grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[1fr_20rem] lg:px-10">
      <div className="space-y-8">
        <fieldset className="space-y-3">
          <legend className="font-medium">1. What to export</legend>
          <div role="radiogroup" aria-label="Scope" className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "Entire site"],
                ["documents", "Selected documents"],
                ["types", "Formats"],
                ["topics", "Topics (with sub-topics)"],
                ["tags", "Tags"],
                ["collections", "Collections & courses"],
              ] as Array<[ScopeKind, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                onClick={() => {
                  setKind(value);
                  setIds([]);
                  setDocs([]);
                  setHandoff(null);
                }}
                className={cn("rounded-sm border px-3 py-1.5 text-sm", kind === value ? "border-accent bg-accent-soft font-medium text-ink" : "border-line text-muted hover:text-ink")}
              >
                {label}
              </button>
            ))}
          </div>
          {kind === "documents" && handoff !== null && (
            <p className="flex flex-wrap items-center gap-2 rounded-md border border-accent bg-accent-soft/40 px-3 py-2 text-sm">
              {handoff.toLocaleString("en-IN")} document{handoff === 1 ? "" : "s"} from your Documents selection.
              <button type="button" className="font-medium underline" onClick={() => (setHandoff(null), setIds([]))}>
                Choose documents here instead
              </button>
            </p>
          )}
          {kind === "documents" && handoff === null && <DocumentPicker selected={docs} onChange={(next) => (setDocs(next), setIds(next.map((d) => d.id)))} />}
          {options.length > 0 && (
            <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-md border border-line p-2 text-sm sm:grid-cols-2">
              {options.map((o) => (
                <li key={o.id}>
                  <label className="flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-surface-2">
                    <input type="checkbox" checked={ids.includes(o.id)} onChange={(e) => setIds(e.target.checked ? [...ids, o.id] : ids.filter((x) => x !== o.id))} />
                    <span className="truncate">{o.name}</span>
                    {o.count !== undefined && <span className="ml-auto text-xs text-subtle">{o.count}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {kind !== "all" && kind !== "documents" && !options.length && <p className="text-sm text-muted">Nothing to choose from yet.</p>}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-medium">2. Format</legend>
          {FORMATS.map((f) => (
            <label key={f.value} className={cn("flex gap-3 rounded-md border p-3 text-sm", format === f.value ? "border-accent" : "border-line")}>
              <input type="radio" name="format" checked={format === f.value} onChange={() => setFormat(f.value)} className="mt-0.5" />
              <span>
                <span className="font-medium">{f.label}</span>
                <span className="block text-muted">{f.help}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-medium">3. Private content</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={includePrivate} onChange={(e) => setIncludePrivate(e.target.checked)} className="mt-0.5" />
            <span>
              Include drafts, ideas, private and unlisted documents
              <span className="block text-xs text-muted">Needed for a complete backup or migration. Keep the file private: it contains unpublished work and editor notes.</span>
            </span>
          </label>
        </fieldset>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start" aria-live="polite">
        <div className="rounded-md border border-line bg-surface p-4 text-sm">
          <h2 className="font-medium">This export</h2>
          {!ready && <p className="mt-2 text-muted">Choose what to include.</p>}
          {summaryError && <p className="mt-2 text-danger">{summaryError}</p>}
          {ready && !summary && !summaryError && (
            <p className="mt-2 flex items-center gap-2 text-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Counting…
            </p>
          )}
          {summary && (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
              <dt className="text-muted">Documents</dt>
              <dd className="text-right">{summary.documents}</dd>
              <dt className="text-muted">Private or unpublished</dt>
              <dd className={cn("text-right", summary.privateOrDraft > 0 && "text-warning")}>{summary.privateOrDraft}</dd>
              <dt className="text-muted">Topics · tags</dt>
              <dd className="text-right">
                {summary.topics} · {summary.tags}
              </dd>
              <dt className="text-muted">Collections · relations</dt>
              <dd className="text-right">
                {summary.collections} · {summary.relations}
              </dd>
              <dt className="text-muted">Media</dt>
              <dd className="text-right">
                {summary.assets} ({formatBytes(summary.assetBytes)})
              </dd>
              <dt className="text-muted">Links outside the export</dt>
              <dd className="text-right">{summary.excludedReferences}</dd>
            </dl>
          )}
          {summary && Object.keys(summary.byType).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {Object.entries(summary.byType).map(([type, n]) => (
                <Badge key={type}>
                  {type} {n}
                </Badge>
              ))}
            </div>
          )}
          {tooLarge && (
            <p className="mt-2 text-xs text-danger">
              The media in this selection is {formatBytes(summary?.assetBytes ?? 0)}, more than a browser can package ({formatBytes(EXPORT_LIMITS.maxPackageMediaBytes)}). Export by topic, tag or collection, or choose a manifest-only export.
            </p>
          )}
          {summary?.warnings.map((w) => (
            <p key={w} className="mt-2 text-xs text-warning">
              {w}
            </p>
          ))}
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn btn-primary btn-md flex-1" disabled={!summary || Boolean(progress) || tooLarge || (summary.documents === 0 && format !== "media")} onClick={() => void run()}>
              {progress ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} Export
            </button>
            {progress && (
              <button type="button" className="btn btn-ghost btn-md" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
          {progress && (
            <p className="mt-2 text-xs text-muted" role="status">
              {STAGE_LABEL[progress.stage] ?? progress.stage}
              {progress.total > 1 ? ` · ${progress.done} of ${progress.total}` : ""}
            </p>
          )}
        </div>
        {report && (
          <div className="rounded-md border border-success/40 bg-success/5 p-4 text-sm">
            <p className="font-medium">Downloaded {report.name}</p>
            <p className="text-muted">
              {report.files} files · {formatBytes(report.size)} · checked before download
            </p>
            {report.missing.length > 0 && <p className="mt-2 text-warning">{report.missing.length} media file(s) couldn&apos;t be included; see the warnings inside the package.</p>}
            {report.warnings.map((w) => (
              <p key={w} className="mt-1 text-xs text-muted">
                {w}
              </p>
            ))}
          </div>
        )}
        <p className="text-xs text-subtle">The package is built in this browser from small requests; nothing is stored on the server and no export link exists for anyone else.</p>
      </aside>
    </div>
  );
}

function DocumentPicker({ selected, onChange }: { selected: DocHit[]; onChange: (next: DocHit[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DocHit[]>([]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api<{ items: DocHit[] }>(`/api/admin/documents/lookup?q=${encodeURIComponent(q)}&limit=20`)
        .then((r) => live && setHits(r.items))
        .catch(() => live && setHits([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents to add" aria-label="Search documents" className={`${inputBase} w-full py-2 pl-8 pr-3 text-sm`} />
      </div>
      <ul className="max-h-56 divide-y divide-line/70 overflow-y-auto rounded-md border border-line text-sm">
        {hits
          .filter((h) => !selected.some((s) => s.id === h.id))
          .map((h) => (
            <li key={h.id}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2" onClick={() => onChange([...selected, h])}>
                <span className="truncate">{h.title || "Untitled"}</span>
                <span className="ml-auto shrink-0 text-xs text-subtle">{h.typeName}</span>
              </button>
            </li>
          ))}
        {!hits.length && <li className="px-3 py-2 text-muted">No matches.</li>}
      </ul>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected documents">
          {selected.map((d) => (
            <li key={d.id} className="flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-xs">
              {d.title || "Untitled"}
              <button type="button" aria-label={`Remove ${d.title}`} onClick={() => onChange(selected.filter((s) => s.id !== d.id))} className="text-subtle hover:text-ink">
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
