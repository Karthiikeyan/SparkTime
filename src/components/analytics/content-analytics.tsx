"use client";

import { useEffect } from "react";
import { newThresholds, readingPercent, READING_THRESHOLDS, trackContentView, trackReadingProgress } from "@/lib/analytics";

/**
 * One content_view per document page view and, on long reads, reading_progress
 * at 25/50/75/90% of the text, each at most once. Measured against the body
 * text (DocContent's .prose, rendered once per document template) only after
 * the reader scrolls, at most once a frame, and the listener goes away once
 * every threshold has fired. Renders nothing; does nothing unless analytics is enabled.
 */
export function ContentAnalytics({ type, slug, title, longRead }: { type: string; slug: string; title: string; longRead: boolean }) {
  useEffect(() => {
    trackContentView({ content_type: type, content_slug: slug, content_title: title });
    const body = longRead ? document.querySelector<HTMLElement>("main article .prose") : null;
    if (!body) return;

    const fired = new Set<number>();
    let frame = 0;
    const stop = () => {
      window.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(frame);
    };
    const measure = () => {
      frame = 0;
      const box = body.getBoundingClientRect();
      for (const percent of newThresholds(readingPercent(box.top, box.height, window.innerHeight), fired)) {
        fired.add(percent);
        trackReadingProgress({ percent, content_type: type, content_slug: slug });
      }
      if (fired.size === READING_THRESHOLDS.length) stop();
    };
    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return stop;
  }, [type, slug, title, longRead]);
  return null;
}
