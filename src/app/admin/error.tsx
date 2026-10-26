"use client";

import { useEffect } from "react";

/**
 * Studio error page. Production hides the cause of a server error from the browser (it arrives as
 * React error #441 with only a digest), so this shows the digest to quote and points at the
 * owner-only health check, which reports the real failing query. It shows no server detail itself.
 */
export default function StudioError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[studio]", error.digest ? `digest ${error.digest}` : error.message);
  }, [error]);

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-8 shadow-float">
        <p className="font-serif text-2xl">
          Studio<span className="text-accent">.</span>
        </p>
        <h1 className="mt-6 text-lg font-semibold">The studio couldn&apos;t load this page</h1>
        <p className="mt-2 text-sm text-muted">
          The server hit a problem while preparing it. Your content is safe, and public pages are not affected. Try again in a moment.
        </p>
        {error.digest && (
          <p className="mt-4 text-xs text-subtle">
            Error reference: <code className="font-mono">{error.digest}</code>
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={reset} className="btn btn-primary">
            Try again
          </button>
          {/* A full-page navigation to a JSON route, so a plain anchor (next/link would fetch it as a page). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/admin/health" className="text-sm underline underline-offset-4">
            Run the health check
          </a>
        </div>
      </div>
    </main>
  );
}
