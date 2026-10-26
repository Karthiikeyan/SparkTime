"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/components/admin/api";

/**
 * Autosave for a single-author CMS:
 *  - edits apply locally at once; the server save is debounced (1.2s) with a
 *    max wait (8s) so continuous typing still persists regularly,
 *  - one request in flight at a time; changes made meanwhile queue up,
 *  - optimistic concurrency via `expectedVersion` (409 → conflict state),
 *  - network/server failures retry with exponential backoff,
 *  - a crash-recovery copy lives in localStorage until the server confirms,
 *  - the tab being hidden/closed flushes immediately (keepalive).
 */

export type SavePatch = {
  body?: Partial<{ title: string; excerpt: string; content: unknown; properties: Record<string, unknown>; featuredMediaId: string | null }>;
  settings?: Record<string, unknown>;
};

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

type SaveResult = { version: number; stagedChanges: boolean; affectsPublic: boolean; savedAt: string };

const DEBOUNCE_MS = 1200;
const MAX_WAIT_MS = 8000;

export function draftKey(id: string) {
  return `studio:draft:${id}`;
}

function merge(a: SavePatch, b: SavePatch): SavePatch {
  return {
    body: a.body || b.body ? { ...a.body, ...b.body } : undefined,
    settings: a.settings || b.settings ? { ...a.settings, ...b.settings } : undefined,
  };
}

export function useAutosave(options: { documentId: string; initialVersion: number; onSaved?: (r: SaveResult) => void }) {
  const { documentId } = options;
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const version = useRef(options.initialVersion);
  const pending = useRef<SavePatch>({});
  const inFlight = useRef<Promise<void> | null>(null);
  const saveFailure = useRef<Error | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstQueuedAt = useRef<number | null>(null);
  const attempts = useRef(0);
  const conflict = useRef(false);
  const onSavedRef = useRef(options.onSaved);
  useEffect(() => {
    onSavedRef.current = options.onSaved;
  }, [options.onSaved]);

  const hasPending = () => Boolean(pending.current.body || pending.current.settings);
  /** Latest `save`, for retries scheduled from inside `save` itself. */
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  const scheduleSave = (delay: number) => {
    timer.current = setTimeout(() => void saveRef.current?.(), delay);
  };

  const persistLocal = useCallback(() => {
    try {
      if (!pending.current.body) return;
      const existing = JSON.parse(localStorage.getItem(draftKey(documentId)) ?? "{}") as { body?: SavePatch["body"] };
      localStorage.setItem(draftKey(documentId), JSON.stringify({ body: { ...existing.body, ...pending.current.body }, at: Date.now(), baseVersion: version.current }));
    } catch {
      // storage full/blocked — the server save still proceeds
    }
  }, [documentId]);

  const save = useCallback(
    (opts: { force?: boolean; keepalive?: boolean } = {}): Promise<void> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (inFlight.current) return inFlight.current;
      if (!hasPending() || (conflict.current && !opts.force)) return Promise.resolve();
      const patch = pending.current;
      pending.current = {};
      firstQueuedAt.current = null;
      setStatus("saving");
      const operation = (async () => {
        try {
          const result = await api<SaveResult>(`/api/admin/documents/${documentId}`, {
            method: "PATCH",
            body: { ...patch, expectedVersion: opts.force ? undefined : version.current },
            keepalive: opts.keepalive,
          });
          version.current = result.version;
          attempts.current = 0;
          conflict.current = false;
          saveFailure.current = null;
          setError(null);
          setLastSavedAt(new Date(result.savedAt));
          onSavedRef.current?.(result);
          if (!hasPending()) {
            try {
              localStorage.removeItem(draftKey(documentId));
            } catch {
              /* ignore */
            }
          }
          setStatus(hasPending() ? "dirty" : "saved");
        } catch (e) {
          saveFailure.current = e instanceof Error ? e : new Error("Couldn't save your changes.");
          // Put the patch back (newer queued edits win over the failed ones).
          pending.current = merge(patch, pending.current);
          if (e instanceof ApiError && e.status === 409) {
            conflict.current = true;
            setStatus("conflict");
            setError("This document changed in another tab. Reload to get the latest, or overwrite it with yours.");
          } else if (e instanceof ApiError && e.status === 401) {
            setStatus("error");
            setError("Your session expired. Sign in again — your changes are kept in this browser.");
          } else if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
            // Validation error: retrying won't help; drop the offending patch but keep the local copy.
            pending.current = {};
            setStatus("error");
            setError(e.message);
          } else {
            attempts.current += 1;
            setStatus("error");
            setError("Couldn't save — retrying…");
            scheduleSave(Math.min(30_000, 1000 * 2 ** attempts.current));
          }
        } finally {
          inFlight.current = null;
          if (hasPending() && !timer.current && !conflict.current) scheduleSave(DEBOUNCE_MS);
        }
      })();
      inFlight.current = operation;
      return operation;
    },
    [documentId],
  );

  useEffect(() => {
    saveRef.current = () => save();
  }, [save]);

  const queue = useCallback(
    (patch: SavePatch, immediate = false) => {
      pending.current = merge(pending.current, patch);
      persistLocal();
      if (conflict.current) return;
      setStatus((s) => (s === "saving" ? s : "dirty"));
      firstQueuedAt.current ??= Date.now();
      if (timer.current) clearTimeout(timer.current);
      const waited = Date.now() - firstQueuedAt.current;
      timer.current = setTimeout(() => void save(), immediate ? 0 : waited > MAX_WAIT_MS ? 0 : DEBOUNCE_MS);
    },
    [persistLocal, save],
  );

  const flush = useCallback(async () => {
    do {
      await save();
      if (saveFailure.current) throw saveFailure.current;
    } while (hasPending());
  }, [save]);
  const overwrite = useCallback(() => save({ force: true }), [save]);
  /** Adopt the version returned by a lifecycle action (publish, discard…), which bumps it server-side. */
  const syncVersion = useCallback((next: number) => {
    version.current = next;
  }, []);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPending() || inFlight.current) {
        void save({ keepalive: true });
        e.preventDefault();
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden" && hasPending()) void save({ keepalive: true });
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("keydown", onKey);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [save]);

  return { status, error, lastSavedAt, queue, flush, overwrite, syncVersion, version };
}
