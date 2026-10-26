"use client";

import { FileDown, Loader2, Music, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { prepareImage } from "@/editor/image-prep";
import { formatBytes, type MediaAsset } from "@/lib/media";
import { cn } from "@/lib/cn";
import { api, errorMessage } from "./api";
import { Modal } from "./modal";

type Kind = "image" | "file" | "audio";
const ACCEPT: Record<Kind, string> = { image: "image/jpeg,image/png,image/webp,image/gif,image/avif", file: "application/pdf", audio: "audio/mpeg,audio/mp4" };

export async function uploadFile(file: File, alt?: string): Promise<MediaAsset> {
  const form = new FormData();
  // Large photos are downscaled in the browser so they fit the platform's request limit.
  form.set("file", await prepareImage(file));
  if (alt) form.set("alt", alt);
  return api<MediaAsset>("/api/admin/media", { method: "POST", body: form });
}

/** Promise-based picker: `await pick("image")` resolves with an asset or null. */
export function useMediaPicker() {
  const [state, setState] = useState<{ kind: Kind; resolve: (a: MediaAsset | null) => void } | null>(null);
  const pick = useCallback((kind: Kind) => new Promise<MediaAsset | null>((resolve) => setState({ kind, resolve })), []);
  const element = state ? (
    <MediaPickerDialog
      kind={state.kind}
      onDone={(asset) => {
        state.resolve(asset);
        setState(null);
      }}
    />
  ) : null;
  return { pick, element };
}

function MediaPickerDialog({ kind, onDone }: { kind: Kind; onDone: (asset: MediaAsset | null) => void }) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      api<{ items: MediaAsset[] }>(`/api/admin/media?kind=${kind}&q=${encodeURIComponent(q)}&limit=60`, { signal: controller.signal })
        .then((r) => setItems(r.items))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 150);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [kind, q]);

  return (
    <Modal open onClose={() => onDone(null)} title={`Choose ${kind === "image" ? "an image" : kind === "audio" ? "audio" : "a file"}`} description="Pick from your library or upload something new." size="lg">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-sm border border-line bg-surface px-3">
          <Search size={15} className="text-subtle" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, alt text or caption" className="h-9 w-full bg-transparent text-sm outline-none" aria-label="Search media" />
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPT[kind]}
          className="sr-only"
          aria-label="Upload file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true);
            setError(null);
            try {
              onDone(await uploadFile(file));
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setUploading(false);
            }
          }}
        />
        <button type="button" className="btn btn-accent" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />} Upload
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      <div className="mt-4 min-h-40">
        {loading ? (
          <p className="py-10 text-center text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Nothing here yet — upload your first {kind}.</p>
        ) : (
          <ul className={cn("grid gap-3", kind === "image" ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-2")}>
            {items.map((asset) => (
              <li key={asset.id}>
                <button type="button" onClick={() => onDone(asset)} className="group w-full overflow-hidden rounded-sm border border-line text-left hover:border-accent focus-visible:border-accent">
                  {asset.kind === "image" ? (
                    <span className="block aspect-square bg-surface-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail */}
                      <img src={asset.variants[0]?.url ?? asset.url} alt={asset.alt} className="size-full object-cover" loading="lazy" />
                    </span>
                  ) : (
                    <span className="flex items-center gap-3 p-3">
                      {asset.kind === "audio" ? <Music size={18} aria-hidden="true" /> : <FileDown size={18} aria-hidden="true" />}
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{asset.originalName}</span>
                        <span className="block text-xs text-subtle">{formatBytes(asset.sizeBytes)}</span>
                      </span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
