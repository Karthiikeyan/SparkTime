"use client";

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { AlertTriangle, AudioLines, Bookmark, Calculator, FileDown, ImageIcon, Info, Layers, Lightbulb, Link2, Loader2, Play, Plus, Sparkle, Trash2, Upload, Video, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { EMBED_PROVIDER_LABELS, parseEmbedUrl, parseYouTubeId, parseYouTubeStart, youTubeThumbnail, type EmbedProvider } from "@/lib/embeds";
import { formatBytes } from "@/lib/media";
import { useEditorServices, type LookupItem } from "./services";

const frame = (selected: boolean) =>
  cn("not-prose relative my-4 rounded-md border bg-surface transition-shadow", selected ? "border-accent ring-2 ring-accent/20" : "border-line");

const smallInput = "w-full rounded-xs border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent";

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">{children}</div>;
}

function IconButton({ label, onClick, children, active = false }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={active} className={cn("inline-flex h-7 items-center gap-1 rounded-xs px-2 text-xs", active ? "bg-ink text-bg" : "text-muted hover:bg-surface-2 hover:text-ink")}>
      {children}
    </button>
  );
}

function UrlPrompt({ icon, placeholder, onSubmit, error }: { icon: React.ReactNode; placeholder: string; onSubmit: (v: string) => void; error?: string }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-center gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value.trim());
      }}
    >
      <span className="text-subtle">{icon}</span>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className={smallInput} autoFocus aria-label={placeholder} />
      <button type="submit" className="btn btn-primary btn-sm">
        Add
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}

// ---------------------------------------------------------------------------

const CALLOUTS = {
  note: { icon: Info, label: "Note", cls: "border-info/40 bg-info/5" },
  tip: { icon: Lightbulb, label: "Tip", cls: "border-success/40 bg-success/5" },
  warning: { icon: AlertTriangle, label: "Warning", cls: "border-warning/50 bg-warning/5" },
  important: { icon: Sparkle, label: "Important", cls: "border-accent/40 bg-accent-soft/40" },
} as const;

export function CalloutView({ node, updateAttributes }: NodeViewProps) {
  const variant = (node.attrs.variant as keyof typeof CALLOUTS) ?? "note";
  const current = CALLOUTS[variant] ?? CALLOUTS.note;
  const Icon = current.icon;
  return (
    <NodeViewWrapper as="aside" className={cn("my-4 flex gap-3 rounded-md border px-4 py-3", current.cls)} data-callout={variant}>
      <button
        type="button"
        contentEditable={false}
        onClick={() => {
          const keys = Object.keys(CALLOUTS) as Array<keyof typeof CALLOUTS>;
          updateAttributes({ variant: keys[(keys.indexOf(variant) + 1) % keys.length] });
        }}
        className="mt-1 h-fit shrink-0 rounded-xs text-muted hover:text-ink"
        aria-label={`Callout type: ${current.label}. Click to change.`}
        title={`${current.label} — click to change`}
      >
        <Icon size={17} aria-hidden="true" />
      </button>
      <NodeViewContent className="min-w-0 flex-1" />
    </NodeViewWrapper>
  );
}

