"use client";

import "./globals.css";

/** Last-resort boundary (root layout failed). Kept dependency-free. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink">
        <main className="mx-auto max-w-xl px-6 py-24">
          <p className="eyebrow">Error</p>
          <h1 className="mt-4 font-serif text-4xl">The site hit an unexpected problem.</h1>
          <p className="mt-4 text-muted">Please try again in a moment.</p>
          {process.env.NODE_ENV === "development" && (
            <p className="mt-4 text-sm text-muted">
              Development: the usual cause is the local database not running or unreadable. Check the <code>npm run db:local</code> terminal; the real error is in the <code>npm run dev</code> terminal.
            </p>
          )}
          <button type="button" onClick={reset} className="btn btn-primary mt-8">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
