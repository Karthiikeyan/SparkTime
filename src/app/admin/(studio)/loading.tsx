/**
 * Instant feedback while a studio page renders. Studio pages are dynamic
 * (per-request session + data), so without this boundary a click shows
 * nothing until the server has finished. Next prefetches this fallback, so
 * navigation swaps to it immediately; the sidebar (layout) stays interactive.
 */
export default function StudioLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="border-b border-line px-6 py-6 lg:px-10" aria-hidden="true">
        <div className="h-7 w-44 animate-pulse rounded-sm bg-surface-2" />
        <div className="mt-3 h-4 w-72 max-w-full animate-pulse rounded-sm bg-surface-2/70" />
      </div>
      <div className="space-y-3 px-6 py-8 lg:px-10" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-md border border-line bg-surface" />
        ))}
      </div>
    </div>
  );
}