export function ImageView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const services = useEditorServices();
  const { src, alt, caption, size, uploading } = node.attrs as { src: string; alt: string; caption: string; size: string; uploading?: boolean };
  const [busy, setBusy] = useState(false);

  if (!src) {
    return (
      <NodeViewWrapper className={frame(selected)} data-drag-handle>
        <div className="flex flex-wrap items-center gap-2 p-4 text-sm text-muted">
          <ImageIcon size={17} aria-hidden="true" /> Image
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const asset = await services.pickMedia("image");
              if (asset) updateAttributes({ src: asset.url, mediaId: asset.id, width: asset.width, height: asset.height, alt: asset.alt });
            }}
          >
            Choose or upload…
          </button>
          <span className="text-xs text-subtle">or paste / drop an image anywhere</span>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className={cn(frame(selected), "overflow-hidden")} data-drag-handle>
      <div className="relative bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- editor preview */}
        <img src={src} alt={alt} className={cn("mx-auto block max-h-[70vh] w-auto", uploading && "opacity-50")} draggable={false} />
        {(uploading || busy) && (
          <span className="absolute inset-0 flex items-center justify-center gap-2 text-sm">
            <Loader2 className="animate-spin" size={18} aria-hidden="true" /> Uploading…
          </span>
        )}
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Alt text <span className="text-subtle">(describe for screen readers)</span>
          <input value={alt} onChange={(e) => updateAttributes({ alt: e.target.value })} className={cn(smallInput, "mt-1", !alt && "border-warning/60")} placeholder="What does the image show?" />
        </label>
        <label className="text-xs text-muted">
          Caption
          <input value={caption} onChange={(e) => updateAttributes({ caption: e.target.value })} className={cn(smallInput, "mt-1")} placeholder="Optional caption" />
        </label>
      </div>
      <Toolbar>
        {(["content", "wide", "full"] as const).map((s) => (
          <IconButton key={s} label={`Width: ${s}`} active={size === s} onClick={() => updateAttributes({ size: s })}>
            {s}
          </IconButton>
        ))}
        <span className="flex-1" />
        <IconButton
          label="Replace image"
          onClick={async () => {
            setBusy(true);
            try {
              const asset = await services.pickMedia("image");
              if (asset) updateAttributes({ src: asset.url, mediaId: asset.id, width: asset.width, height: asset.height });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Upload size={13} aria-hidden="true" /> Replace
        </IconButton>
        <IconButton label="Delete image" onClick={deleteNode}>
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      </Toolbar>
    </NodeViewWrapper>
  );
}

type GalleryImage = { mediaId: string | null; src: string; alt: string; caption: string; width: number | null; height: number | null };

export function GalleryView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const services = useEditorServices();
  const images = (node.attrs.images as GalleryImage[]) ?? [];
  const columns = Number(node.attrs.columns ?? 3);
  const [busy, setBusy] = useState(false);
  return (
    <NodeViewWrapper className={frame(selected)} data-drag-handle>
      <div className={cn("grid gap-2 p-3", columns === 2 ? "grid-cols-2" : columns === 4 ? "grid-cols-4" : "grid-cols-3")}>
        {images.map((img, i) => (
          <div key={`${img.src}-${i}`} className="group relative aspect-square overflow-hidden rounded-xs bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- editor preview */}
            <img src={img.src} alt={img.alt} className="size-full object-cover" draggable={false} />
            <button type="button" onClick={() => updateAttributes({ images: images.filter((_, j) => j !== i) })} className="absolute right-1 top-1 hidden rounded-xs bg-black/60 p-1 text-white group-hover:block" aria-label="Remove image">
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const asset = await services.pickMedia("image");
              if (asset) updateAttributes({ images: [...images, { mediaId: asset.id, src: asset.url, alt: asset.alt, caption: "", width: asset.width, height: asset.height }] });
            } finally {
              setBusy(false);
            }
          }}
          className="flex aspect-square items-center justify-center rounded-xs border border-dashed border-line-strong text-subtle hover:border-accent hover:text-accent"
          aria-label="Add image to gallery"
        >
          {busy ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
        </button>
      </div>
      <Toolbar>
        <Layers size={13} className="text-subtle" aria-hidden="true" />
        <span className="text-xs text-muted">Gallery · {images.length} images</span>
        {[2, 3, 4].map((c) => (
          <IconButton key={c} label={`${c} columns`} active={columns === c} onClick={() => updateAttributes({ columns: c })}>
            {c} cols
          </IconButton>
        ))}
        <span className="flex-1" />
        <IconButton label="Delete gallery" onClick={deleteNode}>
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      </Toolbar>
    </NodeViewWrapper>
  );
}

export function YouTubeView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const { videoId, title, caption } = node.attrs as { videoId: string; title: string; caption: string };
  const [error, setError] = useState<string>();
  if (!videoId) {
    return (
      <NodeViewWrapper className={frame(selected)} data-drag-handle>
        <UrlPrompt
          icon={<Video size={16} aria-hidden="true" />}
          placeholder="Paste a YouTube link"
          error={error}
          onSubmit={(value) => {
            const id = parseYouTubeId(value);
            if (!id) return setError("That doesn't look like a YouTube link.");
            updateAttributes({ videoId: id, start: parseYouTubeStart(value) });
          }}
        />
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className={cn(frame(selected), "overflow-hidden")} data-drag-handle>
      <div className="relative aspect-video bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail */}
        <img src={youTubeThumbnail(videoId)} alt="" className="size-full object-cover opacity-80" draggable={false} />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-white/90 text-black">
            <Play size={22} fill="currentColor" aria-hidden="true" />
          </span>
        </span>
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        <input value={title} onChange={(e) => updateAttributes({ title: e.target.value })} className={smallInput} placeholder="Video title (used for accessibility)" aria-label="Video title" />
        <input value={caption} onChange={(e) => updateAttributes({ caption: e.target.value })} className={smallInput} placeholder="Caption" aria-label="Caption" />
      </div>
      <Toolbar>
        <span className="font-mono text-[11px] text-subtle">youtube · {videoId}</span>
        <span className="flex-1" />
        <IconButton label="Delete video" onClick={deleteNode}>
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      </Toolbar>
    </NodeViewWrapper>
  );
}

export function EmbedView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const { provider, embedId, title } = node.attrs as { provider: EmbedProvider | ""; embedId: string; title: string };
  const [error, setError] = useState<string>();
  if (!provider) {
    return (
      <NodeViewWrapper className={frame(selected)} data-drag-handle>
        <UrlPrompt
          icon={<Link2 size={16} aria-hidden="true" />}
          placeholder="Paste a Vimeo, CodePen, Spotify or Loom link"
          error={error}
          onSubmit={(value) => {
            const parsed = parseEmbedUrl(value);
            if (!parsed) return setError("Only Vimeo, CodePen, Spotify and Loom links can be embedded.");
            updateAttributes({ provider: parsed.provider, embedId: parsed.id });
          }}
        />
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className={frame(selected)} data-drag-handle>
      <div className="flex items-center gap-3 p-4 text-sm">
        <Link2 size={16} className="text-subtle" aria-hidden="true" />
        <span className="font-medium">{EMBED_PROVIDER_LABELS[provider]} embed</span>
        <span className="font-mono text-xs text-subtle">{embedId}</span>
      </div>
      <div className="px-3 pb-3">
        <input value={title} onChange={(e) => updateAttributes({ title: e.target.value })} className={smallInput} placeholder="Title (for accessibility)" aria-label="Embed title" />
      </div>
      <Toolbar>
        <span className="text-xs text-subtle">Loads only when a reader clicks it.</span>
        <span className="flex-1" />
        <IconButton label="Delete embed" onClick={deleteNode}>
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      </Toolbar>
    </NodeViewWrapper>
  );
}

export function FileView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const services = useEditorServices();
  const isAudio = node.type.name === "audio";
  const { src, name, size, title } = node.attrs as { src: string; name?: string; size?: number; title?: string };
  if (!src) {
    return (
      <NodeViewWrapper className={frame(selected)} data-drag-handle>
        <div className="flex items-center gap-2 p-4 text-sm text-muted">
          {isAudio ? <AudioLines size={17} aria-hidden="true" /> : <FileDown size={17} aria-hidden="true" />}
          {isAudio ? "Audio" : "File / PDF"}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const asset = await services.pickMedia(isAudio ? "audio" : "file");
              if (asset) updateAttributes(isAudio ? { src: asset.url, mediaId: asset.id, title: asset.originalName } : { src: asset.url, mediaId: asset.id, name: asset.originalName, size: asset.sizeBytes, mimeType: asset.mimeType });
            }}
          >
            Choose or upload…
          </button>
        </div>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className={frame(selected)} data-drag-handle>
      <div className="flex items-center gap-3 p-4">
        {isAudio ? <AudioLines size={18} className="text-subtle" aria-hidden="true" /> : <FileDown size={18} className="text-subtle" aria-hidden="true" />}
        <input
          value={isAudio ? title ?? "" : name ?? ""}
          onChange={(e) => updateAttributes(isAudio ? { title: e.target.value } : { name: e.target.value })}
          className={smallInput}
          aria-label={isAudio ? "Audio title" : "File name shown to readers"}
        />
        {!isAudio && size ? <span className="shrink-0 font-mono text-xs text-subtle">{formatBytes(size)}</span> : null}
        <IconButton label="Delete" onClick={deleteNode}>
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      </div>
    </NodeViewWrapper>
  );
}

