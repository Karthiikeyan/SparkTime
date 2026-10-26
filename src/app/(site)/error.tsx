"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="container-narrow py-24">
      <p className="eyebrow">Something broke</p>
      <h1 className="mt-4 font-serif text-headline font-normal">That didn’t load properly.</h1>
      <p className="mt-5 text-lead text-muted">It’s on my side, not yours. Try again, or head back home.</p>
      {error.digest && <p className="mt-3 font-mono text-xs text-subtle">Reference: {error.digest}</p>}
      <div className="mt-8 flex gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-ghost">
          Home
        </Link>
      </div>
    </div>
  );
}
