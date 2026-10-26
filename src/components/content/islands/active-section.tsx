"use client";

import { useEffect } from "react";
import { activeHeadingIndex } from "@/lib/content/outline";

const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);

/**
 * Marks the outline entry for the section being read with
 * aria-current="location" (every [data-toc] list on the page: the rail and the
 * collapsible one), and marks the section entry above a current subsection
 * with data-trail so its context stays visible. Renders nothing; without
 * JavaScript the outline still works as plain links.
 *
 * No scroll listener. An IntersectionObserver wakes only when a heading
 * crosses the reading line (a third of the way down the viewport). Its region
 * reaches from that line up past the top of the page, so "intersecting" means
 * "above the line": a jump (Home key, an outline link) that moves headings
 * across the line always fires, even when they skip straight past the
 * viewport. `scrollend` adds one wake-up per scroll, for the end of the page,
 * where closing sections may be too short to ever reach the line.
 *
 * A heading the reader jumps to (an outline link, a permalink, a deep link the
 * browser scrolled to) stays current until they scroll by themselves or go
 * back, even when it can't reach the line.
 */
export function ActiveSection({ ids }: { ids: string[] }) {
  const key = ids.join(" ");
  useEffect(() => {
    const headings = key
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (!headings.length || !("IntersectionObserver" in window)) return;
    const known = new Set(headings.map((h) => h.id));
    const root = document.documentElement;
    const clearance = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-toc] a[href^='#']")];
    // A subsection entry's section: the entry that owns the nested list it sits in.
    const sectionOf = new Map(links.map((link) => [link, link.parentElement?.closest("ol")?.closest("li")?.querySelector<HTMLAnchorElement>(":scope > a") ?? null]));
    let current: string | null | undefined;
    let pinned: string | null = null;

    // Keeps the current entry visible when the rail is taller than the screen; never scrolls the page.
    const reveal = (link: HTMLElement) => {
      const box = link.closest<HTMLElement>("[data-toc-scroll]");
      if (!box || box.scrollHeight <= box.clientHeight) return;
      const l = link.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (l.top < b.top) box.scrollTop -= b.top - l.top + 8;
      else if (l.bottom > b.bottom) box.scrollTop += l.bottom - b.bottom + 8;
    };

    const mark = (active: string | null) => {
      if (active === current) return;
      current = active;
      const trail = new Set<HTMLAnchorElement>();
      for (const link of links) {
        if (active && link.getAttribute("href") === `#${active}`) {
          link.setAttribute("aria-current", "location");
          const section = sectionOf.get(link);
          if (section) trail.add(section);
          reveal(link);
        } else link.removeAttribute("aria-current");
      }
      for (const link of links) link.toggleAttribute("data-trail", trail.has(link));
    };

    const update = () => {
      if (pinned) return mark(pinned);
      const height = window.innerHeight;
      const index = activeHeadingIndex(
        headings.map((h) => h.getBoundingClientRect().top),
        // Below the sticky header even on a very short screen, where a third of it is not.
        { line: Math.max(height / 3, clearance + 16), height, atEnd: height + window.scrollY >= root.scrollHeight - 2 },
      );
      mark(index < 0 ? null : headings[index]!.id);
    };

    const onScrollInput = (event: Event) => {
      if (event instanceof KeyboardEvent && !SCROLL_KEYS.has(event.key)) return;
      unpin();
      update();
    };
    const pin = (id: string) => {
      pinned = id;
      window.addEventListener("wheel", onScrollInput, { passive: true });
      window.addEventListener("touchmove", onScrollInput, { passive: true });
      window.addEventListener("keydown", onScrollInput);
      update();
    };
    const unpin = () => {
      pinned = null;
      window.removeEventListener("wheel", onScrollInput);
      window.removeEventListener("touchmove", onScrollInput);
      window.removeEventListener("keydown", onScrollInput);
    };

    // Outline jumps glide — unless the reader prefers reduced motion — and only
    // they do, so route changes and find-in-page stay instant. The jump itself
    // stays a native fragment navigation: focus follows it, and it works
    // without JavaScript.
    let glideTimer = 0;
    const settle = () => {
      window.clearTimeout(glideTimer);
      root.style.removeProperty("scroll-behavior");
    };
    const glide = () => {
      root.style.scrollBehavior = "smooth";
      window.clearTimeout(glideTimer);
      glideTimer = window.setTimeout(settle, 2000);
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href^='#']") : null;
      const id = link?.getAttribute("href")?.slice(1);
      if (!link || !id || !known.has(id)) return;
      if (link.closest("[data-toc]") && window.matchMedia("(prefers-reduced-motion: no-preference)").matches) glide();
      pin(id);
    };
    // Back/Forward (or an edited URL) lands wherever the browser puts it: measure again.
    const onHashChange = () => {
      if (location.hash.slice(1) !== pinned) unpin();
      update();
    };
    const onScrollEnd = () => {
      settle();
      update();
    };

    const observer = new IntersectionObserver(update, { rootMargin: "100000px 0px -66.667% 0px" });
    for (const heading of headings) observer.observe(heading);
    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("scrollend", onScrollEnd);

    // A deep link (or a reload of one) counts as a jump while its heading is on screen.
    const hash = location.hash.slice(1);
    const top = known.has(hash) ? document.getElementById(hash)!.getBoundingClientRect().top : -1;
    if (top >= 0 && top < window.innerHeight) pin(hash);
    else update();

    return () => {
      observer.disconnect();
      unpin();
      settle();
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("scrollend", onScrollEnd);
    };
  }, [key]);
  return null;
}
