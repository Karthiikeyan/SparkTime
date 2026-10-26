"use client";

import { ArrowRight, CornerDownLeft, FileText, LayoutDashboard, Loader2, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { HighlightTokens, Highlighted } from "./highlight";

export const OPEN_PALETTE_EVENT = "studio:open-palette";

export type PaletteAction = { id: string; label: string; hint?: string; href?: string; group: string; keywords?: string; run?: () => void | Promise<void> };

type SearchHit = { id: string; title: string; path: string; typeName: string; snippet: string; status?: string; visibility?: string };
type Session = { admin: boolean; quickCreate: Array<{ id: string; name: string }> } | null;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Global command palette (⌘K / Ctrl+K, or "/"). Combobox + listbox with
 * aria-activedescendant, fully keyboard-operable, inside a native modal
 * <dialog>. Searches published content; when the visitor is the signed-in
 * admin it also searches drafts and offers create/navigate actions.
 */
export function CommandPalette({ actions, mode = "public" }: { actions: PaletteAction[]; mode?: "public" | "admin" }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [session, setSession] = useState<Session>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !isTypingTarget(e.target) && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocus.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
      // Learn whether the visitor is the admin (cheap, uncached endpoint).
      if (session === null) {
        fetch("/api/auth/me", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : { admin: false, quickCreate: [] }))
          .then((s: Session) => setSession(s ?? { admin: false, quickCreate: [] }))
          .catch(() => setSession({ admin: false, quickCreate: [] }));
      }
    } else if (!open && dialog.open) {
      dialog.close();
      setQuery("");
      setHits([]);
      restoreFocus.current?.focus?.();
    }
  }, [open, session]);

  const isAdmin = mode === "admin" || Boolean(session?.admin);

  // Debounced, cancellable search. Short queries simply show no results (derived below).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const url = isAdmin ? `/api/admin/search?q=${encodeURIComponent(q)}` : `/api/search?q=${encodeURIComponent(q)}&limit=8`;
      fetch(url, { signal: controller.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((data: { results?: SearchHit[] }) => {
          setHits(data.results ?? []);
          setActive(0);
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, isAdmin]);

  const createActions: PaletteAction[] = useMemo(() => {
    if (!isAdmin) return [];
    return (session?.quickCreate ?? []).map((t) => ({
      id: `create-${t.id}`,
      label: `New ${t.name}`,
      group: "Create",
      keywords: `create new add ${t.name}`,
      run: async () => {
        const res = await fetch("/api/admin/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ typeId: t.id, title: "" }) });
        if (res.ok) {
          const { id } = (await res.json()) as { id: string };
          router.push(`/admin/documents/${id}`);
        }
      },
    }));
  }, [isAdmin, session, router]);

  const adminActions: PaletteAction[] = useMemo(
    () =>
      isAdmin && mode === "public"
        ? [
            { id: "admin-home", label: "Open studio (admin)", href: "/admin", group: "Admin" },
            { id: "admin-ideas", label: "Ideas backlog", href: "/admin/ideas", group: "Admin" },
          ]
        : [],
    [isAdmin, mode],
  );

  const q = query.trim().toLowerCase();
  const searching = q.length >= 2;
  const shownHits = searching ? hits : [];
  const filteredActions = [...createActions, ...actions, ...adminActions].filter(
    (a) => !q || a.label.toLowerCase().includes(q) || (a.keywords ?? "").toLowerCase().includes(q),
  );
  const items: Array<{ key: string; group: string; render: React.ReactNode; onSelect: () => void }> = [
    ...shownHits.map((hit) => ({
      key: `hit-${hit.id}`,
      group: isAdmin ? "Documents" : "Results",
      onSelect: () => router.push(isAdmin && mode === "admin" ? `/admin/documents/${hit.id}` : hit.path),
      render: (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink">
              <HighlightTokens text={hit.title} query={query} />
            </span>
            {hit.status && hit.status !== "published" && <span className="rounded-xs bg-surface-2 px-1.5 py-px font-mono text-[10px] uppercase text-muted">{hit.status}</span>}
            {hit.visibility === "private" && <span className="rounded-xs bg-surface-2 px-1.5 py-px font-mono text-[10px] uppercase text-muted">private</span>}
          </div>
          {hit.snippet && (
            <p className="mt-0.5 line-clamp-1 text-sm text-muted">
              <Highlighted text={hit.snippet} />
            </p>
          )}
        </div>
      ),
    })),
    ...filteredActions.slice(0, 12).map((a) => ({
      key: a.id,
      group: a.group,
      onSelect: () => {
        if (a.run) void a.run();
        else if (a.href) router.push(a.href);
      },
      render: (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-ink">{a.label}</span>
          {a.hint && <span className="ml-auto shrink-0 text-xs text-subtle">{a.hint}</span>}
        </div>
      ),
    })),
  ];
  const clampedActive = Math.min(active, Math.max(items.length - 1, 0));

  const select = (index: number) => {
    const item = items[index];
    if (!item) return;
    close();
    item.onSelect();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items.length) select(clampedActive);
      else if (query.trim() && mode === "public") {
        close();
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
      }
    } else if (e.key === "Home") {
      setActive(0);
    } else if (e.key === "End") {
      setActive(Math.max(items.length - 1, 0));
    }
  };

  useEffect(() => {
    document.getElementById(`${listId}-opt-${clampedActive}`)?.scrollIntoView({ block: "nearest" });
  }, [clampedActive, listId]);

  let lastGroup = "";

  return (
    <dialog
      ref={dialogRef}
      onClose={close}
      onClick={(e) => {
        if (e.target === dialogRef.current) close();
      }}
      aria-label="Search and commands"
      className="mx-auto mt-[12vh] w-[min(40rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-lg border border-line bg-elevated p-0 text-ink shadow-dialog backdrop:bg-black/35 backdrop:backdrop-blur-[3px]"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        {loading && searching ? <Loader2 size={18} className="shrink-0 animate-spin text-subtle" aria-hidden="true" /> : <Search size={18} className="shrink-0 text-subtle" aria-hidden="true" />}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items.length ? `${listId}-opt-${clampedActive}` : undefined}
          aria-autocomplete="list"
          aria-label={isAdmin ? "Search everything or run a command" : "Search the site"}
          placeholder={isAdmin ? "Search documents, create, jump to…" : "Search writing, projects, videos, ideas…"}
          className="h-14 w-full bg-transparent text-[1.05rem] outline-none placeholder:text-subtle"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="hidden shrink-0 rounded-xs border border-line px-1.5 py-0.5 font-mono text-[10px] text-subtle sm:block">ESC</kbd>
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
        {items.length === 0 && (
          <li role="presentation" className="px-3 py-10 text-center text-sm text-muted">
            {query.trim().length >= 2 && !loading ? (
              <>
                Nothing matches “{query.trim()}”.
                {mode === "public" && <span className="block pt-1 text-subtle">Press Enter to open full search.</span>}
              </>
            ) : (
              "Type to search. Use ↑ ↓ to move, Enter to open."
            )}
          </li>
        )}
        {items.map((item, index) => {
          const header = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          return (
            <li key={item.key} role="presentation">
              {header && <div className="eyebrow px-3 pb-1 pt-3">{header}</div>}
              <div
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={index === clampedActive}
                onMouseMove={() => setActive(index)}
                onClick={() => select(index)}
                className="flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5 aria-selected:bg-surface-2"
              >
                {item.key.startsWith("hit-") ? (
                  <FileText size={16} className="shrink-0 text-subtle" aria-hidden="true" />
                ) : item.key.startsWith("create-") ? (
                  <Plus size={16} className="shrink-0 text-accent" aria-hidden="true" />
                ) : item.group === "Admin" ? (
                  <LayoutDashboard size={16} className="shrink-0 text-subtle" aria-hidden="true" />
                ) : (
                  <ArrowRight size={16} className="shrink-0 text-subtle" aria-hidden="true" />
                )}
                {item.render}
                {index === clampedActive && <CornerDownLeft size={14} className="shrink-0 text-subtle" aria-hidden="true" />}
              </div>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}
