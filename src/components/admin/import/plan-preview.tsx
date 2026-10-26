"use client";

import { AlertTriangle, ChevronRight, Info, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { STATUS_LABELS, VISIBILITY_LABELS, isDocumentStatus, type DocumentStatus, type Visibility } from "@/lib/content/model";
import { publicationOutcome, type Indexing, type Publication } from "@/lib/content/publication";
import type { Issue } from "@/lib/portability/model";
import type { ConflictAction, DocumentDecision, FolderRole, ImportDecisions, TopicDecision } from "@/lib/portability/plan-types";
import type { DocumentRow, PlanView } from "@/lib/portability/plan-view";
import { Badge, type BadgeTone } from "../badge";
import { inputBase } from "../styles";
import { ConfirmDialog } from "../modal";
import { OutcomeBadges, PublicationControls } from "../publishing";
import { DocumentDetail } from "./document-detail";
import { formatBytes } from "./ingest";

export type TypeOption = { id: string; slug: string; name: string; template: string; indexable: boolean };

/** The import-wide publication choice, read from and written to the planner's status policy. */
type PolicyChoice = Publication | "source";
function policyChoice(policy: ImportDecisions["status"]): PolicyChoice {
  if (!policy || policy.mode === "draft") return "draft";
  if (policy.mode === "source") return "source";
  return policy.status === "published" ? (policy.visibility === "unlisted" ? "unlisted" : "published") : "draft";
}
function policyFor(choice: PolicyChoice): NonNullable<ImportDecisions["status"]> {
  if (choice === "source") return { mode: "source" };
  if (choice === "draft") return { mode: "draft" };
  return { mode: "set", status: "published", visibility: choice === "unlisted" ? "unlisted" : "public" };
}

/** The per-document choices: the three outcomes, keyed as the planner's status:visibility pairs. */
const ROW_CHOICES: Array<{ value: string; label: string }> = [
  { value: "draft:public", label: "Draft" },
  { value: "published:public", label: "Published" },
  { value: "published:unlisted", label: "Unlisted" },
];
export type TopicOption = { id: string; name: string; slug: string };

const select = `${inputBase} px-2 py-1 text-xs`;

const ACTION_TONE: Record<DocumentRow["action"], BadgeTone> = { create: "success", update: "info", copy: "accent", skip: "neutral", excluded: "neutral", blocked: "danger" };
const ACTION_LABEL: Record<DocumentRow["action"], string> = { create: "New", update: "Update", copy: "Copy", skip: "Skip", excluded: "Excluded", blocked: "Blocked" };
const SYSTEM_LABEL: Record<string, string> = { folder: "Folder of files", notion: "Notion export", obsidian: "Obsidian vault", "studio-portable": "Studio package", "studio-bundle": "Studio JSON backup" };

type Filter = "all" | "new" | "conflicts" | "issues" | "skipped";

export function PlanPreview({
  plan,
  jobId,
  sourceName,
  decisions,
  types,
  topics,
  dirty,
  busy,
  rejected,
  onDecisions,
  onApply,
  onApprove,
  onDiscard,
}: {
  plan: PlanView;
  jobId: string;
  sourceName: string;
  decisions: ImportDecisions;
  types: TypeOption[];
  topics: TopicOption[];
  dirty: boolean;
  busy: boolean;
  rejected: Array<{ path: string; reason: string }>;
  onDecisions: (next: ImportDecisions) => void;
  onApply: () => void;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [detail, setDetail] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const s = plan.summary;

  const setDoc = (key: string, patch: Partial<DocumentDecision>) => onDecisions({ ...decisions, documents: { ...decisions.documents, [key]: { ...decisions.documents?.[key], ...patch } } });
  const setFolder = (path: string, patch: Record<string, unknown>) => onDecisions({ ...decisions, folders: { ...decisions.folders, [path]: { ...decisions.folders?.[path], ...patch } } });
  const setTopic = (key: string, value: TopicDecision | undefined) => {
    const next = { ...decisions.topics };
    if (value) next[key] = value;
    else delete next[key];
    onDecisions({ ...decisions, topics: next });
  };

  const topicLabel = (key: string) => plan.topics.find((t) => t.key === key)?.label ?? key;
  const collectionOf = (key: string | null) => (key ? plan.collections.find((c) => c.key === key) : undefined);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plan.documents.filter((d) => {
      if (q && !`${d.title} ${d.sourcePath} ${d.slug}`.toLowerCase().includes(q)) return false;
      if (filter === "new") return d.action === "create";
      if (filter === "conflicts") return d.conflict !== null;
      if (filter === "issues") return d.errors + d.warnings > 0;
      if (filter === "skipped") return d.action === "skip" || d.action === "excluded" || d.action === "blocked";
      return true;
    });
  }, [plan.documents, query, filter]);

  const allIssues: Issue[] = plan.issues;
  const approvable = !dirty && plan.decisionsRequired.length === 0 && s.create + s.update + s.copy + plan.collections.filter((c) => c.action === "merge").length > 0;
  const choice = policyChoice(decisions.status);
  const indexableBySlug = new Map(types.map((t) => [t.slug, t.indexable]));
  const outcomeOf = (d: DocumentRow) => publicationOutcome({ status: d.status, visibility: d.visibility, robotsIndex: d.robotsIndex ?? "default", typeIndexable: indexableBySlug.get(d.typeSlug ?? "") ?? true });
  const going = plan.documents.filter((d) => d.action === "create" || d.action === "update" || d.action === "copy");
  const outcomes = going.map(outcomeOf);
  const tally = {
    published: outcomes.filter((o) => o.label === "Published").length,
    unlisted: outcomes.filter((o) => o.label === "Unlisted").length,
    notLive: outcomes.filter((o) => !o.live).length,
    indexed: outcomes.filter((o) => o.indexed).length,
  };

  return (
    <div className="space-y-8 px-6 pb-32 pt-6 lg:px-10">
      {/* Summary */}
      <section aria-labelledby="summary-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="summary-heading" className="text-lg font-semibold">
            Preview <span className="font-normal text-muted">· {sourceName}</span>
          </h2>
          <p className="text-xs text-subtle">Dry run — nothing has been written. Plan {plan.hash.slice(0, 8)}</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="New documents" value={s.create} />
          <Stat label="Updates · copies" value={`${s.update} · ${s.copy}`} />
          <Stat label="Skipped · excluded · blocked" value={`${s.skip} · ${s.excluded} · ${s.blocked}`} tone={s.blocked ? "danger" : undefined} />
          <Stat label="Topics reused · new" value={`${s.topicsReuse} · ${s.topicsCreate}`} />
          <Stat label="Tags reused · new" value={`${s.tagsReuse} · ${s.tagsCreate}`} />
          <Stat label="Collections new · merged" value={`${s.collectionsCreate} · ${s.collectionsModify}`} />
          <Stat label="Relationships explicit · from links" value={`${s.relations} · ${s.inferredRelations}`} />
          <Stat label="Media to upload" value={`${s.mediaUpload} (${formatBytes(s.mediaBytes)})`} />
          <Stat label="Media reused · missing" value={`${s.mediaReuse} · ${s.mediaMissing}`} tone={s.mediaMissing ? "warning" : undefined} />
          <Stat label="Unresolved links" value={s.unresolvedRefs} tone={s.unresolvedRefs ? "warning" : undefined} />
          <Stat label="Slug collisions" value={s.slugCollisions} tone={s.slugCollisions ? "warning" : undefined} />
          <Stat label="Errors · warnings" value={`${s.errors} · ${s.warnings}`} tone={s.errors ? "danger" : s.warnings ? "warning" : undefined} />
        </dl>
        <div className="rounded-md border border-line bg-surface px-4 py-3 text-sm">
          <p>
            <span className="font-medium">{SYSTEM_LABEL[plan.source.system] ?? plan.source.system}</span>
            {plan.source.schemaVersion ? ` · format v${plan.source.schemaVersion}` : ""} · {plan.source.fileCount} files
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            {plan.source.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      </section>

      {plan.decisionsRequired.length > 0 && (
        <section aria-labelledby="decisions-heading" className="rounded-md border border-warning/40 bg-warning/5 p-4">
          <h2 id="decisions-heading" className="flex items-center gap-2 font-medium">
            <AlertTriangle size={16} className="text-warning" aria-hidden="true" /> {plan.decisionsRequired.length} decision{plan.decisionsRequired.length === 1 ? "" : "s"} needed before importing
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {plan.decisionsRequired.slice(0, 30).map((d) => (
              <li key={`${d.kind}:${d.key}`} className="flex items-start gap-2">
                <Badge tone="warning">{d.kind}</Badge>
                <span className="text-muted">{d.message}</span>
                {d.kind !== "topic" && (
                  <button type="button" className="ml-auto shrink-0 text-xs underline underline-offset-2" onClick={() => setDetail(d.key)}>
                    Review
                  </button>
                )}
              </li>
            ))}
          </ul>
          {plan.decisionsRequired.some((d) => d.kind === "duplicate") && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">For every duplicate without its own choice:</span>
              {(["skip", "update", "copy"] as ConflictAction[]).map((a) => (
                <button key={a} type="button" className={cn("btn btn-sm", decisions.duplicateAction === a ? "btn-primary" : "btn-ghost")} onClick={() => onDecisions({ ...decisions, duplicateAction: a })}>
                  {a === "skip" ? "Skip all" : a === "update" ? "Update all (choose fields per document)" : "Copy all"}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Options */}
      <section aria-labelledby="options-heading" className="space-y-3">
        <h2 id="options-heading" className="font-medium">Import options</h2>
        <div className="rounded-md border border-line bg-surface px-4 py-4">
          <PublicationControls<"source">
            publication={choice}
            indexing={decisions.indexing ?? "auto"}
            onPublication={(v) => onDecisions({ ...decisions, status: policyFor(v) })}
            onIndexing={(v: Indexing) => onDecisions({ ...decisions, indexing: v === "auto" ? undefined : v })}
            extraPublication={[{ value: "source", label: "Follow each file", help: "Each file's own status decides (for restoring a site): files marked published are published, the rest are drafts. Check the counts before importing." }]}
          />
          <p className="mt-3 text-xs text-subtle">For new documents (and updates where you tick Status or Visibility). Change one document in the table. Publishing runs the editor&apos;s checks; a document that fails them stays a draft and is reported.</p>
        </div>
        <div className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="text-xs text-muted">Default format</span>
            <select className={`${select} mt-1 w-full`} value={decisions.defaultType ?? ""} onChange={(e) => onDecisions({ ...decisions, defaultType: e.target.value || undefined })}>
              <option value="">Article (default)</option>
              {types.filter((t) => t.template !== "collection").map((t) => (
                <option key={t.id} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {plan.source.rootFolder && (
            <label className="flex items-start gap-2 pt-5">
              <input type="checkbox" checked={decisions.keepRootFolder === true} onChange={(e) => onDecisions({ ...decisions, keepRootFolder: e.target.checked })} className="mt-0.5" />
              <span>
                Keep the top folder <code className="font-mono text-xs">{plan.source.rootFolder}/</code> as a topic
              </span>
            </label>
          )}
          <label className="flex items-start gap-2 pt-5">
            <input type="checkbox" checked={decisions.importReadmes === true} onChange={(e) => onDecisions({ ...decisions, importReadmes: e.target.checked })} className="mt-0.5" />
            <span>Also import README files as documents</span>
          </label>
        </div>
      </section>

      {/* Folders */}
      {plan.folders.length > 0 && (
        <section aria-labelledby="folders-heading" className="space-y-2">
          <h2 id="folders-heading" className="font-medium">Folders</h2>
          <p className="text-sm text-muted">How each folder is understood. Topics are created only where no existing topic matches.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-subtle">
                  <th scope="col" className="py-2 font-medium">Folder</th>
                  <th scope="col" className="py-2 font-medium">Files</th>
                  <th scope="col" className="py-2 font-medium">Becomes</th>
                  <th scope="col" className="py-2 font-medium">Format of its documents</th>
                </tr>
              </thead>
              <tbody>
                {plan.folders.map((f) => (
                  <tr key={f.path} className="border-b border-line/70">
                    <td className="py-1.5 pr-3 font-mono text-xs">{f.path}/</td>
                    <td className="py-1.5 pr-3 text-xs text-muted">{f.documentCount}</td>
                    <td className="py-1.5 pr-3">
                      <select aria-label={`Role of ${f.path}`} className={select} value={decisions.folders?.[f.path]?.role ?? f.role} onChange={(e) => setFolder(f.path, { role: e.target.value as FolderRole })}>
                        <option value="topic">Topic{f.topicKey ? ` (${plan.topics.find((t) => t.key === f.topicKey)?.action === "reuse" ? "existing" : "new"})` : ""}</option>
                        <option value="collection">Ordered collection / course</option>
                        <option value="tag">Tag</option>
                        <option value="none">Nothing (organisation only)</option>
                      </select>
                      <span className="ml-2 text-xs text-subtle">{f.roleFrom === "decision" ? "your choice" : f.roleFrom === "readme" ? "from README" : "inferred"}</span>
                    </td>
                    <td className="py-1.5">
                      <select aria-label={`Format for documents in ${f.path}`} className={select} value={decisions.folders?.[f.path]?.type ?? ""} onChange={(e) => setFolder(f.path, { type: e.target.value || undefined })}>
                        <option value="">Inferred</option>
                        {types.filter((t) => t.template !== "collection").map((t) => (
                          <option key={t.id} value={t.slug}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Topics and tags */}
      {(plan.topics.length > 0 || plan.tags.length > 0) && (
        <section aria-labelledby="taxonomy-heading" className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <h2 id="taxonomy-heading" className="font-medium">Topics</h2>
            <ul className="divide-y divide-line/70 rounded-md border border-line text-sm">
              {plan.topics.map((t) => (
                <li key={t.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-medium">{t.label}</span>
                  <Badge tone={t.action === "reuse" ? "neutral" : t.action === "create" ? "success" : t.action === "skip" ? "neutral" : "warning"}>{t.action === "reuse" ? "existing" : t.action === "create" ? "new" : t.action}</Badge>
                  {t.create && t.action === "create" && <span className="font-mono text-xs text-subtle">/{t.create.slug}{t.create.parentKey ? ` under ${topicLabel(t.create.parentKey)}` : ""}</span>}
                  <span className="text-xs text-subtle">{t.documentCount} doc{t.documentCount === 1 ? "" : "s"}</span>
                  <select
                    aria-label={`Topic for ${t.label}`}
                    className={`${select} ml-auto`}
                    value={(() => {
                      const d = decisions.topics?.[t.key];
                      return d ? (d.mode === "existing" ? `existing:${d.id}` : d.mode) : "";
                    })()}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) setTopic(t.key, undefined);
                      else if (v === "skip") setTopic(t.key, { mode: "skip" });
                      else if (v === "create") setTopic(t.key, { mode: "create", name: t.create?.name ?? t.label, slug: t.create?.slug ?? "" });
                      else setTopic(t.key, { mode: "existing", id: v.slice(9) });
                    }}
                  >
                    <option value="">{t.action === "ambiguous" || t.action === "invalid" ? "Choose…" : "As proposed"}</option>
                    {t.create?.slug && <option value="create">Create new topic</option>}
                    <option value="skip">Don&apos;t assign a topic</option>
                    <optgroup label="Use existing topic">
                      {(t.candidates.length ? topics.filter((o) => t.candidates.some((c) => c.id === o.id)) : topics).map((o) => (
                        <option key={o.id} value={`existing:${o.id}`}>
                          {o.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  {t.message && <p className="w-full text-xs text-warning">{t.message}</p>}
                </li>
              ))}
              {!plan.topics.length && <li className="px-3 py-2 text-muted">No topics.</li>}
            </ul>
          </div>
          <div className="space-y-2">
            <h2 className="font-medium">Tags</h2>
            <div className="flex flex-wrap gap-1.5 rounded-md border border-line p-3">
              {plan.tags.map((t) => (
                <span key={t.key} className={cn("rounded-xs border px-2 py-0.5 text-xs", t.action === "create" ? "border-success/40 text-success" : "border-line text-muted")} title={t.variants.length > 1 ? `Merged: ${t.variants.join(", ")}` : undefined}>
                  {t.name}
                  <span className="ml-1 text-subtle">{t.documentCount}</span>
                </span>
              ))}
              {!plan.tags.length && <span className="text-sm text-muted">No tags.</span>}
            </div>
            <p className="text-xs text-subtle">Green tags are new. Tags that differ only in case or spacing are merged.</p>
          </div>
        </section>
      )}

      {/* Collections */}
      {plan.collections.length > 0 && (
        <section aria-labelledby="collections-heading" className="space-y-2">
          <h2 id="collections-heading" className="font-medium">Collections and order</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {plan.collections.map((c) => (
              <div key={c.key} className="rounded-md border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.title}</span>
                  <Badge tone={c.action === "create" ? "success" : c.action === "merge" ? "info" : "neutral"}>{c.action === "merge" ? `add to existing (${c.existingMemberCount})` : c.action}</Badge>
                  <span className="text-xs text-subtle">order from {c.orderSource === "prefix" ? "numbers in file names" : c.orderSource === "explicit" ? "explicit metadata" : c.orderSource === "manifest" ? "the package" : "file names"}</span>
                </div>
                <ol className="mt-2 space-y-0.5">
                  {c.items.map((item, i) => {
                    const doc = plan.documents.find((d) => d.key === item.documentKey);
                    const prevGroup = c.items[i - 1]?.groupLabel;
                    return (
                      <li key={item.documentKey}>
                        {item.groupLabel && item.groupLabel !== prevGroup && <p className="mt-1.5 text-xs font-medium uppercase tracking-wider text-subtle">{item.groupLabel}</p>}
                        <span className="flex items-center gap-2">
                          <span className="w-6 text-right font-mono text-xs text-subtle">{i + 1}</span>
                          <button type="button" className="truncate text-left hover:underline" onClick={() => setDetail(item.documentKey)}>
                            {doc?.title ?? item.documentKey}
                          </button>
                          <input
                            type="number"
                            aria-label={`Position of ${doc?.title ?? item.documentKey}`}
                            className={`${select} ml-auto w-16`}
                            placeholder="auto"
                            value={decisions.documents?.[item.documentKey]?.order ?? ""}
                            onChange={(e) => setDoc(item.documentKey, { order: e.target.value === "" ? undefined : Number(e.target.value) })}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
          <p className="text-xs text-subtle">Set a position to reorder (lower comes first), then apply changes.</p>
        </section>
      )}

      {/* Documents */}
      <section aria-labelledby="docs-heading" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="docs-heading" className="font-medium">Documents</h2>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title or path" aria-label="Search documents" className={`${inputBase} py-1 pl-7 pr-2 text-sm`} />
          </div>
          <div role="group" aria-label="Filter documents" className="flex flex-wrap gap-1">
            {(["all", "new", "conflicts", "issues", "skipped"] as Filter[]).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn("rounded-sm px-2 py-1 text-xs", filter === f ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink")}>
                {f[0]!.toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-subtle">
            {rows.length} of {plan.documents.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[68rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-subtle [&>th]:whitespace-nowrap [&>th]:pr-3">
                <th scope="col" className="py-2 font-medium">Document</th>
                <th scope="col" className="py-2 font-medium">Format · slug</th>
                <th scope="col" className="py-2 font-medium">Topic · tags</th>
                <th scope="col" className="py-2 font-medium">Collection</th>
                <th scope="col" className="py-2 font-medium">Action</th>
                <th scope="col" className="py-2 font-medium">Becomes</th>
                <th scope="col" className="py-2 font-medium">Notes</th>
                <th scope="col" className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.key} className="border-b border-line/70 align-top">
                  <td className="max-w-[18rem] py-2 pr-3">
                    <p className="truncate font-medium">{d.title || "Untitled"}</p>
                    <p className="truncate font-mono text-[11px] text-subtle">{d.synthetic ? `${d.sourcePath} (folder)` : d.sourcePath}</p>
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    <p>{types.find((t) => t.slug === d.typeSlug)?.name ?? d.typeSlug}</p>
                    <p className="font-mono text-subtle">/{d.slug}</p>
                  </td>
                  <td className="max-w-[12rem] py-2 pr-3 text-xs">
                    <p className="truncate">{d.topicKeys.map(topicLabel).join(", ") || <span className="text-subtle">—</span>}</p>
                    <p className="truncate text-subtle">{d.tagKeys.length ? plan.tags.filter((t) => d.tagKeys.includes(t.key)).map((t) => t.name).join(", ") : ""}</p>
                  </td>
                  <td className="py-2 pr-3 text-xs">{collectionOf(d.collectionKey) ? `${collectionOf(d.collectionKey)!.title} #${d.position}` : <span className="text-subtle">—</span>}</td>
                  <td className="py-2 pr-3">
                    {d.conflict ? (
                      <div className="space-y-1">
                        <select aria-label={`Action for ${d.title}`} className={select} value={decisions.documents?.[d.key]?.action ?? (decisions.duplicateAction ?? "")} onChange={(e) => setDoc(d.key, { action: (e.target.value || undefined) as ConflictAction | undefined })}>
                          <option value="">Choose…</option>
                          <option value="skip">Skip</option>
                          <option value="update">Update</option>
                          <option value="copy">Create a copy</option>
                        </select>
                        <p className="text-[11px] text-subtle">matches “{d.conflict.existing.title}”</p>
                      </div>
                    ) : d.action === "blocked" ? (
                      <Badge tone="danger">Blocked</Badge>
                    ) : (
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" checked={d.action !== "excluded"} onChange={(e) => setDoc(d.key, { include: e.target.checked ? undefined : false })} />
                        <Badge tone={ACTION_TONE[d.action]}>{ACTION_LABEL[d.action]}</Badge>
                      </label>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {d.action === "skip" || d.action === "excluded" || d.action === "blocked" ? (
                      <span className="text-xs text-subtle">—</span>
                    ) : (
                      <div className="space-y-1">
                        <select
                          aria-label={`Result for ${d.title}`}
                          className={`${select} block`}
                          value={`${d.status}:${d.visibility}`}
                          onChange={(e) => {
                            const [status, visibility] = e.target.value.split(":") as [DocumentStatus, Visibility];
                            setDoc(d.key, { status, visibility });
                          }}
                        >
                          {!ROW_CHOICES.some((c) => c.value === `${d.status}:${d.visibility}`) && (
                            <option value={`${d.status}:${d.visibility}`}>
                              {isDocumentStatus(d.status) ? STATUS_LABELS[d.status] : d.status} · {VISIBILITY_LABELS[d.visibility]}
                            </option>
                          )}
                          {ROW_CHOICES.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <OutcomeBadges outcome={outcomeOf(d)} />
                      </div>
                    )}
                  </td>
                  <td className="max-w-[14rem] py-2 pr-3 text-xs">
                    {d.errors > 0 && <Badge tone="danger">{d.errors} error{d.errors === 1 ? "" : "s"}</Badge>} {d.warnings > 0 && <Badge tone="warning">{d.warnings} warning{d.warnings === 1 ? "" : "s"}</Badge>}
                    {d.firstIssue && <p className="mt-1 line-clamp-2 text-muted">{d.firstIssue}</p>}
                  </td>
                  <td className="py-2 text-right">
                    <button type="button" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted hover:text-ink" onClick={() => setDetail(d.key)} aria-label={`Details for ${d.title}`}>
                      Details <ChevronRight size={13} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted">
                    No documents match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Media */}
      {plan.media.length > 0 && (
        <section aria-labelledby="media-heading" className="space-y-2">
          <h2 id="media-heading" className="font-medium">Media</h2>
          <ul className="divide-y divide-line/70 rounded-md border border-line text-sm">
            {plan.media.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <Badge tone={m.action === "upload" ? "success" : m.action === "reuse" ? "neutral" : "warning"}>{m.action.replace("_", " ")}</Badge>
                <span className="truncate font-mono text-xs">{m.path ?? m.url ?? m.key}</span>
                {m.size > 0 && <span className="text-xs text-subtle">{formatBytes(m.size)}</span>}
                <span className="text-xs text-subtle">used by {m.usedBy.length}</span>
                {m.message && <span className="w-full text-xs text-muted">{m.message}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Relationships */}
      {plan.relations.length > 0 && (
        <section aria-labelledby="relations-heading" className="space-y-2">
          <h2 id="relations-heading" className="font-medium">Relationships</h2>
          <p className="text-sm text-muted">Explicit relationships come from the package or front matter. Links between documents become “references” automatically, which is what shows backlinks.</p>
          <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto rounded-md border border-line text-sm">
            {plan.relations.slice(0, 300).map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <Badge tone={r.origin === "manual" ? "accent" : "neutral"}>{r.origin === "manual" ? "explicit" : "from link"}</Badge>
                <span className="truncate">{plan.documents.find((d) => d.key === r.sourceKey)?.title}</span>
                <span className="text-xs text-subtle">{r.kind.replace("_", " ")}</span>
                <span className="truncate">{r.target.status === "incoming" ? plan.documents.find((d) => d.key === (r.target as { key: string }).key)?.title : `existing: ${(r.target as { path: string }).path}`}</span>
                <span className="ml-auto text-xs text-subtle">{r.evidence}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Package-level issues */}
      {(allIssues.length > 0 || rejected.length > 0) && (
        <section aria-labelledby="issues-heading" className="space-y-2">
          <h2 id="issues-heading" className="font-medium">Notes about the package</h2>
          <ul className="space-y-1 text-sm">
            {rejected.map((r) => (
              <li key={`rej:${r.path}`} className="flex gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                <span>
                  <code className="font-mono text-xs">{r.path}</code> — {r.reason}
                </span>
              </li>
            ))}
            {allIssues.map((issue, i) => (
              <li key={i} className="flex gap-2">
                {issue.level === "info" ? <Info size={14} className="mt-0.5 shrink-0 text-info" aria-hidden="true" /> : <AlertTriangle size={14} className={cn("mt-0.5 shrink-0", issue.level === "error" ? "text-danger" : "text-warning")} aria-hidden="true" />}
                <span className="text-muted">{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 px-6 py-3 backdrop-blur-sm lg:left-60 lg:px-10">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-ghost btn-md" onClick={onDiscard} disabled={busy}>
            <Trash2 size={14} aria-hidden="true" /> Discard
          </button>
          <p className="mr-auto text-xs text-muted">
            {dirty ? "You changed some choices. Apply them to refresh the preview." : plan.decisionsRequired.length ? `${plan.decisionsRequired.length} decision(s) still needed.` : `${s.create + s.copy} new, ${s.update} updated, ${s.skip} skipped.`}
          </p>
          {dirty && (
            <button type="button" className="btn btn-ghost btn-md" onClick={onApply} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} Apply changes
            </button>
          )}
          <button type="button" className="btn btn-primary btn-md" disabled={!approvable || busy} onClick={() => setConfirming(true)}>
            Approve and import
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onApprove();
        }}
        title={tally.published + tally.unlisted ? "Import and publish these documents?" : "Import these documents?"}
        confirmLabel={tally.published + tally.unlisted ? "Import and publish" : "Import"}
        body={
          <ul className="list-disc space-y-1 pl-5">
            <li>{s.create + s.copy} new document(s), {s.update} update(s), {s.skip} skipped.</li>
            <li>
              {s.topicsCreate} new topic(s), {s.tagsCreate} new tag(s), {s.collectionsCreate} new collection(s), {s.mediaUpload} media upload(s).
            </li>
            <li className={tally.published + tally.unlisted ? "text-ink" : undefined}>
              {tally.published + tally.unlisted > 0
                ? `${tally.published} will be published (live and listed)${tally.unlisted ? `, ${tally.unlisted} unlisted (live by link)` : ""}; ${tally.notLive} not on the site.`
                : "Nothing will be published: every document stays off the site until you publish it."}{" "}
              {tally.indexed} indexed by search engines once live.
            </li>
            <li>Existing documents change only where you chose “update”, and only in the fields you selected.</li>
          </ul>
        }
      />

      {detail && <DocumentDetail jobId={jobId} docKey={detail} plan={plan} types={types} decision={decisions.documents?.[detail]} onDecision={(patch) => setDoc(detail, patch)} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "danger" | "warning" }) {
  return (
    <div className="rounded-sm border border-line px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("text-lg font-semibold", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</dd>
    </div>
  );
}

