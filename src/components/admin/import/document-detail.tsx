"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { INDEXING_INFO, INDEXINGS, type Indexing } from "@/lib/content/publication";
import { CLEARABLE_FIELDS, UPDATE_FIELDS, type ConflictAction, type DocumentDecision, type UpdateField } from "@/lib/portability/plan-types";
import type { PlanView } from "@/lib/portability/plan-view";
import type { AdminDocument } from "@/server/services/documents";
import type { DocumentDetail as Detail } from "@/server/services/import/jobs";
import { api, errorMessage } from "../api";
import { Badge } from "../badge";
import { inputBase } from "../styles";
import { Modal } from "../modal";
import type { TypeOption } from "./plan-preview";

const FIELD_LABELS: Record<UpdateField, string> = {
  title: "Title",
  slug: "URL slug",
  body: "Body",
  excerpt: "Excerpt",
  seo: "SEO title, description, canonical",
  status: "Status",
  visibility: "Visibility",
  topics: "Topics (added)",
  tags: "Tags (added)",
  relations: "Relationships (added)",
  cover: "Cover image",
  dates: "Dates",
  properties: "Fields",
  notes: "Private notes",
};

export function DocumentDetail({ jobId, docKey, plan, types, decision, onDecision, onClose }: { jobId: string; docKey: string; plan: PlanView; types: TypeOption[]; decision: DocumentDecision | undefined; onDecision: (patch: Partial<DocumentDecision>) => void; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [existing, setExisting] = useState<AdminDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const row = plan.documents.find((d) => d.key === docKey);

  useEffect(() => {
    let live = true;
    api<Detail>(`/api/admin/import/jobs/${jobId}/document?key=${encodeURIComponent(docKey)}`)
      .then(async (d) => {
        if (!live) return;
        setDetail(d);
        const match = decision?.matchId ?? d.plan.conflict?.existing.id;
        if (match) setExisting(await api<AdminDocument>(`/api/admin/documents/${match}`));
      })
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [jobId, docKey, decision?.matchId]);

  const p = detail?.plan;
  const action = decision?.action ?? (p?.conflict ? undefined : null);
  const fields = new Set(decision?.updateFields ?? []);
  const clears = new Set(decision?.clearFields ?? []);
  const toggle = (set: Set<UpdateField>, f: UpdateField, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(f);
    else next.delete(f);
    return [...next];
  };

  return (
    <Modal open onClose={onClose} title={row?.title || "Document"} description={row?.sourcePath} size="lg">
      {!detail && !error && (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading preview…
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {p && (
        <div className="space-y-6 text-sm">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Pair label="Title" value={p.title} from={p.titleFrom} />
            <Pair label="Format" value={types.find((t) => t.slug === p.typeSlug)?.name ?? p.typeSlug ?? "—"} from={p.typeFrom} />
            <Pair label="URL" value={`/${p.typeSlug}/${p.slug}`} from={p.slugFrom} mono />
            <Pair label="Status" value={`${p.status} · ${p.visibility}`} from={p.statusFrom} />
            <Pair label="Excerpt" value={p.excerpt ?? "—"} />
            <Pair label="SEO title / description" value={[p.seoTitle, p.seoDescription].filter(Boolean).join(" — ") || "—"} />
            <Pair label="Canonical URL" value={p.canonicalUrl ?? "—"} mono />
            <Pair label="Dates" value={[p.publishedAt && `published ${p.publishedAt.slice(0, 10)}`, p.updatedAt && `updated ${p.updatedAt.slice(0, 10)}`, p.createdAt && `created ${p.createdAt.slice(0, 10)}`].filter(Boolean).join(", ") || "—"} />
            <Pair label="Topics" value={p.topicKeys.map((k) => plan.topics.find((t) => t.key === k)?.label ?? k).join(", ") || "—"} />
            <Pair label="Tags" value={plan.tags.filter((t) => p.tagKeys.includes(t.key)).map((t) => t.name).join(", ") || "—"} />
            <Pair label="Fields" value={Object.keys(p.properties).join(", ") || "—"} />
            <Pair label="Words · blocks" value={`${p.wordCount} · ${p.blockCount}`} />
          </dl>

          {p.conflict && (
            <section aria-labelledby="conflict-heading" className="space-y-3 rounded-md border border-warning/40 bg-warning/5 p-4">
              <h3 id="conflict-heading" className="font-medium">
                Already exists: “{p.conflict.existing.title}” <span className="font-mono text-xs text-muted">{p.conflict.existing.path}</span>
              </h3>
              <p className="text-muted">
                Matched by {p.conflict.reason === "identity" ? "identity (an earlier import or export of the same file)" : p.conflict.reason === "slug" ? "format and URL slug" : p.conflict.reason === "canonical" ? "canonical URL" : "an old URL"}.
              </p>
              {p.conflict.candidates.length > 1 && (
                <label className="block">
                  <span className="text-xs text-muted">Which existing document is it?</span>
                  <select className={`${inputBase} mt-1 w-full px-2 py-1`} value={decision?.matchId ?? ""} onChange={(e) => onDecision({ matchId: e.target.value || undefined })}>
                    <option value="">Choose…</option>
                    {p.conflict.candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} ({c.path})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div role="radiogroup" aria-label="What to do with the duplicate" className="flex flex-wrap gap-2">
                {(["skip", "update", "copy"] as ConflictAction[]).map((a) => (
                  <label key={a} className="flex items-center gap-1.5">
                    <input type="radio" name="conflict-action" checked={action === a} onChange={() => onDecision({ action: a })} />
                    {a === "skip" ? "Skip (leave it unchanged)" : a === "update" ? "Update selected fields" : "Create a copy (new draft)"}
                  </label>
                ))}
              </div>
              {action === "update" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted">Only checked fields change. Unchecked fields — and anything the file doesn&apos;t mention — stay as they are. Topics, tags and relationships are added, never removed.</p>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDecision({ updateFields: [...UPDATE_FIELDS] })}>
                      Select all incoming
                    </button>
                  </div>
                  {fields.size === UPDATE_FIELDS.length && <p className="text-xs text-warning">All incoming values will replace the existing ones where the file has them (body, title, SEO…). The URL changes only if “URL slug” is checked; a redirect keeps the old URL working.</p>}
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-subtle">
                        <th scope="col" className="py-1 font-medium">Update</th>
                        <th scope="col" className="py-1 font-medium">Field</th>
                        <th scope="col" className="py-1 font-medium">Existing</th>
                        <th scope="col" className="py-1 font-medium">Incoming</th>
                        <th scope="col" className="py-1 font-medium">Clear</th>
                      </tr>
                    </thead>
                    <tbody>
                      {UPDATE_FIELDS.map((f) => (
                        <tr key={f} className="border-t border-line/70 align-top">
                          <td className="py-1">
                            <input type="checkbox" aria-label={`Update ${FIELD_LABELS[f]}`} checked={fields.has(f)} onChange={(e) => onDecision({ updateFields: toggle(fields, f, e.target.checked) })} />
                          </td>
                          <td className="py-1 pr-2">{FIELD_LABELS[f]}</td>
                          <td className="max-w-[14rem] truncate py-1 pr-2 text-muted">{existingValue(existing, f)}</td>
                          <td className="max-w-[14rem] truncate py-1 pr-2">{incomingValue(p, f, plan)}</td>
                          <td className="py-1">
                            {(CLEARABLE_FIELDS as readonly string[]).includes(f) && <input type="checkbox" aria-label={`Clear ${FIELD_LABELS[f]}`} checked={clears.has(f)} onChange={(e) => onDecision({ clearFields: toggle(clears, f, e.target.checked) })} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-subtle">Apply changes to see the effect in the preview.</p>
            </section>
          )}

          <label className="flex flex-wrap items-center gap-2">
            <span>Search engines</span>
            <select className={`${inputBase} px-2 py-1 text-xs`} value={decision?.indexing ?? ""} onChange={(e) => onDecision({ indexing: (e.target.value || undefined) as Indexing | undefined })}>
              <option value="">Import-wide choice</option>
              {INDEXINGS.map((i) => (
                <option key={i} value={i}>
                  {INDEXING_INFO[i].label}
                </option>
              ))}
            </select>
            <span className="text-xs text-subtle">
              Now: {p.robotsIndex ?? "format default"}
              {p.robotsFrom === "source" ? " (the file asks for noindex)" : p.robotsFrom === "decision" ? " (your choice)" : ""}
            </span>
          </label>

          {!p.conflict && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={decision?.include !== false} onChange={(e) => onDecision({ include: e.target.checked ? undefined : false })} />
              Import this document
            </label>
          )}

          {p.refs.length > 0 && (
            <section aria-labelledby="refs-heading">
              <h3 id="refs-heading" className="font-medium">Links and references</h3>
              <ul className="mt-1 space-y-1">
                {p.refs.map((r) => (
                  <li key={r.index} className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.resolution.status === "incoming" || r.resolution.status === "existing" ? "success" : r.resolution.status === "kept" ? "neutral" : "warning"}>{r.resolution.status}</Badge>
                    <span className="font-mono text-xs">{r.target.kind === "path" ? r.target.path : r.target.kind === "wiki" ? `[[${r.target.name}]]` : r.target.kind === "pid" ? r.target.pid : r.target.kind === "site" ? r.target.path : r.target.slug}</span>
                    <span className="text-xs text-muted">
                      {r.resolution.status === "incoming" ? `→ ${plan.documents.find((d) => d.key === (r.resolution as { key: string }).key)?.title}` : r.resolution.status === "existing" ? `→ ${r.resolution.path}` : r.resolution.status === "unresolved" ? r.resolution.reason : r.resolution.status === "ambiguous" ? `${r.resolution.candidates.length} matches` : "kept as written"}
                    </span>
                    <span className="ml-auto text-xs text-subtle">{r.evidence}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {p.mediaRefs.length > 0 && (
            <section aria-labelledby="media-refs-heading">
              <h3 id="media-refs-heading" className="font-medium">Media</h3>
              <ul className="mt-1 space-y-1">
                {p.mediaRefs.map((m) => {
                  const media = plan.media.find((x) => x.key === m.mediaKey);
                  return (
                    <li key={m.index} className="flex flex-wrap items-center gap-2">
                      <Badge tone={media?.action === "upload" || media?.action === "reuse" ? "success" : "warning"}>{media?.action ?? "missing"}</Badge>
                      <span className="font-mono text-xs">{media?.path ?? media?.url ?? m.mediaKey}</span>
                      {media?.message && <span className="text-xs text-muted">{media.message}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {p.issues.length > 0 && (
            <section aria-labelledby="doc-issues-heading">
              <h3 id="doc-issues-heading" className="font-medium">Notes</h3>
              <ul className="mt-1 space-y-1">
                {p.issues.map((i, n) => (
                  <li key={n} className="flex gap-2">
                    <Badge tone={i.level === "error" ? "danger" : i.level === "warning" ? "warning" : "info"}>{i.level}</Badge>
                    <span className="text-muted">{i.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {Object.keys(detail!.unmapped).length > 0 && (
            <section aria-labelledby="unmapped-heading">
              <h3 id="unmapped-heading" className="font-medium">Source metadata kept as-is</h3>
              <p className="text-xs text-muted">No matching field here. It is stored with the import record and included in future exports.</p>
              <pre className="mt-1 max-h-40 overflow-auto rounded-sm bg-surface-2 p-2 font-mono text-xs">{JSON.stringify(detail!.unmapped, null, 2)}</pre>
            </section>
          )}

          <section aria-labelledby="body-heading">
            <h3 id="body-heading" className="font-medium">Converted body</h3>
            <p className="text-xs text-muted">Shown as Markdown with links pointing where they will after import. Blocks without a Markdown form appear as HTML or notes.</p>
            <pre className="mt-1 max-h-[24rem] overflow-auto whitespace-pre-wrap rounded-sm border border-line bg-surface p-3 font-mono text-xs leading-relaxed">{detail!.markdown || "(empty)"}</pre>
          </section>
        </div>
      )}
    </Modal>
  );
}

function Pair({ label, value, from, mono = false }: { label: string; value: string; from?: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">
        {label}
        {from && <span className="ml-1 text-subtle">· {from}</span>}
      </dt>
      <dd className={mono ? "break-all font-mono text-xs" : "break-words"}>{value}</dd>
    </div>
  );
}

function existingValue(doc: AdminDocument | null, f: UpdateField): string {
  if (!doc) return "…";
  switch (f) {
    case "title":
      return doc.title;
    case "slug":
      return doc.slug;
    case "body":
      return `${doc.wordCount} words`;
    case "excerpt":
      return doc.excerpt || "—";
    case "seo":
      return [doc.seoTitle, doc.seoDescription].filter(Boolean).join(" — ") || "—";
    case "status":
      return doc.status;
    case "visibility":
      return doc.visibility;
    case "topics":
      return doc.categories.map((c) => c.name).join(", ") || "—";
    case "tags":
      return doc.tags.map((t) => t.name).join(", ") || "—";
    case "relations":
      return `${doc.relations.length}`;
    case "cover":
      return doc.featuredMediaId ? "set" : "—";
    case "dates":
      return doc.publishedAt ? `published ${String(doc.publishedAt).slice(0, 10)}` : "—";
    case "properties":
      return Object.keys(doc.properties).join(", ") || "—";
    case "notes":
      return doc.notes ? `${doc.notes.length} characters` : "—";
  }
}

function incomingValue(p: Detail["plan"], f: UpdateField, plan: PlanView): string {
  switch (f) {
    case "title":
      return p.title;
    case "slug":
      return p.slug;
    case "body":
      return `${p.wordCount} words`;
    case "excerpt":
      return p.excerpt ?? "(not in file)";
    case "seo":
      return [p.seoTitle, p.seoDescription].filter(Boolean).join(" — ") || "(not in file)";
    case "status":
      return p.status;
    case "visibility":
      return p.visibility;
    case "topics":
      return p.topicKeys.map((k) => plan.topics.find((t) => t.key === k)?.label ?? k).join(", ") || "(none)";
    case "tags":
      return plan.tags.filter((t) => p.tagKeys.includes(t.key)).map((t) => t.name).join(", ") || "(none)";
    case "relations":
      return `${plan.relations.filter((r) => r.sourceKey === p.key && r.origin === "manual").length}`;
    case "cover":
      return p.coverMediaKey ? "set" : "(not in file)";
    case "dates":
      return p.publishedAt ? `published ${p.publishedAt.slice(0, 10)}` : "(not in file)";
    case "properties":
      return Object.keys(p.properties).join(", ") || "(none)";
    case "notes":
      return p.notes ? `${p.notes.length} characters` : "(not in file)";
  }
}
