"use client";

import {
  Activity,
  ArrowUpRight,
  Download,
  FileText,
  FolderTree,
  HeartPulse,
  History,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Menu,
  Navigation,
  Plus,
  Repeat,
  Search,
  Settings,
  Shapes,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CommandPalette, openCommandPalette, type PaletteAction } from "@/components/search/command-palette";
import { BrandMark } from "@/components/site/brand-mark";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { cn } from "@/lib/cn";
import { api, errorMessage } from "./api";
import { useToast } from "./toast";

const NAV = [
  { href: "/admin", label: "Desk", icon: LayoutDashboard, exact: true, group: "Write" },
  { href: "/admin/documents", label: "Documents", icon: FileText, group: "Write" },
  { href: "/admin/ideas", label: "Ideas", icon: Lightbulb, group: "Write" },
  { href: "/admin/media", label: "Media", icon: ImageIcon, group: "Write" },
  { href: "/admin/trash", label: "Trash", icon: Trash2, group: "Write" },
  { href: "/admin/taxonomy", label: "Topics & tags", icon: FolderTree, group: "Organize" },
  { href: "/admin/types", label: "Formats & fields", icon: Shapes, group: "Organize" },
  { href: "/admin/content-health", label: "Content health", icon: HeartPulse, group: "Organize" },
  { href: "/admin/navigation", label: "Navigation", icon: Navigation, group: "Site" },
  { href: "/admin/redirects", label: "Redirects", icon: Repeat, group: "Site" },
  { href: "/admin/inbox", label: "Inbox", icon: Inbox, group: "Site" },
  { href: "/admin/settings", label: "Settings", icon: Settings, group: "Site" },
  { href: "/admin/import", label: "Import", icon: Upload, exact: true, group: "Data" },
  { href: "/admin/import/history", label: "Import history", icon: History, group: "Data" },
  { href: "/admin/export", label: "Export", icon: Download, group: "Data" },
  { href: "/admin/activity", label: "Activity", icon: Activity, group: "Data" },
];

export type QuickType = { id: string; name: string };

export function useCreateDocument() {
  const router = useRouter();
  const toast = useToast();
  return async (typeId: string, extra: Record<string, unknown> = {}) => {
    try {
      const { id } = await api<{ id: string }>("/api/admin/documents", { method: "POST", body: { typeId, title: "", ...extra } });
      router.push(`/admin/documents/${id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
}

function NewMenu({ types }: { types: QuickType[] }) {
  const [open, setOpen] = useState(false);
  const create = useCreateDocument();
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn btn-accent w-full btn-md" aria-haspopup="menu" aria-expanded={open}>
        <Plus size={16} aria-hidden="true" /> New
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 right-0 top-11 z-50 max-h-80 overflow-y-auto rounded-md border border-line bg-elevated p-1.5 shadow-float">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void create(t.id);
                }}
                className="block w-full rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AdminShell({ children, login, types, unread }: { children: React.ReactNode; login: string; types: QuickType[]; unread: number }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const sidebarRef = useRef<HTMLElement>(null);
  const router = useRouter();
  // Close the mobile menu when the route changes (state adjusted during render, not in an effect).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  useEffect(() => {
    const onUnauthorized = () => router.push("/admin/login");
    window.addEventListener("studio:unauthorized", onUnauthorized);
    return () => window.removeEventListener("studio:unauthorized", onUnauthorized);
  }, [router]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const close = () => setMobileOpen(false);
    const focusable = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input, select, textarea, [tabindex="0"]') ?? [])
      .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", close);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", close);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [mobileOpen]);

  const actions: PaletteAction[] = [
    ...NAV.map((n) => ({ id: `nav-${n.href}`, label: n.label, href: n.href, group: "Go to" })),
    { id: "site", label: "View public site", href: "/", group: "Go to" },
    { id: "export", label: "Export all content (JSON)", href: "/api/admin/export", group: "Admin" },
  ];
  const isEditor = /^\/admin\/documents\/[^/]+$/.test(pathname);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className={cn("flex items-center justify-between px-4 py-4", mobileOpen && "pr-14 lg:pr-4")}>
        <Link href="/admin" className="flex items-center gap-2 font-serif text-lg">
          <BrandMark className="h-6 shrink-0" />
          <span>
            Studio<span className="text-accent">.</span>
          </span>
        </Link>
        <ThemeToggle />
      </div>
      <div className="space-y-2 px-3">
        <NewMenu types={types} />
        <button type="button" onClick={openCommandPalette} className="flex h-9 w-full items-center gap-2 rounded-sm border border-line px-3 text-sm text-subtle hover:text-ink">
          <Search size={15} aria-hidden="true" /> Search <kbd className="ml-auto font-mono text-[10px]">⌘K</kbd>
        </button>
      </div>
      <nav aria-label="Studio" className="mt-4 flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">
          {NAV.map((item, index) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                {NAV[index - 1]?.group !== item.group && <p className="px-2.5 pb-2 pt-5 text-xs font-medium text-subtle">{item.group}</p>}
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm", active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink")}>
                  <item.icon size={16} aria-hidden="true" />
                  {item.label}
                  {item.href === "/admin/inbox" && unread > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-medium text-accent-contrast">{unread}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-line px-3 py-3">
        <a href="/" target="_blank" rel="noopener" className="flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink">
          <ArrowUpRight size={15} aria-hidden="true" /> View site
        </a>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink">
            <LogOut size={15} aria-hidden="true" /> Sign out <span className="ml-auto truncate text-xs text-subtle">{login}</span>
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-bg">
      <aside ref={sidebarRef} role={mobileOpen ? "dialog" : undefined} aria-modal={mobileOpen || undefined} className={cn("fixed inset-y-0 left-0 z-50 w-60 border-r border-line bg-surface transition-transform lg:visible lg:translate-x-0", mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full")} aria-label="Studio sidebar">
        {sidebar}
        {mobileOpen && <button type="button" onClick={() => setMobileOpen(false)} className="absolute right-2 top-4 inline-flex size-9 items-center justify-center rounded-sm bg-elevated lg:hidden" aria-label="Close studio menu"><X size={18} aria-hidden="true" /></button>}
      </aside>
      {mobileOpen && <button type="button" className="fixed inset-0 z-40 bg-black/30 lg:hidden" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
      <div className="lg:pl-60" inert={mobileOpen}>
        {!isEditor && (
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/95 px-4 backdrop-blur-sm lg:hidden">
            <button type="button" onClick={() => setMobileOpen(true)} className="inline-flex size-9 items-center justify-center rounded-sm hover:bg-surface-2" aria-label="Open menu">
              {mobileOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            </button>
            <BrandMark className="h-6 shrink-0" />
            <span className="font-serif">Studio</span>
          </header>
        )}
        {isEditor && (
          <button type="button" onClick={() => setMobileOpen(true)} className="fixed bottom-4 left-4 z-30 inline-flex size-11 items-center justify-center rounded-full border border-line bg-elevated shadow-float lg:hidden" aria-label="Open studio menu">
            <Menu size={18} aria-hidden="true" />
          </button>
        )}
        <main id="main">{children}</main>
      </div>
      <CommandPalette actions={actions} mode="admin" />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-6 py-6 lg:px-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
