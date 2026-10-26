"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { INDEXING_INFO, INDEXINGS, PUBLICATION_INFO, PUBLICATIONS, type Indexing, type Publication } from "@/lib/content/publication";
import type { ImportItem, ImportOptions, InterviewImportPreview, InterviewImportResult } from "@/server/services/interview-import";
import { api, errorMessage } from "../api";
import { Badge, statusTone } from "../fields";
import { ConfirmDialog } from "../modal";
import { OutcomeBadges, PublicationControls } from "../publishing";
import { inputBase } from "../styles";
import { useToast } from "../toast";

const select = `${inputBase} px-2 py-1 text-xs`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const EMPTY_OPTIONS: ImportOptions = { publication: "draft", indexing: "auto", pages: {} };

/**
 * A company's research (research/interviews/<company>/import.json), opened
 * from Studio → Import: every page it proposes, compared with what exists,
 * with its RESULT under the chosen options (Draft · Published · Unlisted,
 * search engines). Changing an option previews again (nothing is written);
 * Import does exactly what the preview shows.
 */
export function InterviewImportWorkbench({ initialPackage, fileName, onReset }: { initialPackage: unknown; fileName: string; onReset: () => void }) {
  const toast = useToast();
  const [options, setOptions] = useState<ImportOptions>(EMPTY_OPTIONS);
  const [preview, setPreview] = useState<InterviewImportPreview | null>(null);
  const [result, setResult] = useState<InterviewImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>("preview");
  const [confirming, setConfirming] = useState(false);
  const request = useRef(0);

  const runPreview = useCallback(
    async (next: ImportOptions) => {
      const id = ++request.current;
      setBusy("preview");
      try {
        const p = await api<InterviewImportPreview>("/api/admin/interviews/preview", { body: { package: initialPackage, options: next } });
        if (id === request.current) setPreview(p);
      } catch (e) {
        if (id === request.current) toast.error(errorMessage(e));
      } finally {
        if (id === request.current) setBusy(null);
      }
    },
    [initialPackage, toast],
  );

  // The first check, when the file is opened. State is only set in the request's callbacks.
  useEffect(() => {
    const id = ++request.current;
    api<InterviewImportPreview>("/api/admin/interviews/preview", { body: { package: initialPackage, options: EMPTY_OPTIONS } })
      .then((p) => {
        if (id === request.current) setPreview(p);
      })
      .catch((e) => {
        if (id === request.current) toast.error(errorMessage(e));
      })
      .finally(() => {
        if (id === request.current) setBusy(null);
      });
  }, [initialPackage, toast]);

  const change = (next: ImportOptions) => {
    setOptions(next);
    void runPreview(next);
  };
  const setPage = (slug: string, patch: ImportOptions["pages"][string]) => {
    const own = { ...options.pages[slug], ...patch };
    for (const k of Object.keys(own) as Array<keyof typeof own>) if (own[k] === undefined) delete own[k];
    const pages = { ...options.pages, [slug]: own };
    if (!Object.keys(own).length) delete pages[slug];
    change({ ...options, pages });
  };

  async function runImport() {
    if (!preview) return;
    setBusy("import");
    try {
      const done = await api<InterviewImportResult>("/api/admin/interviews/import", { body: { package: initialPackage, options, token: preview.token } });
      setResult(done);
      setPreview(null);
      const published = done.imported.filter((i) => i.outcome === "Published" || i.outcome === "Unlisted").length;
      if (done.failed.length) toast.error(`${plural(done.failed.length, "page")} failed. The rest were imported.`);
      else toast.success(`Imported ${plural(done.imported.length, "page")}${published ? `; ${published} published` : ". Nothing was published"}.`);
    } catch (e) {
      toast.error(errorMessage(e));
      void runPreview(options);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-5xl space-y-8 px-6 pb-32 pt-8 lg:px-10">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone="accent">Interview research</Badge>
        <span className="font-mono text-xs text-subtle">{fileName}</span>
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onReset} disabled={busy === "import"}>
          Choose another file
        </button>
      </div>
      {result && <ResultView result={result} />}
      {!result && !preview && (
        <p role="status" className="text-sm text-muted">
          Checking the package…
        </p>
      )}
      {preview && !result && (
        <PreviewView preview={preview} options={options} busy={busy} onChange={change} onPage={setPage} onImport={() => (preview.totals.publish + preview.totals.unlisted > 0 ? setConfirming(true) : void runImport())} />
      )}
      {preview && (
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await runImport();
          }}
          title={`Import and publish ${preview.company} pages?`}
          confirmLabel="Import and publish"
          body={<ImportSummary preview={preview} />}
        />
      )}
    </div>
  );
}

