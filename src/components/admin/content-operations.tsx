"use client";

import { Archive, ArchiveRestore, ChevronDown, FilePen, Loader2, Rocket, Trash2, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useDismiss } from "@/components/ui/use-dismiss";
import {
  BULK_ACTION_TEXT,
  BULK_CHUNK_SIZE,
  MAX_BULK_SELECTION,
  PERMANENT_DELETE_TOKEN,
  UNDO_WINDOW_MINUTES,
  type BulkActionName,
} from "@/lib/content/bulk-actions";
import { formatDate, relativeTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { BulkItemResult, BulkRunResult, SelectionPreview, UndoResult } from "@/server/services/content-ops";
import { api, errorMessage } from "./api";
import { publicationOutcome } from "@/lib/content/publication";
import { Badge, statusTone } from "./badge";
import { Modal } from "./modal";
import { inputBase } from "./styles";
import { useToast } from "./toast";

/**
 * The Documents and Trash lists' content operations:
 *
 *   find → filter → select → choose an action → review a server-side preview
 *   → confirm → run in bounded chunks with progress → see per-document
 *   results → retry failures → undo (when the action is reversible) → audit.
 *
 * The browser holds only ids and the current filter. "Select all matching"
 * is resolved on the server from the filter, so it covers every page without
 * loading documents into the page.
 */

export type OpsRow = {
  id: string;
  title: string;
  path: string;
  typeName: string;
  status: string;
  visibility: string;
  robotsIndex: string;
  typeIndexable: boolean;
  featured: boolean;
  hasStagedChanges: boolean;
  publishedAt: string | null;
  updatedAt: string;
  trashedAt: string | null;
  trashedBy: string | null;
};

export type OpsOptions = {
  topics: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  collections: Array<{ id: string; title: string; typeName: string }>;
};

type Action =
  | { action: "draft" | "publish" | "archive" | "trash" | "restore" | "duplicate" }
  | { action: "delete"; confirm: typeof PERMANENT_DELETE_TOKEN }
  | { action: "featured"; value: boolean }
  | { action: "visibility"; value: "private" | "unlisted" | "public" }
  | { action: "indexing"; value: "default" | "index" | "noindex" }
  | { action: "addTopic" | "removeTopic"; categoryId: string }
  | { action: "addTag" | "removeTag"; tagId: string }
  | { action: "addToCollection" | "removeFromCollection"; collectionId: string };

type ParamKind = "topic" | "tag" | "collection" | "visibility" | "indexing";
type Selection = { all: false; ids: Set<string> } | { all: true; except: Set<string> };
type Flow =
  | { phase: "idle" }
  | { phase: "params"; kind: ParamKind; action: BulkActionName }
  | { phase: "confirm"; action: Action; target: string | null; preview: SelectionPreview | null; error: string | null }
  | { phase: "running"; action: Action; target: string | null; done: number; total: number; results: BulkItemResult[]; operationId: string }
  | { phase: "done"; action: Action; target: string | null; total: number; results: BulkItemResult[]; operationId: string; undoable: boolean; stopped: boolean };
type LastOp = { operationId: string; message: string; action: BulkActionName; undo?: UndoResult; undoing?: boolean; error?: string };

const plural = (n: number, one = "document", many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
const NONE: Selection = { all: false, ids: new Set() };

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
}

export function ContentOperations({
  mode,
  rows,
  total,
  filter,
  options,
}: {
  mode: "documents" | "trash";
  rows: OpsRow[];
  total: number;
  /** The list's current URL filter, posted back (and validated server-side) for "select all matching". */
  filter: Record<string, string>;
  options: OpsOptions;
}) {
  const router = useRouter();
  const toast = useToast();
  const [selection, setSelection] = useState<Selection>(NONE);
  const [flow, setFlow] = useState<Flow>({ phase: "idle" });
  const [last, setLast] = useState<LastOp | null>(null);
  const lastClicked = useRef<number | null>(null);
  const stopRequested = useRef(false);
  const headerBox = useRef<HTMLInputElement>(null);

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const isSelected = useCallback((id: string) => (selection.all ? !selection.except.has(id) : selection.ids.has(id)), [selection]);
  const count = selection.all ? Math.max(0, total - selection.except.size) : selection.ids.size;
  const visibleSelected = visibleIds.filter(isSelected).length;
  const allVisible = rows.length > 0 && visibleSelected === rows.length;

  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = visibleSelected > 0 && !allVisible;
  }, [visibleSelected, allVisible]);

  const clear = useCallback(() => {
    setSelection(NONE);
    lastClicked.current = null;
  }, []);

  const toggle = (id: string, index: number, range: boolean) => {
    const ids = range && lastClicked.current !== null ? visibleIds.slice(Math.min(lastClicked.current, index), Math.max(lastClicked.current, index) + 1) : [id];
    const on = !isSelected(id);
    lastClicked.current = index;
    setMany(ids, on);
  };

  const toggleVisible = () => setMany(visibleIds, !allVisible);

  /** Select (`on`) or deselect a set of ids. In "all matching" mode a deselection is an exclusion. */
  const setMany = (ids: string[], on: boolean) => {
    if (selection.all) {
      const except = new Set(selection.except);
      for (const x of ids) {
        if (on) except.delete(x);
        else except.add(x);
      }
      return setSelection({ all: true, except });
    }
    const next = new Set(selection.ids);
    for (const x of ids) {
      if (on) next.add(x);
      else next.delete(x);
    }
    if (next.size > MAX_BULK_SELECTION) return toast.error(`Select at most ${MAX_BULK_SELECTION.toLocaleString("en-IN")} documents at a time.`);
    setSelection({ all: false, ids: next });
  };

  /** The selection as the server expects it: explicit ids, or the filter (minus exclusions). */
  const selectionBody = useCallback(
    (target: string | null) =>
      target
        ? { kind: "ids" as const, ids: [target] }
        : selection.all
          ? { kind: "filter" as const, filter, exclude: [...selection.except] }
          : { kind: "ids" as const, ids: [...selection.ids] },
    [selection, filter],
  );

  // -------------------------------------------------------------------------
  // Flow
  // -------------------------------------------------------------------------

  const open = useCallback(
    async (action: Action, target: string | null = null, override?: ReturnType<typeof selectionBody>) => {
      setFlow({ phase: "confirm", action, target, preview: null, error: null });
      try {
        const preview = await api<SelectionPreview>("/api/admin/documents/bulk/select", { method: "POST", body: { selection: override ?? selectionBody(target) } });
        setFlow((f) => (f.phase === "confirm" && f.action === action ? { ...f, preview } : f));
      } catch (e) {
        setFlow((f) => (f.phase === "confirm" && f.action === action ? { ...f, error: errorMessage(e) } : f));
      }
    },
    [selectionBody],
  );

  const choose = (name: BulkActionName) => {
    if (name === "addTopic" || name === "removeTopic") setFlow({ phase: "params", kind: "topic", action: name });
    else if (name === "addTag" || name === "removeTag") setFlow({ phase: "params", kind: "tag", action: name });
    else if (name === "addToCollection" || name === "removeFromCollection") setFlow({ phase: "params", kind: "collection", action: name });
    else if (name === "visibility") setFlow({ phase: "params", kind: "visibility", action: name });
    else if (name === "indexing") setFlow({ phase: "params", kind: "indexing", action: name });
    else if (name === "delete") void open({ action: "delete", confirm: PERMANENT_DELETE_TOKEN });
    else if (name !== "featured") void open({ action: name });
  };

  const execute = async (action: Action, ids: string[], target: string | null, operationId = crypto.randomUUID(), previous: BulkItemResult[] = []) => {
    stopRequested.current = false;
    const carried = previous.filter((r) => !ids.includes(r.id));
    let results: BulkItemResult[] = [...carried];
    let undoable = false;
    setFlow({ phase: "running", action, target, done: 0, total: ids.length, results, operationId });
    let stopped = false;
    for (let start = 0; start < ids.length; start += BULK_CHUNK_SIZE) {
      if (stopRequested.current) {
        stopped = true;
        break;
      }
      const chunk = ids.slice(start, start + BULK_CHUNK_SIZE);
      try {
        const res = await api<BulkRunResult>("/api/admin/documents/bulk", { method: "POST", body: { operationId, ids: chunk, action } });
        results = [...results, ...res.items];
        undoable = undoable || res.undoable;
      } catch (e) {
        // A whole chunk failed (network, session, validation): report every document in it, keep going.
        const message = errorMessage(e);
        results = [...results, ...chunk.map((id) => ({ id, title: rows.find((r) => r.id === id)?.title || "Document", outcome: "failed" as const, message }))];
      }
      setFlow({ phase: "running", action, target, done: Math.min(start + chunk.length, ids.length), total: ids.length, results, operationId });
    }
    setFlow({ phase: "done", action, target, total: carried.length + ids.length, results, operationId, undoable, stopped });
  };

  const confirm = async () => {
    if (flow.phase !== "confirm" || !flow.preview) return;
    await execute(flow.action, flow.preview.ids, flow.target);
  };

  const finish = () => {
    if (flow.phase !== "done") return setFlow({ phase: "idle" });
    const updated = flow.results.filter((r) => r.outcome === "updated").length;
    const failed = flow.results.filter((r) => r.outcome === "failed").map((r) => r.id);
    // The summary stays on the page; it offers Undo only when the server said the operation is reversible.
    setLast(updated > 0 ? { operationId: flow.undoable ? flow.operationId : "", action: flow.action.action, message: resultHeadline(flow.action, updated, options) } : null);
    // Keep the failures selected so they can be dealt with next; clear everything else.
    if (!flow.target) {
      if (failed.length) setSelection({ all: false, ids: new Set(failed) });
      else clear();
    }
    setFlow({ phase: "idle" });
    router.refresh();
  };

  const undo = async (operationId: string) => {
    setLast((l) => (l ? { ...l, undoing: true, error: undefined } : l));
    try {
      const result = await api<UndoResult>("/api/admin/documents/bulk/undo", { method: "POST", body: { operationId } });
      setLast((l) => (l ? { ...l, undoing: false, undo: result } : l));
      if (flow.phase === "done") setFlow({ phase: "idle" });
      router.refresh();
    } catch (e) {
      setLast((l) => (l ? { ...l, undoing: false, error: errorMessage(e) } : l));
    }
  };

  const exportSelection = async () => {
    try {
      const preview = await api<SelectionPreview>("/api/admin/documents/bulk/select", { method: "POST", body: { selection: selectionBody(null) } });
      if (!preview.ids.length) return toast.error("Nothing to export in this selection.");
      try {
        sessionStorage.setItem("studio:export-selection", JSON.stringify({ ids: preview.ids, at: Date.now() }));
      } catch {
        return toast.error("This browser blocked handing the selection to Export. Allow site storage and try again.");
      }
      router.push("/admin/export?from=selection");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  // Keyboard: Escape clears the selection; Delete opens the Trash (or, in the Trash, delete) confirmation.
  // Both only act with a selection and outside text fields and dialogs. ("/" and Ctrl/⌘K belong to the command palette.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape inside an open menu closes the menu (useDismiss), not the selection.
      const inMenu = e.target instanceof Element && e.target.closest('[role="menu"]');
      if (count === 0 || flow.phase !== "idle" || inMenu || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        clear();
      } else if (e.key === "Delete") {
        e.preventDefault();
        choose(mode === "trash" ? "delete" : "trash");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const action = flow.phase === "confirm" || flow.phase === "running" || flow.phase === "done" ? flow.action : null;

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {count ? `${plural(count)} selected.` : "No documents selected."}
      </p>

      {last && <LastOperation last={last} onUndo={undo} onDismiss={() => setLast(null)} />}

      {count > 0 ? (
        <Toolbar mode={mode} count={count} onAction={choose} onFeatured={(value) => void open({ action: "featured", value })} onExport={() => void exportSelection()} onClear={clear} />
      ) : (
        mode === "trash" &&
        total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3 lg:px-10">
            <p className="text-sm text-muted">Trashed documents are hidden from the site and frozen until restored.</p>
            <button
              type="button"
              className="btn btn-md bg-danger text-white hover:opacity-90"
              onClick={() => {
                setSelection({ all: true, except: new Set() });
                void open({ action: "delete", confirm: PERMANENT_DELETE_TOKEN }, null, { kind: "filter", filter, exclude: [] });
              }}
            >
              <Trash2 size={15} aria-hidden="true" /> Empty Trash…
            </button>
          </div>
        )
      )}

      {count > 0 && allVisible && total > rows.length && (
        <div className="border-b border-line bg-accent-soft/40 px-6 py-2 text-center text-sm lg:px-10" role="status">
          {selection.all ? (
            <>
              All {plural(count, "matching document")} are selected{total > MAX_BULK_SELECTION ? ` (an operation covers the first ${MAX_BULK_SELECTION.toLocaleString("en-IN")})` : ""}.{" "}
              <button type="button" className="font-medium underline" onClick={clear}>
                Clear selection
              </button>
            </>
          ) : (
            <>
              {plural(visibleSelected)} on this page {visibleSelected === 1 ? "is" : "are"} selected.{" "}
              <button type="button" className="font-medium underline" onClick={() => setSelection({ all: true, except: new Set() })}>
                Select all {plural(total, "matching document")}
              </button>
            </>
          )}
        </div>
      )}

      <div className="overflow-x-auto px-6 py-4 lg:px-10">
        {rows.length === 0 ? (
          <p className="py-16 text-center text-muted">{mode === "trash" ? "The Trash is empty." : "No documents match. Try clearing filters, or create one."}</p>
        ) : (
          <table className="w-full min-w-184 text-sm">
            <caption className="sr-only">{mode === "trash" ? "Documents in the Trash" : "Documents"}. Use the checkboxes to select documents for bulk actions; Shift-click selects a range.</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-subtle">
                <th scope="col" className="w-9 py-2">
                  <input ref={headerBox} type="checkbox" className="size-4 align-middle accent-accent" checked={allVisible} onChange={toggleVisible} aria-label="Select all documents on this page" />
                </th>
                <th scope="col" className="py-2 font-medium">
                  Title
                </th>
                <th scope="col" className="py-2 font-medium">
                  Type
                </th>
                {mode === "trash" ? (
                  <>
                    <th scope="col" className="py-2 font-medium">
                      Deleted
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      By
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Published
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Edited
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((d, index) => {
                const checked = isSelected(d.id);
                return (
                  <tr key={d.id} className={cn("border-b border-line/70", checked ? "bg-accent-soft/30" : "hover:bg-surface")} aria-selected={checked}>
                    <td className="py-2.5 align-top">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-accent"
                        checked={checked}
                        onChange={() => undefined}
                        onClick={(e) => toggle(d.id, index, e.shiftKey)}
                        onKeyDown={(e) => {
                          if (e.key === " " && e.shiftKey) {
                            e.preventDefault();
                            toggle(d.id, index, true);
                          }
                        }}
                        aria-label={`Select ${d.title || "Untitled"}`}
                      />
                    </td>
                    <td className="py-2.5 pr-4">
                      {mode === "trash" ? <span className="font-medium">{d.title || "Untitled"}</span> : <Link href={`/admin/documents/${d.id}`} className="font-medium hover:text-accent">{d.title || "Untitled"}</Link>}
                      <span className="block font-mono text-[11px] text-subtle">{d.path}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-muted">{d.typeName}</td>
                    {mode === "trash" ? (
                      <>
                        <td className="py-2.5 pr-4 text-muted">{d.trashedAt ? <time dateTime={d.trashedAt} title={formatDate(d.trashedAt, "medium")}>{relativeTime(d.trashedAt)}</time> : "—"}</td>
                        <td className="py-2.5 pr-4 text-muted">{d.trashedBy ?? "—"}</td>
                        <td className="py-2.5 text-right">
                          <span className="inline-flex gap-1">
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void open({ action: "restore" }, d.id)} aria-label={`Restore ${d.title || "Untitled"}`}>
                              Restore
                            </button>
                            <button type="button" className="btn btn-sm text-danger hover:bg-danger/10" onClick={() => void open({ action: "delete", confirm: PERMANENT_DELETE_TOKEN }, d.id)} aria-label={`Delete ${d.title || "Untitled"} permanently`}>
                              Delete…
                            </button>
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2.5 pr-4">
                          <span className="flex flex-wrap gap-1">
                            <ResultBadges row={d} />
                            {d.hasStagedChanges && <Badge tone="warning">staged</Badge>}
                            {d.featured && <Badge tone="accent">featured</Badge>}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 text-muted">{d.publishedAt ? formatDate(d.publishedAt, "medium") : "—"}</td>
                        <td className="py-2.5 text-right text-muted">{relativeTime(d.updatedAt)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {flow.phase === "params" && <ParamsDialog flow={flow} options={options} onCancel={() => setFlow({ phase: "idle" })} onChoose={(a) => void open(a)} />}

      {action && (
        <OperationDialog
          flow={flow as Extract<Flow, { phase: "confirm" | "running" | "done" }>}
          options={options}
          onCancel={() => setFlow({ phase: "idle" })}
          onConfirm={() => void confirm()}
          onStop={() => (stopRequested.current = true)}
          onRetry={(ids) => flow.phase === "done" && void execute(flow.action, ids, flow.target, flow.operationId, flow.results)}
          onUndo={(id) => {
            if (flow.phase !== "done") return;
            const updated = flow.results.filter((r) => r.outcome === "updated").length;
            setLast({ operationId: id, action: flow.action.action, message: resultHeadline(flow.action, updated, options) });
            setFlow({ phase: "idle" });
            if (!flow.target) clear();
            void undo(id);
          }}
          onClose={finish}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({
  mode,
  count,
  onAction,
  onFeatured,
  onExport,
  onClear,
}: {
  mode: "documents" | "trash";
  count: number;
  onAction: (a: BulkActionName) => void;
  onFeatured: (value: boolean) => void;
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <div role="toolbar" aria-label={`Actions for ${plural(count)} selected`} className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b border-line bg-elevated/95 px-6 py-2.5 backdrop-blur-sm lg:top-0 lg:px-10">
      <p className="mr-2 text-sm font-medium tabular-nums">{plural(count)} selected</p>
      {mode === "trash" ? (
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => onAction("restore")}>
            <ArchiveRestore size={15} aria-hidden="true" /> Restore
          </button>
          <button type="button" className="btn btn-md bg-danger text-white hover:opacity-90" onClick={() => onAction("delete")}>
            <Trash2 size={15} aria-hidden="true" /> Delete permanently…
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => onAction("draft")}>
            <FilePen size={15} aria-hidden="true" /> Draft
          </button>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => onAction("publish")}>
            <Rocket size={15} aria-hidden="true" /> Publish
          </button>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => onAction("archive")}>
            <Archive size={15} aria-hidden="true" /> Archive
          </button>
          <button type="button" className="btn btn-ghost btn-md text-danger" onClick={() => onAction("trash")}>
            <Trash2 size={15} aria-hidden="true" /> Trash
          </button>
          <MoreMenu
            items={[
              { label: "Duplicate as drafts", run: () => onAction("duplicate") },
              { label: "Feature", run: () => onFeatured(true) },
              { label: "Stop featuring", run: () => onFeatured(false) },
              { label: "Change visibility…", run: () => onAction("visibility") },
              { label: "Change search engine indexing…", run: () => onAction("indexing") },
              { label: "Add to topic…", run: () => onAction("addTopic"), divider: true },
              { label: "Remove from topic…", run: () => onAction("removeTopic") },
              { label: "Add tag…", run: () => onAction("addTag") },
              { label: "Remove tag…", run: () => onAction("removeTag") },
              { label: "Add to collection…", run: () => onAction("addToCollection") },
              { label: "Remove from collection…", run: () => onAction("removeFromCollection") },
              { label: "Export…", run: onExport, divider: true },
            ]}
          />
        </>
      )}
      <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink" onClick={onClear}>
        <X size={14} aria-hidden="true" /> Clear <kbd className="hidden font-mono text-[10px] text-subtle sm:inline">Esc</kbd>
      </button>
    </div>
  );
}

/**
 * What the document is, in the Studio's one vocabulary: Draft, Published,
 * Unlisted, Private, Archived — plus "noindex" when it is live but kept out
 * of search engines (the expected case, indexed, needs no badge).
 */
function ResultBadges({ row }: { row: Pick<OpsRow, "status" | "visibility" | "robotsIndex" | "typeIndexable"> }) {
  const outcome = publicationOutcome({ status: row.status, visibility: row.visibility, robotsIndex: row.robotsIndex, typeIndexable: row.typeIndexable });
  const tone = outcome.label === "Published" ? "success" : outcome.label === "Unlisted" ? "info" : outcome.label === "Idea" ? "accent" : outcome.label === "Scheduled" ? "info" : outcome.label === "Draft" ? "warning" : statusTone(row.status);
  return (
    <>
      <Badge tone={tone}>{outcome.label}</Badge>
      {outcome.live && !outcome.indexed && <Badge>noindex</Badge>}
    </>
  );
}

function MoreMenu({ items }: { items: Array<{ label: string; run: () => void; divider?: boolean }> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const menuId = useId();
  useDismiss(ref, open, close, trigger);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? all[0] : all.at(-1))?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };
  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className="btn btn-ghost btn-md" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((o) => !o)}>
        More <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="More bulk actions" className="absolute left-0 top-11 z-40 w-60 rounded-md border border-line bg-elevated p-1.5 text-sm shadow-float">
          {items.map((item) => (
            <div key={item.label}>
              {item.divider && <div className="my-1 h-px bg-line" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-sm px-2.5 py-1.5 text-left hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function ParamsDialog({ flow, options, onCancel, onChoose }: { flow: Extract<Flow, { phase: "params" }>; options: OpsOptions; onCancel: () => void; onChoose: (a: Action) => void }) {
  const [value, setValue] = useState("");
  const id = useId();
  const choices =
    flow.kind === "topic"
      ? options.topics.map((t) => ({ value: t.id, label: t.name }))
      : flow.kind === "tag"
        ? options.tags.map((t) => ({ value: t.id, label: `#${t.name}` }))
        : flow.kind === "collection"
          ? options.collections.map((c) => ({ value: c.id, label: `${c.title} (${c.typeName})` }))
          : flow.kind === "indexing"
            ? [
                { value: "default", label: "Default — follow the format (public pages of indexable formats)" },
                { value: "index", label: "Index — search engines may index it once live" },
                { value: "noindex", label: "Noindex — keep it out of search engines" },
              ]
            : [
                { value: "public", label: "Public — listed and searchable once published" },
                { value: "unlisted", label: "Unlisted — reachable by link, never listed" },
                { value: "private", label: "Private — never shown outside the Studio" },
              ];
  const label = flow.kind === "topic" ? "Topic" : flow.kind === "tag" ? "Tag" : flow.kind === "collection" ? "Collection" : flow.kind === "indexing" ? "Search engines" : "Visibility";
  const submit = () => {
    if (!value) return;
    const a = flow.action;
    if (a === "addTopic" || a === "removeTopic") onChoose({ action: a, categoryId: value });
    else if (a === "addTag" || a === "removeTag") onChoose({ action: a, tagId: value });
    else if (a === "addToCollection" || a === "removeFromCollection") onChoose({ action: a, collectionId: value });
    else if (a === "indexing") onChoose({ action: "indexing", value: value as "default" | "index" | "noindex" });
    else onChoose({ action: "visibility", value: value as "private" | "unlisted" | "public" });
  };
  return (
    <Modal open onClose={onCancel} title={BULK_ACTION_TEXT[flow.action].verb} size="sm">
      <form
        className="space-y-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {choices.length === 0 ? (
          <p className="text-muted">There are no {label.toLowerCase()}s to choose from yet.</p>
        ) : (
          <div>
            <label htmlFor={id} className="font-medium">
              {label}
            </label>
            <select id={id} value={value} onChange={(e) => setValue(e.target.value)} className={`${inputBase} mt-1.5 w-full px-3 py-2`} autoFocus>
              <option value="">Choose…</option>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value}>
            Continue
          </button>
        </div>
      </form>
    </Modal>
  );
}

function targetName(action: Action, options: OpsOptions): string {
  if ("categoryId" in action) return `“${options.topics.find((t) => t.id === action.categoryId)?.name ?? "topic"}”`;
  if ("tagId" in action) return `#${options.tags.find((t) => t.id === action.tagId)?.name ?? "tag"}`;
  if ("collectionId" in action) return `“${options.collections.find((c) => c.id === action.collectionId)?.title ?? "collection"}”`;
  return "";
}

function resultHeadline(action: Action, updated: number, options: OpsOptions): string {
  const n = plural(updated);
  const target = targetName(action, options);
  switch (action.action) {
    case "featured":
      return `${n} ${action.value ? "featured" : "no longer featured"}.`;
    case "visibility":
      return `${n} made ${action.value}.`;
    case "indexing":
      return `${n} set to ${action.value === "default" ? "the default indexing" : action.value}.`;
    case "addTopic":
    case "addToCollection":
      return `${n} added to ${target}.`;
    case "removeTopic":
    case "removeFromCollection":
      return `${n} removed from ${target}.`;
    case "addTag":
      return `${n} tagged ${target}.`;
    case "removeTag":
      return `${target} removed from ${n}.`;
    default:
      return `${n} ${BULK_ACTION_TEXT[action.action].done}.`;
  }
}

/** Confirmation copy that says exactly what will happen, from the server's preview of the selection. */
function confirmCopy(action: Action, p: SelectionPreview, options: OpsOptions): { title: string; lines: string[]; button: string; danger: boolean; typeToConfirm?: string } {
  const n = p.ids.length;
  const docs = plural(n);
  const s = (status: string) => p.byStatus[status] ?? 0;
  const linked = p.linkedFrom ? `${plural(p.linkedFrom, "published document")} elsewhere link${p.linkedFrom === 1 ? "s" : ""} to ${n === 1 ? "it" : "them"}; those links will stop working.` : "";
  const lines: string[] = [];
  switch (action.action) {
    case "draft":
      if (s("published")) lines.push(`${plural(s("published"), "published document")} will be unpublished and disappear from the site.`);
      if (s("archived")) lines.push(`${plural(s("archived"), "archived document")} will no longer be reachable at ${s("archived") === 1 ? "its" : "their"} URL.`);
      if (p.staged) lines.push(`${plural(p.staged)} ${p.staged === 1 ? "has" : "have"} staged edits; they’ll be merged into the draft (and can’t be undone automatically).`);
      if (s("draft")) lines.push(`${plural(s("draft"))} ${s("draft") === 1 ? "is" : "are"} already a draft and won’t change.`);
      return { title: `Move ${docs} to Draft?`, lines, button: "Move to Draft", danger: false };
    case "publish":
      lines.push("Each one is checked like a single publish. Any with a missing title, an unfinished [TODO]-style marker or a missing required field is skipped and listed afterwards.");
      if (s("published")) lines.push(`${plural(s("published"))} ${s("published") === 1 ? "is" : "are"} already published and won’t change; staged edits are not published in bulk.`);
      return { title: `Publish ${docs}?`, lines, button: "Publish", danger: false };
    case "archive":
      lines.push("Archived documents leave listings, search, feeds and the sitemap, but stay readable at their URL.");
      if (s("archived")) lines.push(`${plural(s("archived"))} ${s("archived") === 1 ? "is" : "are"} already archived.`);
      return { title: `Archive ${docs}?`, lines, button: "Archive", danger: false };
    case "trash":
      lines.push(p.live ? `${plural(p.live)} currently on the site will disappear immediately.` : "None of them is currently visible on the site.");
      if (linked) lines.push(linked);
      if (p.inCollections) lines.push(`${plural(p.inCollections, "collection")} include${p.inCollections === 1 ? "s" : ""} ${n === 1 ? "it" : "them"}; ${n === 1 ? "it’s" : "they’re"} hidden there too.`);
      lines.push("Nothing is deleted: restore from the Trash at any time.");
      return { title: `Move ${docs} to Trash?`, lines, button: "Move to Trash", danger: true };
    case "restore":
      lines.push("Restored documents come back as drafts with their topics, tags, links and collection places. Publish them again when ready.");
      return { title: `Restore ${docs}?`, lines, button: "Restore", danger: false };
    case "delete":
      lines.push("This cannot be undone.");
      lines.push("Their topic and tag links, relationships and places in collections are removed too. Media files stay in the library.");
      if (linked) lines.push(linked);
      if (s("trashed") !== n) lines.push(`${plural(n - s("trashed"))} ${n - s("trashed") === 1 ? "isn’t" : "aren’t"} in the Trash and will be skipped.`);
      return { title: `Permanently delete ${docs}?`, lines, button: "Permanently delete", danger: true, typeToConfirm: String(n) };
    case "duplicate":
      lines.push("Each copy is a new draft titled “… (copy)” with its own URL. SEO overrides, canonical URL and featured status are not copied.");
      return { title: `Duplicate ${docs}?`, lines, button: "Duplicate", danger: false };
    case "featured":
      return { title: action.value ? `Feature ${docs}?` : `Stop featuring ${docs}?`, lines: [action.value ? "Featured documents are promoted on the home page and in listings." : "They stay published; they’re just no longer promoted."], button: action.value ? "Feature" : "Stop featuring", danger: false };
    case "visibility":
      if (action.value === "private" && p.live) lines.push(`${plural(p.live)} currently on the site will disappear immediately.`);
      if (action.value === "unlisted") lines.push("Unlisted documents stay reachable by link but leave listings, search and the sitemap.");
      if (action.value === "public") lines.push("Published documents become listed and searchable.");
      return { title: `Make ${docs} ${action.value}?`, lines, button: `Make ${action.value}`, danger: action.value === "private" && p.live > 0 };
    case "indexing":
      lines.push(
        action.value === "index"
          ? "Search engines may index them once they are live (published, public or unlisted), even in formats that aren't indexed by default."
          : action.value === "noindex"
            ? "They stay on the site but are kept out of search engines and the sitemap."
            : "Indexing follows each document's format and visibility again.",
      );
      lines.push("Drafts and private documents are never indexed, whatever this says.");
      return { title: `Change search engine indexing for ${docs}?`, lines, button: "Change indexing", danger: false };
    case "addTopic":
      return { title: `Add ${docs} to ${targetName(action, options)}?`, lines: ["Documents without a topic get this one as their primary topic."], button: "Add to topic", danger: false };
    case "removeTopic":
      return { title: `Remove ${docs} from ${targetName(action, options)}?`, lines: ["Where it was the primary topic, another of the document’s topics becomes primary."], button: "Remove from topic", danger: false };
    case "addTag":
      return { title: `Tag ${docs} ${targetName(action, options)}?`, lines, button: "Add tag", danger: false };
    case "removeTag":
      return { title: `Remove ${targetName(action, options)} from ${docs}?`, lines, button: "Remove tag", danger: false };
    case "addToCollection":
      return { title: `Add ${docs} to ${targetName(action, options)}?`, lines: ["They’re appended after the collection’s current items, in list order."], button: "Add to collection", danger: false };
    case "removeFromCollection":
      return { title: `Remove ${docs} from ${targetName(action, options)}?`, lines, button: "Remove from collection", danger: false };
  }
}

function OperationDialog({
  flow,
  options,
  onCancel,
  onConfirm,
  onStop,
  onRetry,
  onUndo,
  onClose,
}: {
  flow: Extract<Flow, { phase: "confirm" | "running" | "done" }>;
  options: OpsOptions;
  onCancel: () => void;
  onConfirm: () => void;
  onStop: () => void;
  onRetry: (ids: string[]) => void;
  onUndo: (operationId: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const verb = BULK_ACTION_TEXT[flow.action.action].verb;

  if (flow.phase === "confirm") {
    const copy = flow.preview ? confirmCopy(flow.action, flow.preview, options) : null;
    const empty = flow.preview && flow.preview.ids.length === 0;
    const ok = copy && !empty && (!copy.typeToConfirm || typed.trim() === copy.typeToConfirm);
    return (
      <Modal open onClose={onCancel} title={copy?.title ?? `${verb}…`} size="sm">
        <div className="space-y-4 text-sm">
          {flow.error && <p className="text-danger" role="alert">{flow.error}</p>}
          {!flow.preview && !flow.error && (
            <p className="flex items-center gap-2 text-muted" role="status">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Checking the selection…
            </p>
          )}
          {empty && <p className="text-muted">Nothing in this selection exists any more.</p>}
          {copy && !empty && (
            <>
              <ul className="space-y-2 text-muted">
                {copy.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {flow.preview!.truncated && (
                <p className="rounded-sm bg-warning/10 px-3 py-2 text-warning">
                  {plural(flow.preview!.matched)} match; one operation covers the first {MAX_BULK_SELECTION.toLocaleString("en-IN")}. Run it again for the rest.
                </p>
              )}
              {copy.typeToConfirm && (
                <div>
                  <label htmlFor={inputId}>
                    Type <code className="rounded-xs bg-surface-2 px-1 font-mono">{copy.typeToConfirm}</code> to confirm
                  </label>
                  <input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" autoComplete="off" autoFocus className={`${inputBase} mt-1.5 w-full px-3 py-2 font-mono`} />
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" disabled={!ok} className={copy?.danger ? "btn bg-danger text-white hover:opacity-90" : "btn btn-primary"} onClick={onConfirm}>
              {copy?.button ?? verb}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (flow.phase === "running") {
    const pct = flow.total ? Math.round((flow.done / flow.total) * 100) : 0;
    return (
      <Modal open onClose={() => undefined} title={`${verb}: working…`} size="sm">
        <div className="space-y-4 text-sm">
          <div role="progressbar" aria-label={`${verb} progress`} aria-valuemin={0} aria-valuemax={flow.total} aria-valuenow={flow.done} aria-valuetext={`${flow.done} of ${flow.total}`} className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="tabular-nums text-muted" aria-live="polite">
            {flow.done.toLocaleString("en-IN")} / {flow.total.toLocaleString("en-IN")} · {pct}%
          </p>
          <p className="text-xs text-subtle">Runs in batches of {BULK_CHUNK_SIZE}. Keep this tab open; stopping finishes the current batch.</p>
          <div className="flex justify-end">
            <button type="button" className="btn btn-ghost" onClick={onStop}>
              Stop after this batch
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const updated = flow.results.filter((r) => r.outcome === "updated");
  const unchanged = flow.results.filter((r) => r.outcome === "unchanged");
  const failed = flow.results.filter((r) => r.outcome === "failed");
  const notRun = flow.total - flow.results.length;
  return (
    <Modal open onClose={onClose} title={failed.length || notRun ? `${verb}: finished with problems` : `${verb}: done`} size="md">
      <div className="space-y-4 text-sm">
        <ul className="space-y-1" role="status">
          <li>
            <span className="font-medium text-success" aria-hidden="true">✓ </span>
            {updated.length ? resultHeadline(flow.action, updated.length, options) : "No documents changed."}
          </li>
          {unchanged.length > 0 && (
            <li>
              <span className="font-medium">= {unchanged.length.toLocaleString("en-IN")}</span> already in that state — nothing to do.
            </li>
          )}
          {failed.length > 0 && (
            <li>
              <span className="font-medium text-danger">✕ {failed.length.toLocaleString("en-IN")}</span> failed.
            </li>
          )}
          {notRun > 0 && <li className="text-warning">{plural(notRun)} not processed because the operation was stopped.</li>}
        </ul>
        {failed.length > 0 && (
          <div>
            <p className="font-medium">Failed</p>
            <ul className="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto rounded-sm border border-line p-2">
              {failed.map((f) => (
                <li key={f.id}>
                  <span className="font-medium">{f.title}</span> — <span className="text-muted">{f.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {updated.some((u) => u.message) && (
          <details>
            <summary className="cursor-pointer text-muted">Notes on {plural(updated.filter((u) => u.message).length)}</summary>
            <ul className="mt-1.5 space-y-1">
              {updated.filter((u) => u.message).map((u) => (
                <li key={u.id}>
                  {u.title} — <span className="text-muted">{u.message}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {flow.undoable && updated.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => onUndo(flow.operationId)}>
              <Undo2 size={15} aria-hidden="true" /> Undo
            </button>
          )}
          {failed.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => onRetry(failed.map((f) => f.id))}>
              Retry failed ({failed.length})
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        {flow.action.action === "delete" && updated.length > 0 && <p className="text-xs text-subtle">Permanent deletion can’t be undone.</p>}
      </div>
    </Modal>
  );
}

function LastOperation({ last, onUndo, onDismiss }: { last: LastOp; onUndo: (operationId: string) => void; onDismiss: () => void }) {
  const undoable = Boolean(last.operationId) && !last.undo;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-2.5 text-sm lg:px-10">
      {last.undo ? (
        <p>
          Undone: {plural(last.undo.reverted)} restored to {last.undo.reverted === 1 ? "its" : "their"} earlier state.
          {last.undo.skipped.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-warning">{plural(last.undo.skipped.length)} left as {last.undo.skipped.length === 1 ? "it is" : "they are"}</summary>
              <ul className="mt-1 space-y-1">
                {last.undo.skipped.map((s) => (
                  <li key={s.id}>
                    {s.title} — <span className="text-muted">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </p>
      ) : (
        <p>{last.message}</p>
      )}
      {last.error && <p className="text-danger" role="alert">{last.error}</p>}
      {undoable && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onUndo(last.operationId)} disabled={last.undoing} title={`Available for ${UNDO_WINDOW_MINUTES} minutes`}>
          {last.undoing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />} Undo
        </button>
      )}
      <button type="button" className="ml-auto p-1 text-subtle hover:text-ink" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
