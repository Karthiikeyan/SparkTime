"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useDismiss } from "@/components/ui/use-dismiss";
import { cn } from "@/lib/cn";
import type { NavItem } from "@/server/services/navigation";

/**
 * A link is current on its own page and everything beneath it, and on the
 * pages its section holds (`match`): Writing on /article/…, About on /now.
 */
export function isActive(pathname: string, href: string | null, match: readonly string[] = []): boolean {
  return [href, ...match].some((p) => Boolean(p) && (pathname === p || pathname.startsWith(`${p}/`)));
}

/** The links a group opens onto; a group that is itself a link leads with it. */
export function groupLinks(item: NavItem): NavItem[] {
  return [...(item.href ? [{ ...item, children: [] }] : []), ...item.children.filter((child) => child.href)];
}

/** A group is current when the page is one of its links, or beneath one. */
export function isGroupActive(pathname: string, item: NavItem): boolean {
  return groupLinks(item).some((link) => !link.external && isActive(pathname, link.href, link.match));
}

/**
 * The one menu item that is "you are here": an item whose own link contains
 * the page wins over one that only claims it through its section's paths, so
 * an article never lights up both Library and Writing.
 */
export function currentItemId(pathname: string, items: NavItem[]): string | null {
  const own = items.find((item) => groupLinks(item).some((link) => !link.external && isActive(pathname, link.href)));
  if (own) return own.id;
  return items.find((item) => isGroupActive(pathname, item))?.id ?? null;
}

const external = { target: "_blank", rel: "noopener noreferrer" } as const;
// No colour here: cn() only joins classes, so each item sets exactly one text colour.
const itemClass = "relative inline-flex min-h-11 items-center gap-1 rounded-sm px-1 text-[0.9375rem] font-medium transition-colors hover:text-muted";

/** The accent rule under the current section: a shape, not only a colour. */
function CurrentRule({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={cn("absolute inset-x-1 bottom-1.5 h-0.5 origin-left bg-accent transition-transform duration-300", on ? "scale-x-100" : "scale-x-0")} />;
}

/**
 * Desktop primary navigation. Plain items are links; a group (Studio →
 * Navigation) is a disclosure button over a short list of links, one open at
 * a time. Client only for the current-page marks and the open state.
 */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  // Close on route change (state adjusted during render, not in an effect).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(null);
  }
  const toggle = useCallback((id: string, next: boolean) => setOpen((current) => (next ? id : current === id ? null : current)), []);
  const currentId = currentItemId(pathname, items);

  return (
    <ul className="flex items-center gap-5 xl:gap-6">
      {items.map((item, index) => {
        if (item.children.length) {
          // Later groups open leftwards so the panel never runs off the screen's edge.
          return <NavGroup key={item.id} item={item} pathname={pathname} current={currentId === item.id} open={open === item.id} onToggle={toggle} alignEnd={index >= items.length / 2} />;
        }
        if (!item.href) return null;
        const current = currentId === item.id;
        return (
          <li key={item.id}>
            <Link href={item.href} {...(item.external ? external : {})} aria-current={current ? "page" : undefined} className={cn(itemClass, current ? "text-accent-ink" : "text-ink")}>
              {item.label}
              <CurrentRule on={current} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NavGroup({ item, pathname, current, open, onToggle, alignEnd }: { item: NavItem; pathname: string; current: boolean; open: boolean; onToggle: (id: string, open: boolean) => void; alignEnd: boolean }) {
  const root = useRef<HTMLLIElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const links = groupLinks(item);
  const close = useCallback(() => onToggle(item.id, false), [onToggle, item.id]);
  // Escape (focus back on the button) and a press anywhere else close it.
  useDismiss(root, open, close, trigger);

  // Arrow keys step through the open list; ArrowDown on the button opens it onto the first link.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!open) flushSync(() => onToggle(item.id, true));
    const anchors = [...(panel.current?.querySelectorAll("a") ?? [])];
    const at = anchors.indexOf(document.activeElement as HTMLAnchorElement);
    const next = at < 0 ? (event.key === "ArrowDown" ? 0 : anchors.length - 1) : (at + (event.key === "ArrowDown" ? 1 : -1) + anchors.length) % anchors.length;
    anchors[next]?.focus();
  };

  return (
    <li
      ref={root}
      className="relative"
      onKeyDown={onKeyDown}
      // Tabbing past the last link closes the panel, so it never hangs open behind the focus.
      // (No related target means a click, which the outside-press rule already handles.)
      onBlur={(event) => {
        if (open && event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle(item.id, !open)}
        className={cn(itemClass, "text-ink")}
      >
        {item.label}
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" className={cn("text-subtle transition-transform", open && "rotate-180")} />
        <CurrentRule on={current} />
      </button>
      <div ref={panel} id={panelId} hidden={!open} className={cn("absolute top-full z-50 mt-2 w-80 rounded-[14px] border border-line bg-elevated p-1.5 shadow-soft", alignEnd ? "right-0" : "left-0")}>
        <ul>
          {links.map((link) => {
            const here = !link.external && isActive(pathname, link.href, link.match);
            return (
              <li key={link.id}>
                <Link
                  href={link.href!}
                  {...(link.external ? external : {})}
                  onClick={close}
                  aria-current={here ? "page" : undefined}
                  className="group/link block min-h-11 rounded-sm border-l-2 border-transparent px-3 py-2.5 transition-colors hover:bg-surface-2 aria-[current=page]:border-accent aria-[current=page]:bg-surface-2"
                >
                  <span className="block text-[0.9375rem] font-medium text-ink group-hover/link:text-accent">{link.label}</span>
                  {link.description && <span className="mt-0.5 line-clamp-2 block text-sm leading-snug text-muted">{link.description}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </li>
  );
}