/** One sentence per consequence; the same text in the action bar and the confirmation. */
function ImportSummary({ preview }: { preview: InterviewImportPreview }) {
  const t = preview.totals;
  const going = t.create + t.update;
  const updatesLive = preview.items.filter((i) => i.action === "update" && i.target?.status === "published");
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li>
        {plural(going, "page")}: {t.create} new, {t.update} updated{t.skipped ? `, ${t.skipped} left out` : ""}
        {t.blocked ? `, ${t.blocked} blocked` : ""}.
      </li>
      {t.publish + t.unlisted > 0 && (
        <li className="text-ink">
          {t.publish > 0 && `${t.publish} published (live and listed)`}
          {t.publish > 0 && t.unlisted > 0 && ", "}
          {t.unlisted > 0 && `${t.unlisted} unlisted (live by link)`}; {plural(t.indexed, "page")} indexed by search engines.
        </li>
      )}
      {t.draft > 0 && (
        <li>
          {plural(t.draft, "page")} saved as drafts{updatesLive.some((i) => i.publication === "draft") ? " (live pages keep their current version; the update is staged)" : ""}
          {t.indexWhenLive ? `; ${t.indexWhenLive} will be indexed once you publish ${t.indexWhenLive === 1 ? "it" : "them"}` : ""}.
        </li>
      )}
      {t.review > 0 && <li>{plural(t.review, "question")} held back from the public pages until you review them.</li>}
    </ul>
  );
}

function ResultView({ result }: { result: InterviewImportResult }) {
  return (
    <section aria-labelledby="import-result" className="rounded-md border border-line px-4 py-3 text-sm">
      <h2 id="import-result" className="font-medium">
        {result.failed.length ? "Imported, with failures" : "Imported"}
      </h2>
      <ul className="mt-2 space-y-1.5">
        {result.imported.map((i) => (
          <li key={i.id}>
            <Link href={`/admin/documents/${i.id}`} className="font-medium underline">
              {i.title}
            </Link>{" "}
            <span className="text-muted">
              — {i.created ? "new" : "updated"}, {i.outcome.toLowerCase()}
            </span>
            {i.note && <span className="block text-xs text-warning">{i.note}</span>}
          </li>
        ))}
      </ul>
      {result.failed.map((f) => (
        <p key={f.title} role="alert" className="mt-2 text-danger">
          {f.title}: {f.message}
        </p>
      ))}
      <p className="mt-3 text-muted">
        {result.failed.length ? "Choose the file again to retry: pages already imported are offered as updates. " : ""}
        Questions marked “Needs review” stay off the public pages until you clear them in each page’s editor.
      </p>
    </section>
  );
}

