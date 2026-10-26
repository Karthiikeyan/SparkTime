"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ContentIcon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import {
  FIELD_ROLES,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  ICONS,
  RELATION_KINDS,
  roleAcceptsType,
  SCHEMA_TYPES,
  TEMPLATE_INFO,
  TEMPLATES,
  type FieldDefinition,
  type FieldRole,
  type FieldType,
} from "@/lib/content/model";
import { slugify } from "@/lib/slug";
import { api, errorMessage } from "./api";
import { Select, TextArea, TextInput, Toggle } from "./fields";
import { ConfirmDialog } from "./modal";
import { useToast } from "./toast";

export type TypeDraft = {
  id?: string;
  name: string;
  pluralName: string;
  slug: string;
  description: string;
  template: string;
  schemaType: string;
  icon: string;
  indexable: boolean;
  inFeeds: boolean;
  showInQuickCreate: boolean;
  isSystem: boolean;
  fields: FieldDefinition[];
  documentCount: number;
};

function camelKey(label: string): string {
  const words = label
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join("");
  return /^[a-z]/.test(key) ? key.slice(0, 40) : `field${key}`.slice(0, 40);
}

const newField = (position: number): FieldDefinition => ({ key: "", label: "", type: "text", role: null, required: false, helpText: "", options: {}, showInFacts: true, position });