export function BookmarkView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const services = useEditorServices();
  const { url, title, description, siteName } = node.attrs as { url: string; title: string; description: string; siteName: string };
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  if (!url) {
    return (
      <NodeViewWrapper className={frame(selected)} data-drag-handle>
        <UrlPrompt
          icon={state.busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
          placeholder="Paste a link to create a preview card"
          error={state.error}
          onSubmit={async (value) => {
            setState({ busy: true });
            try {
              const preview = await services.linkPreview(value);
              updateAttributes({ url: preview.url, title: preview.title, description: preview.description, siteName: preview.siteName });
              setState({ busy: false });
            } catch (e) {
              setState({ busy: false, error: e instanceof Error ? e.message : "Couldn't fetch that link." });
            }
          }}
        />
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className={frame(selected)} data-drag-handle>
      <div className="space-y-2 p-3">
        <p className="font-mono text-[11px] uppercase tracking-wider text-subtle">{siteName}</p>
        <input value={title} onChange={(e) => updateAttributes({ title: e.target.value })} className={cn(smallInput, "font-medium")} aria-label="Bookmark title" />
        <textarea value={description} onChange={(e) => updateAttributes({ description: e.target.value })} rows={2} className={smallInput} aria-label="Bookmark description" />
      </div>
      <Toolbar>
        <span className="truncate font-mono text-[11px] text-subtle">{url}</span>
        <span className="flex-1" />
        <IconButton label="Delete bookmark" onClick={deleteNode}>
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      </Toolbar>
    </NodeViewWrapper>
  );
}

export function ButtonView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const { label, href, variant } = node.attrs as { label: string; href: string; variant: string };
  return (
    <NodeViewWrapper className={frame(selected)} data-drag-handle>
      <div className="grid gap-2 p-3 sm:grid-cols-[1fr_2fr_auto]">
        <input value={label} onChange={(e) => updateAttributes({ label: e.target.value })} className={smallInput} placeholder="Button label" aria-label="Button label" />
        <input value={href} onChange={(e) => updateAttributes({ href: e.target.value })} className={cn(smallInput, "font-mono")} placeholder="https://… or /about" aria-label="Button link" />
        <div className="flex gap-1">
          {(["primary", "secondary"] as const).map((v) => (
            <IconButton key={v} label={`Style: ${v}`} active={variant === v} onClick={() => updateAttributes({ variant: v })}>
              {v}
            </IconButton>
          ))}
          <IconButton label="Delete button" onClick={deleteNode}>
            <Trash2 size={13} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export function DocumentPicker({ onPick, exclude = [] }: { onPick: (item: LookupItem) => void; exclude?: string[] }) {
  const services = useEditorServices();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LookupItem[]>([]);
  return (
    <div>
      <input
        value={q}
        onChange={async (e) => {
          setQ(e.target.value);
          setItems(await services.lookup(e.target.value));
        }}
        onFocus={async () => setItems(await services.lookup(q))}
        placeholder="Search documents…"
        className={smallInput}
        aria-label="Search documents to add"
      />
      {items.length > 0 && (
        <ul className="mt-1 max-h-52 overflow-y-auto rounded-xs border border-line bg-elevated">
          {items
            .filter((i) => !exclude.includes(i.id))
            .map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => onPick(item)} className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-surface-2">
                  <span className="truncate">{item.title || "Untitled"}</span>
                  <span className="shrink-0 text-xs text-subtle">
                    {item.typeName}
                    {!item.isPublic && " · not public"}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export function RelatedContentView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const services = useEditorServices();
  const ids = (node.attrs.documentIds as string[]) ?? [];
  const labels = (node.attrs.labels as Record<string, string>) ?? {};
  return (
    <NodeViewWrapper className={frame(selected)} data-drag-handle>
      <div className="space-y-2 p-3">
        <input value={node.attrs.title as string} onChange={(e) => updateAttributes({ title: e.target.value })} className={cn(smallInput, "font-medium")} placeholder="Section title (e.g. Related reading)" aria-label="Related content title" />
        <ul className="space-y-1">
          {ids.map((id) => (
            <li key={id} className="flex items-center justify-between rounded-xs bg-surface-2 px-2.5 py-1.5 text-sm">
              <span className="truncate">{labels[id] ?? services.titles[id] ?? "Document"}</span>
              <button type="button" onClick={() => updateAttributes({ documentIds: ids.filter((x) => x !== id) })} aria-label="Remove" className="text-subtle hover:text-danger">
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {ids.length < 12 && <DocumentPicker exclude={ids} onPick={(item) => updateAttributes({ documentIds: [...ids, item.id], labels: { ...labels, [item.id]: item.title } })} />}
      </div>
      <Toolbar>
        <span className="text-xs text-subtle">Only published, visible documents appear to readers.</span>
        <span className="flex-1" />
        <IconButton label="Delete block" onClick={deleteNode}>
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      </Toolbar>
    </NodeViewWrapper>
  );
}

const TOOLS = { "fire-number": "FI number calculator", "compound-growth": "Compound growth calculator", "savings-rate": "Savings rate → years to FI" } as const;

export function ToolView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper className={frame(selected)} data-drag-handle>
      <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
        <Calculator size={17} className="text-accent" aria-hidden="true" />
        <select value={node.attrs.kind as string} onChange={(e) => updateAttributes({ kind: e.target.value })} className={cn(smallInput, "w-auto")} aria-label="Calculator">
          {Object.entries(TOOLS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-xs text-subtle">Interactive for readers</span>
        <span className="flex-1" />
        <IconButton label="Delete tool" onClick={deleteNode}>
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      </div>
    </NodeViewWrapper>
  );
}
