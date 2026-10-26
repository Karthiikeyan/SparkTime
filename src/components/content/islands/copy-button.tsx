"use client";

import { useState } from "react";

/** Copies text to the clipboard. A bordered button with a word on it, not an icon to guess at. */
export function CopyButton({ text, label = "Copy", copiedLabel = "Copied", className = "" }: { text: string; label?: string; copiedLabel?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // clipboard unavailable (insecure context) — silently ignore
        }
      }}
      className={`inline-flex min-h-9 items-center rounded-sm border border-line-strong bg-surface px-3 font-sans text-[0.8125rem] font-medium text-ink transition-colors hover:border-line-field ${className}`}
    >
      {copied ? copiedLabel : label}
      <span className="sr-only" aria-live="polite">
        {copied ? " to clipboard" : ""}
      </span>
    </button>
  );
}
