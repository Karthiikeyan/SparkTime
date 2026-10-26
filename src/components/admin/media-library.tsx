"use client";

import { Copy, FileDown, Loader2, Music, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { formatBytes, type MediaAsset } from "@/lib/media";
import { api, ApiError, errorMessage } from "./api";
import { TextArea, TextInput } from "./fields";
import { uploadFile } from "./media-picker";
import { ConfirmDialog } from "./modal";
import { useToast } from "./toast";

export function MediaLibrary({ initial, total }: { initial: MediaAsset[]; total: number }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [selected, setSelected] = useState<MediaAsset | null>(initial[0] ?? null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [confirmForce, setConfirmForce] = useState<{ asset: MediaAsset; refs: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (files: File[]) => {
    setUploading((n) => n + files.length);
    for (const file of files) {
      try {
        const asset = await uploadFile(file);
        setItems((list) => [asset, ...list]);
        setSelected(asset);
      } catch (e) {
        toast.error(`${file.name}: ${errorMessage(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const save = async (patch: Partial<Pick<MediaAsset, "alt" | "caption" | "focalX" | "focalY">>) => {
    if (!selected) return;
    const next = { ...selected, ...patch };
    setSelected(next);
    setItems((list) => list.map((i) => (i.id === next.id ? next : i)));
    try {
      await api(`/api/admin/media/${selected.id}`, { method: "PATCH", body: patch });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (asset: MediaAsset, force = false) => {
    try {
      await api(`/api/admin/media/${asset.id}${force ? "?force=1" : ""}`, { method: "DELETE" });
      setItems((list) => list.filter((i) => i.id !== asset.id));
      setSelected(null);
      setConfirmForce(null);
      toast.success("Deleted.");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConfirmForce({ asset, refs: e.details?.references ?? "" });
      else toast.error(errorMessage(e));
    }
  };

  return (
    <div
      className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr_20rem] lg:px-10"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <div>
        <div className={cn("mb-4 flex items-center justify-between rounded-md border border-dashed px-4 py-3 text-sm", dragging ? "border-accent bg-accent-soft/40" : "border-line-strong")}>
          <span className="text-muted">
            {total} files · drop images, PDFs or audio here. Images are resized, re-encoded to WebP and stripped of location metadata.
          </span>
          <input ref={input} type="file" multiple accept="image/*,application/pdf,audio/mpeg,audio/mp4" className="sr-only" onChange={(e) => void upload(Array.from(e.target.files ?? []))} aria-label="Upload files" />
          <button type="button" className="btn btn-accent btn-md" onClick={() => input.current?.click()}>
            {uploading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />} Upload
          </button>
        </div>
        {items.length === 0 ? (
          <p className="py-20 text-center text-muted">No media yet.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6" aria-label="Media files">
            {items.map((asset) => (
              <li key={asset.id}>
                <button type="button" onClick={() => setSelected(asset)} aria-pressed={selected?.id === asset.id} className={cn("block w-full overflow-hidden rounded-sm border text-left", selected?.id === asset.id ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-line-strong")}>
                  <span className="flex aspect-square items-center justify-center bg-surface-2">
                    {asset.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail
                      <img src={asset.variants[0]?.url ?? asset.url} alt={asset.alt} className="size-full object-cover" loading="lazy" />
                    ) : asset.kind === "audio" ? (
                      <Music size={22} className="text-subtle" aria-hidden="true" />
                    ) : (
                      <FileDown size={22} className="text-subtle" aria-hidden="true" />
                    )}
                  </span>
                  <span className="block truncate px-2 py-1 text-xs text-muted">{asset.originalName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start" aria-label="Selected file">
        {selected ? (
          <>
            {selected.kind === "image" ? (
              <FocalPicker asset={selected} onChange={(x, y) => void save({ focalX: x, focalY: y })} />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-sm border border-line bg-surface-2">
                <FileDown size={28} className="text-subtle" aria-hidden="true" />
              </div>
            )}
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-subtle">Size</dt>
              <dd>{formatBytes(selected.sizeBytes)}</dd>
              {selected.width && (
                <>
                  <dt className="text-subtle">Dimensions</dt>
                  <dd>
                    {selected.width} × {selected.height}
                  </dd>
                </>
              )}
              <dt className="text-subtle">Type</dt>
              <dd>{selected.mimeType}</dd>
              <dt className="text-subtle">Uploaded</dt>
              <dd>{formatDate(selected.createdAt, "medium")}</dd>
            </dl>
            {selected.kind === "image" && (
              <>
                <TextInput key={`alt-${selected.id}`} label="Default alt text" value={selected.alt} onChange={(v) => setSelected({ ...selected, alt: v })} onBlur={() => void save({ alt: selected.alt })} help="Describe the image for screen-reader users." />
                <TextArea key={`cap-${selected.id}`} label="Default caption" value={selected.caption} onChange={(v) => { setSelected({ ...selected, caption: v }); }} rows={2} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void save({ caption: selected.caption })}>
                  Save caption
                </button>
              </>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm flex-1"
                onClick={async () => {
                  await navigator.clipboard.writeText(new URL(selected.url, window.location.origin).toString());
                  toast.success("URL copied.");
                }}
              >
                <Copy size={13} aria-hidden="true" /> Copy URL
              </button>
              <button type="button" className="btn btn-sm flex-1 border border-danger/40 text-danger hover:bg-danger/10" onClick={() => void remove(selected)}>
                <Trash2 size={13} aria-hidden="true" /> Delete
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Select a file to edit its details.</p>
        )}
      </aside>
      <ConfirmDialog
        open={Boolean(confirmForce)}
        onClose={() => setConfirmForce(null)}
        destructive
        title="This file is still in use"
        body={<p>It’s used in: {confirmForce?.refs || "some content"}. Deleting it will leave broken images there.</p>}
        confirmLabel="Delete anyway"
        onConfirm={() => (confirmForce ? remove(confirmForce.asset, true) : undefined)}
      />
    </div>
  );
}

/** Click the image to set the focal point used when it's cropped into cards. */
function FocalPicker({ asset, onChange }: { asset: MediaAsset; onChange: (x: number, y: number) => void }) {
  const x = asset.focalX ?? 0.5;
  const y = asset.focalY ?? 0.5;
  return (
    <div>
      <button
        type="button"
        className="relative block w-full overflow-hidden rounded-sm border border-line"
        aria-label="Set focal point (click on the most important part of the image)"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onChange(Math.round(((e.clientX - rect.left) / rect.width) * 100) / 100, Math.round(((e.clientY - rect.top) / rect.height) * 100) / 100);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- admin preview */}
        <img src={asset.variants[1]?.url ?? asset.url} alt={asset.alt} className="w-full" />
        <span className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.4)]" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} aria-hidden="true" />
      </button>
      <p className="mt-1 text-xs text-subtle">Click to set the focal point for crops.</p>
    </div>
  );
}