function PreviewView({
  preview,
  options,
  busy,
  onChange,
  onPage,
  onImport,
}: {
  preview: InterviewImportPreview;
  options: ImportOptions;
  busy: "preview" | "import" | null;
  onChange: (next: ImportOptions) => void;
  onPage: (slug: string, patch: ImportOptions["pages"][string]) => void;
  onImport: () => void;
}) {
  const t = preview.totals;
  const going = t.create + t.update;
  return (
    <section aria-labelledby="preview-heading" className="space-y-8">
      <div>
        <h2 id="preview-heading" className="text-lg font-medium">
          {preview.company ? `${preview.company}: ${plural(preview.items.length, "page")}` : "Preview"}
        </h2>
        {preview.company && (
          <p className="mt-1 text-sm text-muted">
            Research run <code>{preview.researchRun}</code> · {plural(t.questions, "question")} · {t.review} held for review · {t.create} new · {t.update} to update
            {t.blocked ? ` · ${t.blocked} blocked` : ""}
          </p>
        )}
        <p className="mt-1 text-xs text-subtle">Preview only: nothing has been written. Changing a choice checks again.</p>
      </div>

      {preview.errors.length > 0 && (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm">
          <p className="font-medium">This package can’t be imported:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {preview.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="publishing-heading" className="rounded-md border border-line bg-surface px-4 py-4">
        <h3 id="publishing-heading" className="sr-only">
          Publishing
        </h3>
        <PublicationControls
          publication={options.publication}
          indexing={options.indexing}
          disabled={busy === "import"}
          onPublication={(v) => onChange({ ...options, publication: v as Publication })}
          onIndexing={(v) => onChange({ ...options, indexing: v })}
          indexingHelp="Follows the research advice: INDEX pages are indexed when they clear the quality bar (3+ accounts, 10+ shown questions); HOLD pages stay out. Existing pages keep their setting."
        />
        <p className="mt-3 text-xs text-subtle">Applies to every page below unless you change that page. Publishing runs the same checks as the editor.</p>
      </section>

      <ul className="space-y-4">
        {preview.items.map((item) => (
          <li key={item.slug}>
            <PageCard item={item} options={options} busy={busy !== null} onPage={(patch) => onPage(item.slug, patch)} />
          </li>
        ))}
      </ul>

      {preview.notIncluded.length > 0 && (
        <div className="text-sm">
          <h3 className="font-medium">Not included (too little evidence)</h3>
          <p className="mt-1 text-muted">These roles stay in the research until more candidate accounts are found. Nothing is created for them.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {preview.notIncluded.map((n) => (
              <li key={n.role}>
                <span className="text-ink">{n.role}</span>: {plural(n.accounts, "account")}, {plural(n.questions, "question")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.warnings.length > 0 && (
        <div className="rounded-md border border-line px-4 py-3 text-sm">
          <p className="font-medium">For your review (nothing here blocks the import)</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 px-6 py-3 backdrop-blur-sm lg:left-60 lg:px-10">
        <div className="flex max-w-5xl flex-wrap items-center gap-3">
          <p className="mr-auto text-xs text-muted" aria-live="polite">
            {busy === "preview"
              ? "Checking…"
              : !preview.ok
                ? preview.errors.length
                  ? "Fix the package errors above to import."
                  : "Nothing selected to import."
                : [
                    `${plural(going, "page")}: ${[t.publish && `${t.publish} published`, t.unlisted && `${t.unlisted} unlisted`, t.draft && plural(t.draft, "draft")].filter(Boolean).join(", ")}`,
                    t.publish + t.unlisted > 0 && `${t.indexed} indexed`,
                    t.indexWhenLive > 0 && `${t.indexWhenLive} to be indexed once published`,
                    t.review > 0 && `${plural(t.review, "question")} held for review`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
          </p>
          <button type="button" className="btn btn-primary btn-md" disabled={busy !== null || !preview.ok} onClick={onImport}>
            {busy === "import" ? "Importing…" : t.publish + t.unlisted > 0 ? `Import and publish ${plural(going, "page")}…` : `Import ${plural(going, "page")} as drafts`}
          </button>
        </div>
      </div>
    </section>
  );
}

const ACTION: Record<ImportItem["action"], { label: string; tone: "info" | "accent" | "danger" | "neutral" }> = {
  create: { label: "New", tone: "info" },
  update: { label: "Update", tone: "accent" },
  blocked: { label: "Blocked", tone: "danger" },
  skipped: { label: "Left out", tone: "neutral" },
};

function PageCard({ item, options, busy, onPage }: { item: ImportItem; options: ImportOptions; busy: boolean; onPage: (patch: ImportOptions["pages"][string]) => void }) {
  const name = item.role ?? "Company page";
  const own = options.pages[item.slug] ?? {};
  const live = item.target?.status === "published";
  const pubLabel = (p: Publication) => (live ? (p === "draft" ? "Stage changes" : `Publish changes${p === "unlisted" ? " (unlisted)" : ""}`) : PUBLICATION_INFO[p].label);
  const path = item.path;
  return (
    <article className={`rounded-md border px-4 py-3 text-sm ${item.action === "blocked" ? "border-danger/40" : "border-line"} ${item.action === "skipped" ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex min-w-0 items-start gap-2">
          <input type="checkbox" className="mt-1" checked={item.include && item.action !== "blocked"} disabled={busy || item.action === "blocked"} onChange={(e) => onPage({ include: e.target.checked ? undefined : false })} aria-describedby={`${item.slug}-result`} />
          <span className="min-w-0">
            <span className="font-medium">{name}</span> <span className="break-all font-mono text-xs text-subtle">{path}</span>
          </span>
        </label>
        <span id={`${item.slug}-result`} className="flex flex-wrap items-center gap-1.5">
          <Badge tone={ACTION[item.action].tone}>{ACTION[item.action].label}</Badge>
          {item.target && <Badge tone={statusTone(item.target.status)}>now {item.target.status}</Badge>}
          {item.result && (
            <>
              <span aria-hidden="true" className="text-subtle">
                →
              </span>
              <span className="sr-only">will be</span>
              <OutcomeBadges outcome={item.result} staged={item.result.staged} />
            </>
          )}
        </span>
      </div>

      <p className="mt-1.5 text-muted">
        {plural(item.accounts, "candidate account")}
        {item.period ? ` (${item.period})` : ""}
        {item.role ? ` · ${plural(item.rounds.length, "round")} · ${plural(item.questions, "question")}` : ` · ${plural(item.official, "official source")}`}
        {item.review > 0 && <span className="text-warning"> · {item.review} held back until reviewed</span>}
      </p>
      {item.byCategory.length > 0 && <p className="mt-1 text-xs text-subtle">{item.byCategory.map((c) => `${c.label} ${c.count}`).join(" · ")}</p>}

      {item.action !== "blocked" && item.action !== "skipped" && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <label className="flex items-center gap-1.5 text-muted">
            {live ? "Live page" : "Becomes"}
            <select className={select} value={own.publication ?? ""} disabled={busy} onChange={(e) => onPage({ publication: (e.target.value || undefined) as Publication | undefined })}>
              <option value="">{pubLabel(options.publication)} (default)</option>
              {PUBLICATIONS.map((p) => (
                <option key={p} value={p}>
                  {pubLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-muted">
            Search engines
            <select className={select} value={own.indexing ?? ""} disabled={busy} onChange={(e) => onPage({ indexing: (e.target.value || undefined) as Indexing | undefined })}>
              <option value="">{INDEXING_INFO[options.indexing].label} (default)</option>
              {INDEXINGS.map((i) => (
                <option key={i} value={i}>
                  {INDEXING_INFO[i].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p className="mt-2 text-xs text-subtle">
        <span className="font-medium text-muted">Research advice {item.advice.indexing}:</span> {item.advice.reason}
        {item.result && <span className="block">{item.indexNote}</span>}
      </p>
      {item.diff && item.role && (
        <p className="mt-1 text-xs text-subtle">
          Compared with the existing page: {item.diff.added} added · {item.diff.removed} removed · {item.diff.kept} kept. Only the guide is replaced; the title, text and SEO text are kept.
        </p>
      )}
      {item.errors.map((e) => (
        <p key={e} role="alert" className="mt-1 text-danger">
          {e}
        </p>
      ))}
      {item.errors.length > 0 && <p className="mt-1 text-xs text-muted">This page is skipped; the other pages can still be imported.</p>}
      {item.role && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted">Rounds{item.reviewItems.length ? ` and ${plural(item.reviewItems.length, "question")} held for review` : ""}</summary>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-subtle">
                <th scope="col" className="py-1 font-normal">Round</th>
                <th scope="col" className="py-1 text-right font-normal">Accounts</th>
                <th scope="col" className="py-1 text-right font-normal">Questions</th>
                <th scope="col" className="py-1 text-right font-normal">Held</th>
              </tr>
            </thead>
            <tbody>
              {item.rounds.map((r) => (
                <tr key={r.name} className="border-b border-line">
                  <td className="py-1">{r.name}</td>
                  <td className="py-1 text-right font-mono">{r.reports}</td>
                  <td className="py-1 text-right font-mono">{r.questions}</td>
                  <td className={`py-1 text-right font-mono ${r.review ? "text-warning" : ""}`}>{r.review}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {item.reviewItems.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-xs">
              {item.reviewItems.map((r) => (
                <li key={`${r.round}-${r.text}`}>
                  <span className="text-subtle">{r.round}:</span> {r.text}
                  {r.note && <span className="block text-muted">Why: {r.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </article>
  );
}
