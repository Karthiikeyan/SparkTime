import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/site/brand-mark";
import { isDevLoginEnabled } from "@/server/auth/allowlist";
import { isGitHubConfigured } from "@/server/auth/github";
import { getAdminActor } from "@/server/auth/guard";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

const ERRORS: Record<string, string> = {
  state: "The sign-in request expired or was tampered with. Please try again.",
  github: "GitHub didn't complete the sign-in. Please try again.",
  "not-allowed": "That GitHub account isn't allowed to manage this site.",
  "not-configured": "GitHub sign-in isn't configured yet (see README → Authentication).",
  "rate-limited": "Too many sign-in attempts. Wait a few minutes and try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAdminActor()) redirect("/admin");
  const { error } = await searchParams;
  const message = error ? ERRORS[error] ?? "Sign-in failed." : null;
  const github = isGitHubConfigured();
  const dev = isDevLoginEnabled();

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8 shadow-float">
        <p className="flex items-center gap-3 font-serif text-2xl">
          <BrandMark className="h-9 shrink-0" />
          <span>
            Studio<span className="text-accent">.</span>
          </span>
        </p>
        <h1 className="mt-6 text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">This area is only for the site owner.</p>
        {message && (
          <p role="alert" className="mt-5 rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            {message}
          </p>
        )}
        <div className="mt-6 space-y-3">
          {github ? (
            // A full-page navigation to the OAuth start route (not a client-side route).
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/api/auth/github" className="btn btn-primary w-full">
              Continue with GitHub
            </a>
          ) : (
            <p className="rounded-sm bg-surface-2 px-3 py-2 text-xs text-muted">GitHub OAuth is not configured. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and ADMIN_GITHUB_ID in your environment.</p>
          )}
          {dev && (
            <form action="/api/auth/dev-login" method="post">
              <button type="submit" className="btn btn-ghost w-full">
                Local development sign-in
              </button>
              <p className="mt-2 text-center text-xs text-subtle">Only available with NODE_ENV=development and AUTH_DEV_LOGIN=true.</p>
            </form>
          )}
        </div>
        <p className="mt-8 text-center text-xs text-subtle">
          <Link href="/" className="hover:text-ink">
            ← Back to the site
          </Link>
        </p>
      </div>
    </main>
  );
}
