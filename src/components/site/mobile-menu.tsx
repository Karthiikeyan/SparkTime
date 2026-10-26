"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavItem } from "@/server/services/navigation";
import { ThemeToggle } from "./theme-toggle";
import { currentItemId, groupLinks, isActive } from "./nav-links";

const topLevel = "flex min-h-11 w-full items-center gap-3 rounded-sm py-2 font-serif text-2xl tracking-tight hover:text-accent";

function CurrentDot() {
  return <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />;
}

/**
 * A menu group as a native disclosure: the same names as the desktop
 * dropdowns, so the site's shape is the same on every screen. The group
 * holding the current page starts open.
 */
function MobileGroup({ item, pathname, current }: { item: NavItem; pathname: string; current: boolean }) {
  return (
    <details open={current} className="group/menu">
      <summary className={`${topLevel} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        {item.label}
        {current && <CurrentDot />}
        <ChevronDown size={18} strokeWidth={1.6} aria-hidden="true" className="ml-auto shrink-0 text-subtle transition-transform group-open/menu:rotate-180" />
      </summary>
      <ul className="mb-3 ml-1 border-l border-line">
        {groupLinks(item).map((link) => (
          <li key={link.id}>
            <Link
              href={link.href!}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              aria-current={!link.external && isActive(pathname, link.href, link.match) ? "page" : undefined}
              className="-ml-px flex min-h-11 items-center border-l-2 border-transparent pl-4 text-lg text-muted hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Mobile navigation as a native <dialog>: focus is contained by the browser,
 * Escape closes it, and the page behind becomes inert.
 */
export function MobileMenu({ items, extra }: { items: NavItem[]; extra: NavItem[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  // Close on route change (state adjusted during render, not in an effect).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-11 items-center justify-center rounded-[8px] text-ink hover:bg-surface-2 lg:hidden"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Menu size={22} strokeWidth={2} aria-hidden="true" />
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false);
        }}
        aria-label="Site menu"
        className="m-0 ml-auto h-dvh max-h-none w-[min(22rem,88vw)] max-w-none bg-bg p-0 text-ink shadow-dialog backdrop:bg-black/40 backdrop:backdrop-blur-[2px] open:animate-[fade-in_0.3s_ease-out]"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <span className="caps text-muted">Menu</span>
            <button type="button" onClick={() => setOpen(false)} className="inline-flex size-11 items-center justify-center rounded-[8px] hover:bg-surface-2" aria-label="Close menu">
              <X size={19} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>
          {/* Keyed by page so each visit opens the section you're in, not whichever was left open. */}
          <nav
            key={pathname}
            className="flex-1 overflow-y-auto px-5 py-6"
            aria-label="Mobile"
            // A route change closes the menu; so does a tap on a link to the page you're already on.
            onClick={(e) => {
              if (e.target instanceof Element && e.target.closest("a")) setOpen(false);
            }}
          >
            <ul className="space-y-1">
              {items.map((item) => {
                const here = currentItemId(pathname, items) === item.id;
                return item.children.length ? (
                  <li key={item.id}>
                    <MobileGroup item={item} pathname={pathname} current={here} />
                  </li>
                ) : item.href ? (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className={topLevel}
                      aria-current={here ? "page" : undefined}
                    >
                      {item.label}
                      {here && <CurrentDot />}
                    </Link>
                  </li>
                ) : null;
              })}
            </ul>
            {extra.length > 0 && (
              <ul className="mt-8 space-y-1 border-t border-line pt-6">
                {extra.map((item) =>
                  item.href ? (
                    <li key={item.id}>
                      <Link href={item.href} className="flex min-h-11 items-center text-muted hover:text-ink aria-[current=page]:text-ink" aria-current={isActive(pathname, item.href, item.match) ? "page" : undefined}>
                        {item.label}
                      </Link>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </nav>
          {/* The header keeps the theme switch for wide screens; here it sits at the foot of the menu. */}
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            <span className="text-sm text-muted">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </dialog>
    </>
  );
}
