"use client";

import { Search } from "lucide-react";
import { openCommandPalette } from "./command-palette";

/** Opens the ⌘K palette: a labelled button on wide screens, a 44px icon button on small ones. */
export function SearchTrigger({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className={
        compact
          ? "inline-flex size-11 items-center justify-center rounded-[8px] text-ink hover:bg-surface-2 lg:hidden"
          : "hidden min-h-11 items-center gap-2.5 rounded-[8px] border border-line-strong bg-surface px-3.5 text-sm text-muted transition-colors hover:border-line-field hover:text-ink lg:inline-flex"
      }
      aria-label="Search the library (Ctrl+K)"
    >
      <Search size={compact ? 20 : 16} strokeWidth={2} aria-hidden="true" />
      {!compact && (
        <>
          <span>Search</span>
          <kbd className="rounded-xs border border-line-strong px-1.5 font-sans text-xs">⌘K</kbd>
        </>
      )}
    </button>
  );
}
