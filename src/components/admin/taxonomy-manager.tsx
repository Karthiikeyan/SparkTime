"use client";

import { ArrowDown, ArrowUp, Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACCENTS, TAXONOMY_ROBOTS } from "@/lib/content/model";
import { slugify } from "@/lib/slug";
import { api, errorMessage } from "./api";
import { Badge, Select, TextArea, TextInput, Toggle } from "./fields";
import { ConfirmDialog, Modal } from "./modal";
import { useToast } from "./toast";

export type CategoryItem = {
  id: string;
  name: string;
  slug: string;
  description: string;
  introText: string;
  parentId: string | null;
  accent: string | null;
  featured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  robotsIndex: string;
  archived: boolean;
};
export type TagItem = { id: string; name: string; slug: string; description: string; robotsIndex: string };

const emptyCategory: CategoryItem = { id: "", name: "", slug: "", description: "", introText: "", parentId: null, accent: null, featured: false, seoTitle: null, seoDescription: null, robotsIndex: "auto", archived: false };

function introDoc(text: string) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.length ? { type: "doc", content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) } : null;
}

export function TaxonomyManager({ categories, tags, categoryUsage, tagUsage }: { categories: CategoryItem[]; tags: TagItem[]; categoryUsage: Record<string, number>; tagUsage: Record<string, number> }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<CategoryItem | null>(null);
  const [editingTag, setEditingTag] = useState<TagItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "category" | "tag"; id: string; name: string } | null>(null);
  const [merge, setMerge] = useState<{ from: string; into: string }>({ from: "", into: "" });
  const [topicMerge, setTopicMerge] = useState<{ from: string; into: string }>({ from: "", into: "" });
  const [confirmMerge, setConfirmMerge] = useState<"tag" | "category" | null>(null);

  const roots = categories.filter((c) => !c.parentId);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);
  const ordered = roots.flatMap((r) => [r, ...childrenOf(r.id)]);

  const call = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast.success(success);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };

  const move = (id: string, dir: -1 | 1) => {
    const siblings = categories.filter((c) => c.parentId === categories.find((x) => x.id === id)?.parentId);
    const idx = siblings.findIndex((c) => c.id === id);
    const target = idx + dir;
    if (target < 0 || target >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[idx], reordered[target]] = [reordered[target]!, reordered[idx]!];
    const order = categories.map((c) => c.id).filter((cid) => !reordered.some((r) => r.id === cid));
    void call(() => api("/api/admin/categories", { method: "PUT", body: { order: [...reordered.map((r) => r.id), ...order] } }), "Order saved.");
  };

  return (
    <div className="grid gap-10 px-6 py-8 lg:grid-cols-2 lg:px-10">
      <section aria-labelledby="cats">
        <div className="flex items-center justify-between">
          <h2 id="cats" className="font-semibold">
            Categories
          </h2>
          <button type="button" className="btn btn-accent btn-sm" onClick={() => setEditing({ ...emptyCategory })}>
            <Plus size={13} aria-hidden="true" /> New category
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">Topic hubs at /{"{slug}"}. Up to three levels; sub-topics roll up into their parent’s page.</p>
        <ul className="mt-4 divide-y divide-line rounded-md border border-line bg-surface">
          {ordered.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2" style={{ paddingLeft: c.parentId ? 28 : 12 }}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.name}</span> <span className="font-mono text-xs text-subtle">/{c.slug}</span>
              </span>
              {c.archived && <Badge>archived</Badge>}
              {c.featured && <Badge tone="accent">featured</Badge>}
              <span className="w-8 text-right font-mono text-xs text-subtle">{categoryUsage[c.id] ?? 0}</span>
              <button type="button" onClick={() => move(c.id, -1)} aria-label={`Move ${c.name} up`} className="p-1 text-subtle hover:text-ink">
                <ArrowUp size={13} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => move(c.id, 1)} aria-label={`Move ${c.name} down`} className="p-1 text-subtle hover:text-ink">
                <ArrowDown size={13} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`} className="p-1 text-subtle hover:text-ink">
                <Pencil size={13} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => void call(() => api(`/api/admin/categories/${c.id}`, { method: "PATCH", body: { archived: !c.archived } }), c.archived ? "Restored." : "Archived.")} aria-label={`${c.archived ? "Restore" : "Archive"} ${c.name}`} className="p-1 text-subtle hover:text-ink">
                <Archive size={13} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setConfirmDelete({ kind: "category", id: c.id, name: c.name })} aria-label={`Delete ${c.name}`} className="p-1 text-subtle hover:text-danger">
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {categories.length > 1 && (
          <div className="mt-4 rounded-md border border-line p-3">
            <p className="text-sm font-medium">Merge topics</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <select value={topicMerge.from} onChange={(e) => setTopicMerge({ ...topicMerge, from: e.target.value })} className="rounded-sm border border-line bg-surface px-2 py-1.5" aria-label="Merge topic">
                <option value="">Merge…</option>
                {ordered.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? "— " : ""}
                    {c.name} ({categoryUsage[c.id] ?? 0})
                  </option>
                ))}
              </select>
              into
              <select value={topicMerge.into} onChange={(e) => setTopicMerge({ ...topicMerge, into: e.target.value })} className="rounded-sm border border-line bg-surface px-2 py-1.5" aria-label="Merge topic into">
                <option value="">…</option>
                {ordered.filter((c) => c.id !== topicMerge.from).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? "— " : ""}
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-primary btn-sm" disabled={!topicMerge.from || !topicMerge.into} onClick={() => setConfirmMerge("category")}>
                Merge…
              </button>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="tags">
        <div className="flex items-center justify-between">
          <h2 id="tags" className="font-semibold">
            Tags
          </h2>
          <button type="button" className="btn btn-accent btn-sm" onClick={() => setEditingTag({ id: "", name: "", slug: "", description: "", robotsIndex: "auto" })}>
            <Plus size={13} aria-hidden="true" /> New tag
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">Tag pages are indexed automatically only once they have enough published pieces (Settings → SEO).</p>
        <ul className="mt-4 max-h-[32rem] divide-y divide-line overflow-y-auto rounded-md border border-line bg-surface">
          {tags.length === 0 && <li className="p-6 text-center text-sm text-muted">No tags yet — add them while writing.</li>}
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                #{t.name} <span className="font-mono text-xs text-subtle">/tag/{t.slug}</span>
              </span>
              {t.robotsIndex !== "auto" && <Badge>{t.robotsIndex}</Badge>}
              <span className="w-8 text-right font-mono text-xs text-subtle">{tagUsage[t.id] ?? 0}</span>
              <button type="button" onClick={() => setEditingTag(t)} aria-label={`Edit ${t.name}`} className="p-1 text-subtle hover:text-ink">
                <Pencil size={13} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setConfirmDelete({ kind: "tag", id: t.id, name: t.name })} aria-label={`Delete ${t.name}`} className="p-1 text-subtle hover:text-danger">
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {tags.length > 1 && (
          <div className="mt-4 rounded-md border border-line p-3">
            <p className="text-sm font-medium">Merge tags</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <select value={merge.from} onChange={(e) => setMerge({ ...merge, from: e.target.value })} className="rounded-sm border border-line bg-surface px-2 py-1.5" aria-label="Merge from">
                <option value="">Merge…</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.name}
                  </option>
                ))}
              </select>
              into
              <select value={merge.into} onChange={(e) => setMerge({ ...merge, into: e.target.value })} className="rounded-sm border border-line bg-surface px-2 py-1.5" aria-label="Merge into">
                <option value="">…</option>
                {tags.filter((t) => t.id !== merge.from).map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-primary btn-sm" disabled={!merge.from || !merge.into} onClick={() => setConfirmMerge("tag")}>
                Merge…
              </button>
            </div>
          </div>
        )}
      </section>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? `Edit ${editing.name}` : "New category"} size="lg">
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const body = {
                name: editing.name,
                slug: editing.slug || slugify(editing.name),
                description: editing.description,
                intro: introDoc(editing.introText),
                parentId: editing.parentId,
                accent: editing.accent,
                featured: editing.featured,
                seoTitle: editing.seoTitle,
                seoDescription: editing.seoDescription,
                robotsIndex: editing.robotsIndex,
              };
              const ok = await call(() => (editing.id ? api(`/api/admin/categories/${editing.id}`, { method: "PATCH", body }) : api("/api/admin/categories", { method: "POST", body })), "Saved.");
              if (ok) setEditing(null);
            }}
          >
            <TextInput label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v, slug: editing.id ? editing.slug : slugify(v) })} />
            <TextInput label="URL slug" value={editing.slug} onChange={(v) => setEditing({ ...editing, slug: v.toLowerCase() })} mono help={editing.id ? "Changing it redirects the old URL." : undefined} />
            <Select
              label="Parent"
              value={editing.parentId ?? ""}
              onChange={(v) => setEditing({ ...editing, parentId: v || null })}
              options={[{ value: "", label: "None (top level)" }, ...categories.filter((c) => c.id !== editing.id).map((c) => ({ value: c.id, label: c.name }))]}
            />
            <Select label="Accent" value={editing.accent ?? ""} onChange={(v) => setEditing({ ...editing, accent: v || null })} options={[{ value: "", label: "Default" }, ...ACCENTS.map((a) => ({ value: a, label: a }))]} />
            <div className="sm:col-span-2">
              <TextArea label="Short description (meta + cards)" value={editing.description} onChange={(v) => setEditing({ ...editing, description: v })} rows={2} maxLength={320} />
            </div>
            <div className="sm:col-span-2">
              <TextArea label="Introduction (shown on the topic page)" value={editing.introText} onChange={(v) => setEditing({ ...editing, introText: v })} rows={5} help="Plain paragraphs separated by a blank line." />
            </div>
            <TextInput label="SEO title" value={editing.seoTitle ?? ""} onChange={(v) => setEditing({ ...editing, seoTitle: v || null })} />
            <Select label="Search engines" value={editing.robotsIndex} onChange={(v) => setEditing({ ...editing, robotsIndex: v })} options={TAXONOMY_ROBOTS.map((r) => ({ value: r, label: r === "auto" ? "Automatic (index when it has content)" : r === "index" ? "Index" : "No-index" }))} />
            <div className="sm:col-span-2">
              <TextArea label="SEO description" value={editing.seoDescription ?? ""} onChange={(v) => setEditing({ ...editing, seoDescription: v || null })} rows={2} maxLength={320} />
            </div>
            <div className="sm:col-span-2">
              <Toggle label="Featured topic" checked={editing.featured} onChange={(v) => setEditing({ ...editing, featured: v })} help="Listed first on the home page and the Library." />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!editing.name.trim()}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editingTag && (
        <Modal open onClose={() => setEditingTag(null)} title={editingTag.id ? `Edit #${editingTag.name}` : "New tag"}>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const body = { name: editingTag.name, slug: editingTag.slug || slugify(editingTag.name), description: editingTag.description, robotsIndex: editingTag.robotsIndex };
              const ok = await call(() => (editingTag.id ? api(`/api/admin/tags/${editingTag.id}`, { method: "PATCH", body }) : api("/api/admin/tags", { method: "POST", body })), "Saved.");
              if (ok) setEditingTag(null);
            }}
          >
            <TextInput label="Name" value={editingTag.name} onChange={(v) => setEditingTag({ ...editingTag, name: v, slug: editingTag.id ? editingTag.slug : slugify(v) })} />
            <TextInput label="URL slug" value={editingTag.slug} onChange={(v) => setEditingTag({ ...editingTag, slug: v.toLowerCase() })} mono />
            <TextArea label="Description (makes the tag page genuinely useful)" value={editingTag.description} onChange={(v) => setEditingTag({ ...editingTag, description: v })} rows={3} />
            <Select label="Search engines" value={editingTag.robotsIndex} onChange={(v) => setEditingTag({ ...editingTag, robotsIndex: v })} options={TAXONOMY_ROBOTS.map((r) => ({ value: r, label: r === "auto" ? "Automatic (threshold)" : r === "index" ? "Index" : "No-index" }))} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setEditingTag(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!editingTag.name.trim()}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={confirmMerge !== null}
        onClose={() => setConfirmMerge(null)}
        title={
          confirmMerge === "category"
            ? `Merge “${categories.find((c) => c.id === topicMerge.from)?.name}” into “${categories.find((c) => c.id === topicMerge.into)?.name}”?`
            : `Merge #${tags.find((t) => t.id === merge.from)?.name} into #${tags.find((t) => t.id === merge.into)?.name}?`
        }
        body={
          confirmMerge === "category" ? (
            <p>
              {categoryUsage[topicMerge.from] ?? 0} document(s) move to “{categories.find((c) => c.id === topicMerge.into)?.name}”
              {categories.some((c) => c.parentId === topicMerge.from) ? `, its ${categories.filter((c) => c.parentId === topicMerge.from).length} sub-topic(s) move under it` : ""}, menu links follow, and /{categories.find((c) => c.id === topicMerge.from)?.slug} redirects there. The merged topic is then removed — this can’t be undone.
            </p>
          ) : (
            <p>
              {tagUsage[merge.from] ?? 0} document(s) are retagged #{tags.find((t) => t.id === merge.into)?.name}, the old tag page redirects, and #{tags.find((t) => t.id === merge.from)?.name} is removed — this can’t be undone.
            </p>
          )
        }
        confirmLabel="Merge"
        onConfirm={async () => {
          const ok =
            confirmMerge === "category"
              ? await call(() => api("/api/admin/categories", { method: "POST", body: { mergeFrom: topicMerge.from, mergeInto: topicMerge.into } }), "Merged — the old topic URL now redirects.")
              : await call(() => api("/api/admin/tags", { method: "POST", body: { mergeFrom: merge.from, mergeInto: merge.into } }), "Merged — the old tag URL now redirects.");
          if (ok) {
            if (confirmMerge === "category") setTopicMerge({ from: "", into: "" });
            else setMerge({ from: "", into: "" });
          }
          setConfirmMerge(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        destructive
        title={`Delete ${confirmDelete?.kind === "tag" ? "#" : ""}${confirmDelete?.name}?`}
        body={
          <p>
            {confirmDelete ? `${(confirmDelete.kind === "tag" ? tagUsage : categoryUsage)[confirmDelete.id] ?? 0} document(s) keep their content but lose this ${confirmDelete.kind === "tag" ? "tag" : "topic"}. ` : ""}
            Its public page will 404. Archiving (topics) or merging keeps URLs working.
          </p>
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmDelete) return;
          await call(() => api(`/api/admin/${confirmDelete.kind === "tag" ? "tags" : "categories"}/${confirmDelete.id}`, { method: "DELETE" }), "Deleted.");
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
