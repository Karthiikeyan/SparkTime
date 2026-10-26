"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import { youTubeEmbedUrl, youTubeThumbnail, YOUTUBE_ID_PATTERN } from "@/lib/embeds";

/**
 * Click-to-load YouTube: until the reader presses play, the page loads one
 * thumbnail image and no third-party JavaScript or cookies. The iframe uses
 * youtube-nocookie.com and a URL we build from a validated id.
 */
export function YouTubePlayer({ videoId, start = 0, title }: { videoId: string; start?: number; title: string }) {
  const [playing, setPlaying] = useState(false);
  if (!YOUTUBE_ID_PATTERN.test(videoId)) return null;
  const label = title || "YouTube video";

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md border border-line bg-black">
      {playing ? (
        <iframe
          src={youTubeEmbedUrl(videoId, start)}
          title={label}
          className="absolute inset-0 size-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          loading="lazy"
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 size-full" aria-label={`Play video: ${label}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- remote YouTube thumbnail */}
          <img src={youTubeThumbnail(videoId, "hq")} alt="" loading="lazy" decoding="async" width={480} height={360} className="absolute inset-0 size-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          <span className="absolute bottom-4 left-4 right-20 line-clamp-2 text-left text-sm font-medium text-white/95">{title}</span>
          <span className="absolute left-1/2 top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-black shadow-lg transition-transform duration-300 group-hover:scale-105">
            <Play size={24} fill="currentColor" aria-hidden="true" className="ml-1" />
          </span>
          <span className="absolute bottom-4 right-4 rounded-xs bg-black/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/80">YouTube</span>
        </button>
      )}
    </div>
  );
}
