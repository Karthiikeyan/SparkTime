"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme-script";

type Pref = "light" | "dark" | "system";
const ORDER: Pref[] = ["system", "light", "dark"];
const listeners = new Set<() => void>();

function readPref(): Pref {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: Pref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (readPref() === "system") apply("system");
  };
  mq.addEventListener("change", onChange);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onChange);
  };
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as Pref);
  // The pre-paint script sets the theme on server-rendered pages; a page Next renders in the
  // browser instead (a 404 from an on-demand route) never runs it, so apply it here as well.
  useEffect(() => apply(readPref()), []);
  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]!;
  const Icon = pref === "dark" ? Moon : pref === "light" ? Sun : Monitor;
  const label = `Theme: ${pref}. Switch to ${next}.`;

  return (
    <button
      type="button"
      onClick={() => {
        try {
          if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
          else localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // storage unavailable — still apply for this page view
        }
        apply(next);
        listeners.forEach((l) => l());
      }}
      className={`inline-flex size-11 items-center justify-center rounded-[8px] border border-line-strong text-muted transition-colors hover:bg-surface-2 hover:text-ink ${className}`}
      aria-label={label}
      title={label}
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
