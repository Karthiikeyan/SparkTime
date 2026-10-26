"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { RECOMMENDED_FOOTER, RECOMMENDED_PRIMARY, type PresetGroup, type PresetLink } from "@/lib/navigation-presets";
import { api, errorMessage } from "./api";
import { DocLookup } from "./document-panels";
import { InlineSwitch } from "./fields";
import { useToast } from "./toast";

export type NavDraft = { key: string; label: string; linkType: "internal" | "external" | "content_type" | "category" | "document" | "group"; href: string; refId: string; refLabel: string; visible: boolean; children: NavDraft[] };
type Option = { id: string; name: string };

const blank = (): NavDraft => ({ key: Math.random().toString(36).slice(2), label: "", linkType: "internal", href: "/", refId: "", refLabel: "", visible: true, children: [] });

function ItemEditor({ item, onChange, onRemove, onMove, types, categories, depth }: { item: NavDraft; onChange: (i: NavDraft) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; types: Option[]; categories: Option[]; depth: number }) {
  return (
    <div className="rounded-sm border border-line bg-surface p-3" style={{ marginLeft: depth * 24 }}>
      <div className="grid gap-2 sm:grid-cols-[9rem_10rem_1fr_auto]">
        <input value={item.label} onChange={(e) => onChange({ ...item, label: e.target.value })} placeholder="Label" className="rounded-xs border border-line bg-bg px-2 py-1.5 text-sm" aria-label="Label" />
        <select value={item.linkType} onChange={(e) => onChange({ ...item, linkType: e.target.value as NavDraft["linkType"], refId: "", refLabel: "" })} className="rounded-xs border border-line bg-bg px-2 py-1.5 text-sm" aria-label="Links to">
          <option value="internal">Site path</option>
          <option value="external">External URL</option>
          <option value="content_type">Content type</option>
          <option value="category">Category</option>
          <option value="document">Document</option>
          {depth === 0 && <option value="group">Group</option>}
        </select>
        <div>
          {(item.linkType === "internal" || item.linkType === "external") && (
            <input value={item.href} onChange={(e) => onChange({ ...item, href: e.target.value })} placeholder={item.linkType === "internal" ? "/library" : "https://"} className="w-full rounded-xs border border-line bg-bg px-2 py-1.5 font-mono text-xs" aria-label="URL" />
          )}
          {item.linkType === "content_type" && (
            <select value={item.refId} onChange={(e) => onChange({ ...item, refId: e.target.value })} className="w-full rounded-xs border border-line bg-bg px-2 py-1.5 text-sm" aria-label="Content type">
              <option value="">Choose…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {item.linkType === "category" && (
            <select value={item.refId} onChange={(e) => onChange({ ...item, refId: e.target.value })} className="w-full rounded-xs border border-line bg-bg px-2 py-1.5 text-sm" aria-label="Category">
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {item.linkType === "document" && (item.refId ? <p className="truncate py-1.5 text-sm">{item.refLabel || "Selected document"} <button type="button" className="text-xs text-muted underline" onClick={() => onChange({ ...item, refId: "", refLabel: "" })}>change</button></p> : <DocLookup onPick={(d) => onChange({ ...item, refId: d.id, refLabel: d.title })} />)}
          {item.linkType === "group" && <p className="py-1.5 text-xs text-subtle">A heading with links underneath — a dropdown in the menu, a column in the footer.</p>}
        </div>
        <div className="flex items-center gap-1">
          <InlineSwitch label="Visible" checked={item.visible} onChange={(v) => onChange({ ...item, visible: v })} className="mr-1" />
          <button type="button" onClick={() => onMove(-1)} aria-label="Move up" className="p-1 text-subtle">
            <ArrowUp size={13} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => onMove(1)} aria-label="Move down" className="p-1 text-subtle">
            <ArrowDown size={13} aria-hidden="true" />
          </button>
          <button type="button" onClick={onRemove} aria-label="Remove" className="p-1 text-subtle hover:text-danger">
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ListEditor({ items, setItems, types, categories, depth = 0 }: { items: NavDraft[]; setItems: (i: NavDraft[]) => void; types: Option[]; categories: Option[]; depth?: number }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={item.key} className="space-y-2">
          <ItemEditor
            item={item}
            depth={depth}
            types={types}
            categories={categories}
            onChange={(next) => setItems(items.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setItems(items.filter((_, j) => j !== i))}
            onMove={(d) => {
              const t = i + d;
              if (t < 0 || t >= items.length) return;
              const next = [...items];
              [next[i], next[t]] = [next[t]!, next[i]!];
              setItems(next);
            }}
          />
          {item.linkType === "group" && (
            <div className="space-y-2">
              <ListEditor items={item.children} setItems={(children) => setItems(items.map((x, j) => (j === i ? { ...x, children } : x)))} types={types} categories={categories} depth={depth + 1} />
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: (depth + 1) * 24 }} onClick={() => setItems(items.map((x, j) => (j === i ? { ...x, children: [...x.children, blank()] } : x)))}>
                <Plus size={12} aria-hidden="true" /> Link in “{item.label || "group"}”
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const presetLink = (l: PresetLink): NavDraft => ({ ...blank(), label: l.label, linkType: "internal", href: l.href });
const presetGroup = (g: PresetGroup): NavDraft => ({ ...blank(), label: g.label, linkType: "group", href: "", children: g.children.map(presetLink) });

/** Fills the draft with the recommended menu; nothing is saved until Save. */
function RecommendedButton({ onUse }: { onUse: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        if (confirm("Replace this menu with the recommended one? Nothing is saved until you press Save.")) onUse();
      }}
    >
      Use recommended menu
    </button>
  );
}

const toPayload = (items: NavDraft[]): unknown[] =>
  items.map((i) => ({
    label: i.label,
    linkType: i.linkType,
    href: i.linkType === "internal" || i.linkType === "external" ? i.href : null,
    refId: ["content_type", "category", "document"].includes(i.linkType) ? i.refId : null,
    visible: i.visible,
    children: toPayload(i.children),
  }));

function SaveButton({ dirty, busy, onClick }: { dirty: boolean; busy: boolean; onClick: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {dirty && !busy && (
        <span className="hidden text-xs text-accent sm:inline" role="status">
          Unsaved changes
        </span>
      )}
      <button type="button" className={cn("btn btn-md", dirty ? "btn-accent" : "btn-ghost")} onClick={onClick} disabled={busy || !dirty}>
        {busy ? "Saving…" : dirty ? "Save" : "Saved"}
      </button>
    </div>
  );
}

export function NavigationEditor({ primary, footer, types, categories }: { primary: NavDraft[]; footer: NavDraft[]; types: Option[]; categories: Option[] }) {
  const router = useRouter();
  const toast = useToast();
  const [p, setP] = useState(primary);
  const [f, setF] = useState(footer);
  const [busy, setBusy] = useState<"primary" | "footer" | null>(null);
  // Compare what would be saved (keys are client-only and excluded).
  const [saved, setSaved] = useState(() => ({ primary: JSON.stringify(toPayload(primary)), footer: JSON.stringify(toPayload(footer)) }));
  const dirty = { primary: JSON.stringify(toPayload(p)) !== saved.primary, footer: JSON.stringify(toPayload(f)) !== saved.footer };
  const anyDirty = dirty.primary || dirty.footer;

  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const save = async (location: "primary" | "footer", items: NavDraft[]) => {
    const payload = toPayload(items);
    setBusy(location);
    try {
      await api(`/api/admin/navigation/${location}`, { method: "PUT", body: { items: payload } });
      setSaved((s) => ({ ...s, [location]: JSON.stringify(payload) }));
      toast.success("Menu saved — the public site is updated.");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="max-w-4xl space-y-10 px-6 py-8 lg:px-10">
      <section>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Primary menu</h2>
            <p className="text-sm text-muted">
              Up to seven visible items. The recommended menu is four places a reader can name without knowing the CMS — Library (/library), Topics (/topics), Projects (/work) and About — and formats stay invisible. A group opens as a dropdown if you want one. Links hide themselves until there is something behind them: a section with published pieces, a published page, a type or topic with content.
            </p>
          </div>
          <SaveButton dirty={dirty.primary} busy={busy === "primary"} onClick={() => void save("primary", p)} />
        </div>
        <div className="mt-4">
          <ListEditor items={p} setItems={setP} types={types} categories={categories} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setP([...p, blank()])}>
              <Plus size={13} aria-hidden="true" /> Add item
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setP([...p, { ...blank(), linkType: "group", label: "New group" }])}>
              <Plus size={13} aria-hidden="true" /> Add group
            </button>
            <RecommendedButton onUse={() => setP(RECOMMENDED_PRIMARY.map(presetLink))} />
          </div>
        </div>
      </section>
      <section>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Footer</h2>
            <p className="text-sm text-muted">Groups become columns. Links to features switched off in Settings → Features (graph, search, RSS) are hidden automatically.</p>
          </div>
          <SaveButton dirty={dirty.footer} busy={busy === "footer"} onClick={() => void save("footer", f)} />
        </div>
        <div className="mt-4">
          <ListEditor items={f} setItems={setF} types={types} categories={categories} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF([...f, { ...blank(), linkType: "group", label: "New group" }])}>
              <Plus size={13} aria-hidden="true" /> Add group
            </button>
            <RecommendedButton onUse={() => setF(RECOMMENDED_FOOTER.map(presetGroup))} />
          </div>
        </div>
      </section>
    </div>
  );
}
