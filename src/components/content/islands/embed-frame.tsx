"use client";

import { ExternalLink, MousePointerClick } from "lucide-react";
import { useState } from "react";
import { buildEmbedSrc, EMBED_PROVIDER_LABELS, type EmbedProvider } from "@/lib/embeds";

/** Click-to-load, sandboxed embed from an allowlisted provider. */
export function EmbedFrame({ provider, embedId, title }: { provider: EmbedProvider; embedId: string; title: string }) {
  const [loaded, setLoaded] = useState(false);
  const src = buildEmbedSrc({ provider, id: embedId });
  if (!src) return null;
  const label = EMBED_PROVIDER_LABELS[provider];
  const tall = provider === "spotify" ? "h-[352px]" : "aspect-video";

  return (
    <div className={`relative w-full overflow-hidden rounded-md border border-line bg-surface-2 ${tall}`}>
      {loaded ? (
        <iframe
          src={src}
          title={title || `${label} embed`}
          className="absolute inset-0 size-full"
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      ) : (
        <button type="button" onClick={() => setLoaded(true)} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted hover:text-ink">
          <MousePointerClick size={22} aria-hidden="true" />
          <span className="text-sm font-medium">Load {label} content</span>
          <span className="flex items-center gap-1 text-xs text-subtle">
            <ExternalLink size={12} aria-hidden="true" /> Loads from {label}
          </span>
        </button>
      )}
    </div>
  );
}
