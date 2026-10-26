"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Accessible modal on the native <dialog>: the browser traps focus, makes the
 * page inert and handles Escape; we restore focus on close.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restore.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      restore.current?.focus?.();
    }
  }, [open]);

  const width = size === "sm" ? "w-[min(26rem,calc(100vw-2rem))]" : size === "lg" ? "w-[min(56rem,calc(100vw-2rem))]" : "w-[min(36rem,calc(100vw-2rem))]";

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={`m-auto max-h-[85vh] max-w-none overflow-hidden rounded-lg border border-line bg-elevated p-0 text-ink shadow-dialog backdrop:bg-black/40 ${width}`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 id={titleId} className="font-semibold">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-0.5 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-sm text-subtle hover:bg-surface-2 hover:text-ink" aria-label="Close">
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** Confirmation with an optional "type this to confirm" guard for destructive actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  destructive = false,
  requireText,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (typed: string) => void | Promise<void>;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  requireText?: string;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const ok = !requireText || typed === requireText;
  return (
    <Modal
      open={open}
      onClose={() => {
        setTyped("");
        onClose();
      }}
      title={title}
      size="sm"
    >
      <div className="space-y-4 text-sm">
        <div className="text-muted">{body}</div>
        {requireText && (
          <div>
            <label htmlFor={inputId} className="text-sm">
              Type <code className="rounded-xs bg-surface-2 px-1 font-mono">{requireText}</code> to confirm
            </label>
            <input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1.5 w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono outline-none focus:border-accent" autoComplete="off" />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok || busy}
            className={destructive ? "btn bg-danger text-white hover:opacity-90" : "btn btn-primary"}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(typed);
                setTyped("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