export function TypeBuilder({ initial, allTypes }: { initial: TypeDraft; allTypes: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isNew = !initial.id;

  const setField = (index: number, patch: Partial<FieldDefinition>) =>
    setDraft((d) => ({ ...d, fields: d.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) }));

  const save = async () => {
    setSaving(true);
    setErrors(null);
    try {
      const body = { ...draft, fields: draft.fields.map((f, i) => ({ ...f, position: i })) };
      const saved = await api<{ id: string }>(isNew ? "/api/admin/content-types" : `/api/admin/content-types/${draft.id}`, { method: isNew ? "POST" : "PATCH", body });
      toast.success("Content type saved.");
      router.push(`/admin/types/${saved.id}`);
      router.refresh();
    } catch (e) {
      setErrors(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-10 px-6 py-8 lg:grid-cols-[1fr_22rem] lg:px-10">
      <div className="space-y-8">
        <section className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Name (singular)" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v, pluralName: isNew ? `${v}s` : d.pluralName, slug: isNew ? slugify(v) : d.slug }))} placeholder="Book Review" />
          <TextInput label="Plural / section name" value={draft.pluralName} onChange={(v) => setDraft((d) => ({ ...d, pluralName: v }))} placeholder="Book Reviews" />
          <TextInput label="URL segment" value={draft.slug} onChange={(v) => setDraft((d) => ({ ...d, slug: v.toLowerCase() }))} mono help={draft.isSystem ? "System type — the URL can't change." : `Documents live at /${draft.slug || "…"}/{slug}. Renaming redirects old URLs.`} />
          <Select label="Structured data (schema.org)" value={draft.schemaType} onChange={(v) => setDraft((d) => ({ ...d, schemaType: v }))} options={SCHEMA_TYPES.map((s) => ({ value: s, label: s }))} />
          <div className="sm:col-span-2">
            <TextArea label="Description (shown on the section page)" value={draft.description} onChange={(v) => setDraft((d) => ({ ...d, description: v }))} rows={2} maxLength={500} />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Template</h2>
          <p className="text-xs text-subtle">How documents of this type are presented. Choose from the allowlisted designs.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Template">
            {TEMPLATES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={draft.template === t}
                onClick={() => setDraft((d) => ({ ...d, template: t }))}
                className={cn("rounded-md border p-3 text-left", draft.template === t ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong")}
              >
                <span className="font-medium">{TEMPLATE_INFO[t].label}</span>
                <span className="mt-0.5 block text-xs text-muted">{TEMPLATE_INFO[t].description}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Custom fields</h2>
              <p className="text-xs text-subtle">Properties every document of this type can have. Removing a field keeps stored values.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft((d) => ({ ...d, fields: [...d.fields, newField(d.fields.length)] }))}>
              <Plus size={13} aria-hidden="true" /> Add field
            </button>
          </div>
          <ol className="mt-4 space-y-3">
            {draft.fields.map((field, i) => {
              const compatibleRoles = (Object.keys(FIELD_ROLES) as FieldRole[]).filter((r) => roleAcceptsType(r, field.type));
              return (
                <li key={field.id ?? `new-${i}`} className="rounded-md border border-line bg-surface p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem]">
                    <TextInput
                      label="Label"
                      value={field.label}
                      onChange={(v) => setField(i, { label: v, key: field.id ? field.key : camelKey(v) })}
                      placeholder="e.g. Purchase URL"
                    />
                    <TextInput label="Key" value={field.key} onChange={(v) => setField(i, { key: v })} mono help={field.id ? "Renaming migrates stored values." : undefined} />
                    <Select label="Type" value={field.type} onChange={(v) => setField(i, { type: v as FieldType, role: field.role && roleAcceptsType(field.role, v as FieldType) ? field.role : null, options: {} })} options={FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t] }))} />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Select
                      label="Role (what templates & SEO use it for)"
                      value={field.role ?? ""}
                      onChange={(v) => setField(i, { role: (v || null) as FieldRole | null })}
                      options={[{ value: "", label: "None" }, ...compatibleRoles.map((r) => ({ value: r, label: FIELD_ROLES[r].label }))]}
                    />
                    <TextInput label="Help text" value={field.helpText} onChange={(v) => setField(i, { helpText: v })} />
                  </div>
                  {(field.type === "select" || field.type === "multi_select" || field.type === "interview_guide") && (
                    <div className="mt-3">
                      <TextArea
                        label={field.type === "interview_guide" ? "Question categories (one per line, in page order). Renaming one leaves its questions to re-categorise." : "Options (one per line)"}
                        value={(field.options.choices ?? []).map((c) => c.label).join("\n")}
                        onChange={(v) => {
                          // Keep stored values stable for options whose label didn't change.
                          const previous = new Map((field.options.choices ?? []).map((c) => [c.label, c.value]));
                          setField(i, {
                            options: {
                              ...field.options,
                              choices: v
                                .split("\n")
                                .map((l) => l.trim())
                                .filter(Boolean)
                                .map((label) => ({ value: previous.get(label) ?? slugify(label, label.toLowerCase()), label })),
                            },
                          });
                        }}
                        rows={3}
                      />
                      {field.type === "multi_select" && <Toggle label="Allow custom values" checked={field.options.allowCustom === true} onChange={(v) => setField(i, { options: { ...field.options, allowCustom: v } })} />}
                    </div>
                  )}
                  {field.type === "number" && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <TextInput label="Minimum" type="number" value={field.options.min?.toString() ?? ""} onChange={(v) => setField(i, { options: { ...field.options, min: v === "" ? undefined : Number(v) } })} />
                      <TextInput label="Maximum" type="number" value={field.options.max?.toString() ?? ""} onChange={(v) => setField(i, { options: { ...field.options, max: v === "" ? undefined : Number(v) } })} />
                    </div>
                  )}
                  {field.type === "relation" && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Select label="Relationship kind" value={field.options.relationKind ?? "related"} onChange={(v) => setField(i, { options: { ...field.options, relationKind: v as keyof typeof RELATION_KINDS } })} options={Object.entries(RELATION_KINDS).map(([k, v]) => ({ value: k, label: v.label }))} />
                      <div className="space-y-2 pt-5">
                        <Toggle label="Allow multiple" checked={field.options.multiple === true} onChange={(v) => setField(i, { options: { ...field.options, multiple: v } })} />
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-xs font-medium text-muted">Limit to types (optional)</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {allTypes.map((t) => {
                            const on = (field.options.targetTypeIds ?? []).includes(t.id);
                            return (
                              <button
                                key={t.id}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setField(i, { options: { ...field.options, targetTypeIds: on ? (field.options.targetTypeIds ?? []).filter((x) => x !== t.id) : [...(field.options.targetTypeIds ?? []), t.id] } })}
                                className={cn("chip text-xs", on && "border-accent text-accent")}
                              >
                                {t.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-line pt-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={field.required} onChange={(e) => setField(i, { required: e.target.checked })} className="accent-[var(--accent)]" /> Required to publish
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={field.showInFacts} onChange={(e) => setField(i, { showInFacts: e.target.checked })} className="accent-[var(--accent)]" /> Show in facts panel
                    </label>
                    <span className="flex-1" />
                    <button type="button" disabled={i === 0} onClick={() => setDraft((d) => ({ ...d, fields: swap(d.fields, i, i - 1) }))} aria-label="Move field up" className="p-1 text-subtle disabled:opacity-30">
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button type="button" disabled={i === draft.fields.length - 1} onClick={() => setDraft((d) => ({ ...d, fields: swap(d.fields, i, i + 1) }))} aria-label="Move field down" className="p-1 text-subtle disabled:opacity-30">
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setDraft((d) => ({ ...d, fields: d.fields.filter((_, j) => j !== i) }))} aria-label="Remove field" className="p-1 text-subtle hover:text-danger">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <div>
          <p className="text-xs font-medium text-muted">Icon</p>
          <div className="mt-2 grid grid-cols-8 gap-1" role="radiogroup" aria-label="Icon">
            {ICONS.map((icon) => (
              <button key={icon} type="button" role="radio" aria-checked={draft.icon === icon} aria-label={icon} onClick={() => setDraft((d) => ({ ...d, icon }))} className={cn("flex aspect-square items-center justify-center rounded-xs border", draft.icon === icon ? "border-accent text-accent" : "border-line text-muted")}>
                <ContentIcon name={icon} size={16} />
              </button>
            ))}
          </div>
        </div>
        <Toggle label="Indexable by search engines" checked={draft.indexable} onChange={(v) => setDraft((d) => ({ ...d, indexable: v }))} help="Turn off for thin formats (quick notes)." />
        <Toggle label="Include in RSS" checked={draft.inFeeds} onChange={(v) => setDraft((d) => ({ ...d, inFeeds: v }))} />
        <Toggle label="Show in “New” menu" checked={draft.showInQuickCreate} onChange={(v) => setDraft((d) => ({ ...d, showInQuickCreate: v }))} />
        {errors && (
          <p role="alert" className="whitespace-pre-line rounded-sm border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            {errors}
          </p>
        )}
        <button type="button" className="btn btn-primary w-full" onClick={() => void save()} disabled={saving || !draft.name.trim() || !draft.slug}>
          {saving ? "Saving…" : isNew ? "Create content type" : "Save changes"}
        </button>
        {!isNew && !draft.isSystem && (
          <button type="button" className="btn w-full border border-danger/40 text-danger hover:bg-danger/10" onClick={() => setConfirmDelete(true)}>
            Delete type
          </button>
        )}
        {!isNew && <p className="text-xs text-subtle">{draft.documentCount} document(s) use this type.</p>}
      </aside>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        destructive
        title={`Delete ${draft.name}?`}
        body={<p>Only possible when no documents use it. Convert or delete those first — or archive the type instead.</p>}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api(`/api/admin/content-types/${draft.id}`, { method: "DELETE" });
            toast.success("Deleted.");
            router.push("/admin/types");
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setConfirmDelete(false);
          }
        }}
      />
    </div>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}
