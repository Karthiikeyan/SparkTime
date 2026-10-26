"use client";

import { ArrowDown, ArrowUp, ImagePlus, Link2, Star, Trash2, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { fromDateTimeLocal, toDateTimeLocal } from "@/lib/dates";
import { RELATION_KINDS, ROBOTS_OPTIONS, STATUS_LABELS, TEMPLATE_INFO, TEMPLATES, type FieldDefinition, type RelationKind } from "@/lib/content/model";
import { defaultIndexingLabel } from "@/lib/content/publication";
import type { MediaAsset } from "@/lib/media";
import { applyTitleTemplate } from "@/lib/settings";
import { isValidSlug } from "@/lib/slug";
import { api, errorMessage } from "./api";
import { Badge, Field, inputBase, inputClass, Select, statusTone, TextArea, TextInput, Toggle } from "./fields";
import { useToast } from "./toast";

export type LookupDoc = { id: string; title: string; typeName: string; path: string; status: string; isPublic: boolean };

export function DocLookup({ onPick, excludeIds = [], placeholder = "Search documents…", typeIds = [] }: { onPick: (d: LookupDoc) => void; excludeIds?: string[]; placeholder?: string; typeIds?: string[] }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LookupDoc[]>([]);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const search = async (value: string) => {
    const params = new URLSearchParams({ q: value, limit: "10" });
    for (const t of typeIds) params.append("type", t);
    const r = await api<{ items: LookupDoc[] }>(`/api/admin/documents/lookup?${params.toString()}`);
    setItems(r.items.filter((i) => !excludeIds.includes(i.id)));
  };
  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          void search(e.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          void search(q);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className={inputClass}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {open && items.length > 0 && (
        <ul id={listId} className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-sm border border-line bg-elevated shadow-float" role="listbox">
          {items.map((item) => (
            <li key={item.id} role="option" aria-selected="false">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(item);
                  setQ("");
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                <span className="truncate">{item.title || "Untitled"}</span>
                <span className="shrink-0 text-xs text-subtle">
                  {item.typeName}
                  {!item.isPublic && " · hidden"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export function PropertiesPanel({
  fields,
  values,
  onChange,
  errors,
  pickMedia,
  mediaById,
  titles,
}: {
  fields: FieldDefinition[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errors: Record<string, string>;
  pickMedia: (kind: "image" | "file" | "audio") => Promise<MediaAsset | null>;
  mediaById: Record<string, MediaAsset>;
  titles: Record<string, string>;
}) {
  const [localMedia, setLocalMedia] = useState<Record<string, MediaAsset>>({});
  const [localTitles, setLocalTitles] = useState<Record<string, string>>({});
  if (!fields.length) return <p className="text-sm text-muted">This content type has no custom properties. Add some in Content types.</p>;
  const set = (key: string, value: unknown) => {
    const next = { ...values };
    if (value === "" || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const value = values[f.key];
        const label = `${f.label}${f.required ? " *" : ""}`;
        const error = errors[f.key];
        switch (f.type) {
          case "interview_guide":
            return (
              <p key={f.key} className="text-xs text-muted">
                The <span className="font-medium">{f.label.toLowerCase()}</span> is edited below the body.{error ? <span className="block text-danger">{error}</span> : null}
              </p>
            );
          case "long_text":
            return <TextArea key={f.key} label={label} value={String(value ?? "")} onChange={(v) => set(f.key, v)} help={f.helpText} error={error} rows={f.role === "transcript" ? 8 : 3} />;
          case "number":
            return <TextInput key={f.key} label={label} type="number" value={value === undefined ? "" : String(value)} onChange={(v) => set(f.key, v === "" ? "" : Number(v))} help={f.helpText} error={error} />;
          case "boolean":
            return <Toggle key={f.key} label={f.label} checked={value === true} onChange={(v) => set(f.key, v)} help={f.helpText} />;
          case "url":
          case "email":
          case "text":
            return <TextInput key={f.key} label={label} type={f.type === "email" ? "email" : "text"} mono={f.type === "url"} value={String(value ?? "")} onChange={(v) => set(f.key, v)} help={f.helpText} error={error} placeholder={f.type === "url" ? "https://" : f.options.placeholder} />;
          case "date":
            return <TextInput key={f.key} label={label} type="date" value={String(value ?? "")} onChange={(v) => set(f.key, v)} help={f.helpText} error={error} />;
          case "datetime":
            return (
              <TextInput
                key={f.key}
                label={label}
                type="datetime-local"
                value={toDateTimeLocal(typeof value === "string" ? value : null)}
                onChange={(v) => set(f.key, fromDateTimeLocal(v) ?? "")}
                help={f.helpText}
                error={error}
              />
            );
          case "select":
            return (
              <Field key={f.key} label={label} help={f.helpText} error={error}>
                {(id) => (
                  <select id={id} value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value)} className={inputClass}>
                    <option value="">—</option>
                    {(f.options.choices ?? []).map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            );
          case "multi_select":
            return <ChipInput key={f.key} label={label} values={Array.isArray(value) ? (value as string[]) : []} onChange={(v) => set(f.key, v)} choices={f.options.choices ?? []} allowCustom={f.options.allowCustom === true} error={error} />;
          case "image":
          case "file": {
            const asset = typeof value === "string" ? localMedia[value] ?? mediaById[value] : undefined;
            return (
              <Field key={f.key} label={label} help={f.helpText} error={error}>
                {() => (
                  <div className="flex items-center gap-3">
                    {asset?.kind === "image" && (
                      // eslint-disable-next-line @next/next/no-img-element -- admin preview
                      <img src={asset.variants[0]?.url ?? asset.url} alt="" className="size-14 rounded-xs object-cover" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">{asset?.originalName ?? (value ? "Selected" : "None")}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        const picked = await pickMedia(f.type === "image" ? "image" : "file");
                        if (picked) {
                          setLocalMedia((m) => ({ ...m, [picked.id]: picked }));
                          set(f.key, picked.id);
                        }
                      }}
                    >
                      Choose
                    </button>
                    {value ? (
                      <button type="button" onClick={() => set(f.key, "")} aria-label={`Clear ${f.label}`} className="text-subtle hover:text-danger">
                        <X size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                )}
              </Field>
            );
          }
          case "relation": {
            const ids = Array.isArray(value) ? (value as string[]) : typeof value === "string" ? [value] : [];
            return (
              <Field key={f.key} label={label} help={f.helpText} error={error}>
                {() => (
                  <div className="space-y-1.5">
                    {ids.map((id) => (
                      <div key={id} className="flex items-center justify-between rounded-xs bg-surface-2 px-2.5 py-1.5 text-sm">
                        <span className="truncate">{localTitles[id] ?? titles[id] ?? "Document"}</span>
                        <button type="button" onClick={() => set(f.key, f.options.multiple ? ids.filter((x) => x !== id) : "")} aria-label="Remove" className="text-subtle hover:text-danger">
                          <X size={13} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                    {(f.options.multiple || ids.length === 0) && (
                      <DocLookup
                        excludeIds={ids}
                        typeIds={f.options.targetTypeIds ?? []}
                        onPick={(d) => {
                          setLocalTitles((t) => ({ ...t, [d.id]: d.title }));
                          set(f.key, f.options.multiple ? [...ids, d.id] : d.id);
                        }}
                      />
                    )}
                  </div>
                )}
              </Field>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}

function ChipInput({ label, values, onChange, choices, allowCustom, error }: { label: string; values: string[]; onChange: (v: string[]) => void; choices: Array<{ value: string; label: string }>; allowCustom: boolean; error?: string }) {
  const [draft, setDraft] = useState("");
  const add = (v: string) => {
    const value = v.trim();
    if (!value || values.includes(value)) return;
    if (!allowCustom && !choices.some((c) => c.value === value)) return;
    onChange([...values, value]);
    setDraft("");
  };
  return (
    <Field label={label} error={error}>
      {(id) => (
        <div className="rounded-sm border border-line bg-surface p-1.5 focus-within:border-accent">
          <div className="flex flex-wrap gap-1">
            {values.map((v) => (
              <span key={v} className="inline-flex items-center gap-1 rounded-xs bg-surface-2 px-1.5 py-0.5 text-xs">
                {choices.find((c) => c.value === v)?.label ?? v}
                <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
            {allowCustom ? (
              <input
                id={id}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    add(draft);
                  } else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
                }}
                onBlur={() => add(draft)}
                placeholder="Type and press Enter"
                className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none"
              />
            ) : (
              <select id={id} value="" onChange={(e) => add(e.target.value)} className="flex-1 bg-transparent text-sm outline-none">
                <option value="">Add…</option>
                {choices
                  .filter((c) => !values.includes(c.value))
                  .map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </div>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Details (lifecycle, URL, featured image)
// ---------------------------------------------------------------------------

export function DetailsPanel({
  status,
  visibility,
  outcome,
  slug,
  path,
  siteUrl,
  featured,
  priority,
  templateOverride,
  typeTemplate,
  publishedAt,
  featuredImage,
  onSettings,
  onStatus,
  onSlug,
  onPickFeatured,
  onClearFeatured,
}: {
  status: string;
  visibility: string;
  /** One sentence: what the document is now, or what Publish will make it. */
  outcome: string;
  slug: string;
  path: string;
  siteUrl: string;
  featured: boolean;
  priority: number;
  templateOverride: string | null;
  typeTemplate: string;
  publishedAt: string | null;
  featuredImage: MediaAsset | null;
  onSettings: (s: Record<string, unknown>) => void;
  onStatus: (s: string) => void;
  onSlug: (s: string) => Promise<void>;
  onPickFeatured: () => void;
  onClearFeatured: () => void;
}) {
  const [slugDraft, setSlugDraft] = useState(slug);
  const [slugBusy, setSlugBusy] = useState(false);
  const slugValid = isValidSlug(slugDraft);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Status"
          value={status}
          onChange={(v) => onStatus(v)}
          options={(["idea", "draft", "scheduled", "published", "archived"] as const).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        />
        <Select
          label="Who can see it"
          value={visibility}
          onChange={(v) => onSettings({ visibility: v })}
          options={[
            { value: "public", label: "Everyone (listed)" },
            { value: "unlisted", label: "Anyone with the link" },
            { value: "private", label: "Only me (private)" },
          ]}
        />
      </div>
      <p className="text-xs text-subtle" role="status">
        {outcome}
        {status === "scheduled" && " “Scheduled” is a planning label — publish manually when ready."}
      </p>

      <Field label="URL" help={`${siteUrl}${path}`}>
        {(id) => (
          <div className="flex gap-2">
            <input id={id} value={slugDraft} onChange={(e) => setSlugDraft(e.target.value.toLowerCase())} className={cn(inputClass, "font-mono", !slugValid && "border-danger")} aria-invalid={!slugValid} />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={slugDraft === slug || !slugValid || slugBusy}
              onClick={async () => {
                setSlugBusy(true);
                try {
                  await onSlug(slugDraft);
                } finally {
                  setSlugBusy(false);
                }
              }}
            >
              Change
            </button>
          </div>
        )}
      </Field>
      {slugDraft !== slug && status === "published" && <p className="-mt-3 text-xs text-warning">The old URL will permanently redirect to the new one.</p>}

      <Field label="Featured image">
        {() =>
          featuredImage ? (
            <div className="relative overflow-hidden rounded-sm border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin preview */}
              <img src={featuredImage.variants[0]?.url ?? featuredImage.url} alt={featuredImage.alt} className="aspect-video w-full object-cover" />
              <div className="absolute right-2 top-2 flex gap-1">
                <button type="button" onClick={onPickFeatured} className="rounded-xs bg-black/60 px-2 py-1 text-xs text-white">
                  Replace
                </button>
                <button type="button" onClick={onClearFeatured} className="rounded-xs bg-black/60 px-2 py-1 text-xs text-white" aria-label="Remove featured image">
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={onPickFeatured} className="flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-line-strong py-6 text-sm text-muted hover:border-accent hover:text-accent">
              <ImagePlus size={16} aria-hidden="true" /> Add featured image
            </button>
          )
        }
      </Field>

      <Toggle label="Featured" checked={featured} onChange={(v) => onSettings({ featured: v })} help="Shown in Featured sections and ranked higher in recommendations." />
      <TextInput label="Curated priority (-100 to 100)" type="number" value={String(priority)} onChange={(v) => onSettings({ priority: Math.max(-100, Math.min(100, Number(v) || 0)) })} help="Nudges ordering in curated lists and related content." />
      <Select
        label="Template"
        value={templateOverride ?? ""}
        onChange={(v) => onSettings({ templateOverride: v || null })}
        options={[{ value: "", label: `Type default (${TEMPLATE_INFO[typeTemplate as keyof typeof TEMPLATE_INFO]?.label ?? typeTemplate})` }, ...TEMPLATES.map((t) => ({ value: t, label: TEMPLATE_INFO[t].label }))]}
      />
      <TextInput
        label="Publication date"
        type="datetime-local"
        value={toDateTimeLocal(publishedAt)}
        onChange={(v) => onSettings({ publishedAt: fromDateTimeLocal(v) })}
        help="Set automatically on first publish; adjust for back-dated pieces."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export function TaxonomyPanel({
  documentId,
  categories,
  allCategories,
  tags,
  allTags,
  onUpdated,
}: {
  documentId: string;
  categories: Array<{ id: string; name: string; isPrimary: boolean }>;
  allCategories: Array<{ id: string; name: string; parentId: string | null; archivedAt: string | null }>;
  tags: Array<{ id: string; name: string }>;
  allTags: Array<{ id: string; name: string }>;
  onUpdated: (next: { categories: Array<{ id: string; name: string; slug: string; isPrimary: boolean }>; tags: Array<{ id: string; name: string; slug: string }> }) => void;
}) {
  const toast = useToast();
  const [tagDraft, setTagDraft] = useState("");
  const primary = categories.find((c) => c.isPrimary)?.id ?? categories[0]?.id ?? null;
  const ordered = useMemo(() => {
    const roots = allCategories.filter((c) => !c.parentId && !c.archivedAt);
    return roots.flatMap((r) => [{ ...r, depth: 0 }, ...allCategories.filter((c) => c.parentId === r.id && !c.archivedAt).map((c) => ({ ...c, depth: 1 }))]);
  }, [allCategories]);

  const save = async (next: { categoryIds: string[]; primaryCategoryId: string | null; tagIds: string[]; tagNames?: string[] }) => {
    try {
      onUpdated(await api(`/api/admin/documents/${documentId}/taxonomy`, { method: "PUT", body: next }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const catIds = categories.map((c) => c.id);
  const tagIds = tags.map((t) => t.id);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-muted">Categories</p>
        <p className="mb-2 text-xs text-subtle">Star marks the primary topic (breadcrumbs, cards).</p>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {ordered.map((c) => {
            const checked = catIds.includes(c.id);
            return (
              <li key={c.id} className="flex items-center gap-2" style={{ paddingLeft: c.depth * 16 }}>
                <input
                  id={`cat-${c.id}`}
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked ? catIds.filter((x) => x !== c.id) : [...catIds, c.id];
                    void save({ categoryIds: next, primaryCategoryId: primary && next.includes(primary) ? primary : next[0] ?? null, tagIds });
                  }}
                  className="size-4 accent-[var(--accent)]"
                />
                <label htmlFor={`cat-${c.id}`} className="flex-1 py-1 text-sm">
                  {c.name}
                </label>
                {checked && (
                  <button
                    type="button"
                    onClick={() => void save({ categoryIds: catIds, primaryCategoryId: c.id, tagIds })}
                    aria-label={`Make ${c.name} the primary category`}
                    aria-pressed={primary === c.id}
                    className={primary === c.id ? "text-accent" : "text-subtle hover:text-ink"}
                  >
                    <Star size={14} className={primary === c.id ? "fill-current" : ""} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-muted">Tags</p>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-xs bg-surface-2 px-2 py-0.5 text-xs">
              #{t.name}
              <button type="button" onClick={() => void save({ categoryIds: catIds, primaryCategoryId: primary, tagIds: tagIds.filter((x) => x !== t.id) })} aria-label={`Remove tag ${t.name}`}>
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
        <input
          list={`tags-${documentId}`}
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && tagDraft.trim()) {
              e.preventDefault();
              const existing = allTags.find((t) => t.name.toLowerCase() === tagDraft.trim().toLowerCase());
              void save({ categoryIds: catIds, primaryCategoryId: primary, tagIds: existing ? [...tagIds, existing.id] : tagIds, tagNames: existing ? [] : [tagDraft.trim()] });
              setTagDraft("");
            }
          }}
          placeholder="Add a tag and press Enter"
          className={cn(inputClass, "mt-2")}
          aria-label="Add tag"
        />
        <datalist id={`tags-${documentId}`}>
          {allTags.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

type Relation = { targetId: string; kind: RelationKind; note: string; title: string; typeName: string };

export function RelationsPanel({
  documentId,
  initial,
  backlinks,
}: {
  documentId: string;
  initial: Relation[];
  backlinks: Array<{ sourceId: string; kind: RelationKind; title: string; typeName: string }>;
}) {
  const toast = useToast();
  const [relations, setRelations] = useState<Relation[]>(initial);
  const [kind, setKind] = useState<RelationKind>("related");
  const persist = async (next: Relation[]) => {
    setRelations(next);
    try {
      await api(`/api/admin/documents/${documentId}/relations`, { method: "PUT", body: { relations: next.map((r) => ({ targetId: r.targetId, kind: r.kind, note: r.note })) } });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {relations.length === 0 && <p className="text-sm text-muted">No curated connections yet. Links and @mentions in the body are tracked automatically.</p>}
        {relations.map((r, i) => (
          <div key={`${r.targetId}-${r.kind}`} className="rounded-sm border border-line p-2.5">
            <div className="flex items-center gap-2">
              <select
                value={r.kind}
                onChange={(e) => void persist(relations.map((x, j) => (j === i ? { ...x, kind: e.target.value as RelationKind } : x)))}
                className="rounded-xs border border-line bg-surface px-1.5 py-1 text-xs"
                aria-label="Relationship kind"
              >
                {Object.entries(RELATION_KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
              <button type="button" disabled={i === 0} onClick={() => void persist(swap(relations, i, i - 1))} aria-label="Move up" className="text-subtle disabled:opacity-30">
                <ArrowUp size={13} aria-hidden="true" />
              </button>
              <button type="button" disabled={i === relations.length - 1} onClick={() => void persist(swap(relations, i, i + 1))} aria-label="Move down" className="text-subtle disabled:opacity-30">
                <ArrowDown size={13} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => void persist(relations.filter((_, j) => j !== i))} aria-label="Remove relationship" className="text-subtle hover:text-danger">
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
            <input
              defaultValue={r.note}
              onBlur={(e) => e.target.value !== r.note && void persist(relations.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
              placeholder="Why it's related (optional, shown to readers)"
              className="mt-2 w-full bg-transparent text-xs text-muted outline-none placeholder:text-subtle"
              aria-label="Relationship note"
            />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as RelationKind)} className={inputClass} aria-label="New relationship kind">
          {Object.entries(RELATION_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}…
            </option>
          ))}
        </select>
        <DocLookup
          excludeIds={[documentId, ...relations.map((r) => r.targetId)]}
          placeholder="Connect to a document…"
          onPick={(d) => void persist([...relations, { targetId: d.id, kind, note: "", title: d.title, typeName: d.typeName }])}
        />
      </div>
      {backlinks.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Link2 size={12} aria-hidden="true" /> Referenced by (automatic)
          </p>
          <ul className="space-y-1">
            {backlinks.map((b) => (
              <li key={`${b.sourceId}-${b.kind}`} className="flex items-center justify-between gap-2 text-sm">
                <a href={`/admin/documents/${b.sourceId}`} className="truncate hover:text-accent">
                  {b.title || "Untitled"}
                </a>
                <span className="shrink-0 text-xs text-subtle">{RELATION_KINDS[b.kind].inverse}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}

// ---------------------------------------------------------------------------
// Collection items
// ---------------------------------------------------------------------------

type Item = { documentId: string; groupLabel: string; note: string; title: string; typeName: string; status: string };

export function ItemsPanel({ documentId, initial }: { documentId: string; initial: Item[] }) {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>(initial);
  const persist = async (next: Item[]) => {
    setItems(next);
    try {
      await api(`/api/admin/documents/${documentId}/items`, { method: "PUT", body: { items: next.map((i) => ({ documentId: i.documentId, groupLabel: i.groupLabel, note: i.note })) } });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-subtle">Order matters. Group labels become modules/sections (e.g. “Week 1”, “Books”).</p>
      {items.map((item, i) => (
        <div key={item.documentId} className="rounded-sm border border-line p-2.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-subtle">{String(i + 1).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title || "Untitled"}</span>
            {item.status !== "published" && <Badge tone={statusTone(item.status)}>{item.status}</Badge>}
            <button type="button" disabled={i === 0} onClick={() => void persist(swap(items, i, i - 1))} aria-label="Move up" className="text-subtle disabled:opacity-30">
              <ArrowUp size={13} aria-hidden="true" />
            </button>
            <button type="button" disabled={i === items.length - 1} onClick={() => void persist(swap(items, i, i + 1))} aria-label="Move down" className="text-subtle disabled:opacity-30">
              <ArrowDown size={13} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => void persist(items.filter((_, j) => j !== i))} aria-label="Remove item" className="text-subtle hover:text-danger">
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input defaultValue={item.groupLabel} onBlur={(e) => e.target.value !== item.groupLabel && void persist(items.map((x, j) => (j === i ? { ...x, groupLabel: e.target.value } : x)))} placeholder="Group" className={cn(inputBase, "w-full px-2 py-1 text-xs")} aria-label="Group label" />
            <input defaultValue={item.note} onBlur={(e) => e.target.value !== item.note && void persist(items.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} placeholder="Note to readers" className={cn(inputBase, "w-full px-2 py-1 text-xs")} aria-label="Note" />
          </div>
        </div>
      ))}
      <DocLookup
        excludeIds={[documentId, ...items.map((i) => i.documentId)]}
        placeholder="Add a document to this collection…"
        onPick={(d) => void persist([...items, { documentId: d.id, groupLabel: items[items.length - 1]?.groupLabel ?? "", note: "", title: d.title, typeName: d.typeName, status: d.status }])}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

export function SeoPanel({
  title,
  excerpt,
  path,
  siteUrl,
  siteName,
  titleTemplate,
  seoTitle,
  seoDescription,
  canonicalUrl,
  robotsIndex,
  visibility,
  typeIndexable,
  onSettings,
}: {
  title: string;
  excerpt: string;
  path: string;
  siteUrl: string;
  siteName: string;
  titleTemplate: string;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  robotsIndex: string;
  visibility: string;
  /** The format's own setting (Formats & fields): what "Default" means for a public document. */
  typeIndexable: boolean;
  onSettings: (s: Record<string, unknown>) => void;
}) {
  const shownTitle = applyTitleTemplate(titleTemplate, seoTitle || title || "Untitled", siteName);
  const shownDesc = seoDescription || excerpt || "Add an excerpt or SEO description.";
  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-line bg-surface p-3" aria-label="Search result preview">
        <p className="truncate text-xs text-muted">{`${siteUrl}${path}`.replace(/^https?:\/\//, "")}</p>
        <p className="mt-0.5 line-clamp-1 text-[1.05rem] text-info">{shownTitle}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted">{shownDesc}</p>
      </div>
      <TextInput label={`SEO title (${(seoTitle || title).length}/60)`} value={seoTitle} onChange={(v) => onSettings({ seoTitle: v })} maxLength={120} help="Defaults to the title. Keep under ~60 characters." />
      <TextArea label={`Meta description (${(seoDescription || excerpt).length}/160)`} value={seoDescription} onChange={(v) => onSettings({ seoDescription: v })} maxLength={320} help="Defaults to the excerpt. Aim for 120–160 characters." />
      <TextInput label="Canonical URL" value={canonicalUrl} onChange={(v) => onSettings({ canonicalUrl: v })} mono placeholder="Only if this was first published elsewhere" />
      <Select
        label="Search engines"
        value={robotsIndex}
        onChange={(v) => onSettings({ robotsIndex: v })}
        options={ROBOTS_OPTIONS.map((o) => ({ value: o, label: o === "default" ? `Default (${defaultIndexingLabel(visibility, typeIndexable)})` : o === "index" ? "Index" : "No-index" }))}
        help={`Drafts and private documents are never indexed. ${typeIndexable ? "This format is indexed by default when public." : "This format is not indexed by default; choose Index to opt this document in."}`}
      />
    </div>
  );
}
