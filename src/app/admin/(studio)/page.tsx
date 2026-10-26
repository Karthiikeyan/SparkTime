import { AlertTriangle, ArrowRight, FileText, Lightbulb } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/admin-shell";
import { QuickCapture } from "@/components/admin/quick-capture";
import { Badge, statusTone } from "@/components/admin/badge";
import { relativeTime } from "@/lib/dates";
import { requireAdminPage } from "@/server/auth/guard";
import { mediaConfig } from "@/server/env";
import { isGitHubConfigured } from "@/server/auth/github";
import { unreadCount } from "@/server/services/contact";
import { listContentTypes } from "@/server/services/content-types";
import { dashboardStats, listDocuments, placeholderDocuments } from "@/server/services/documents";
import { loadAllSettings } from "@/server/services/settings";

export const metadata: Metadata = { title: "Desk" };

function usesR2(): boolean {
  try {
    return mediaConfig().driver === "r2";
  } catch {
    return false; // production without R2 configured — shown as a to-do, never a crash
  }
}

export default async function DashboardPage() {
  const actor = await requireAdminPage();
  const [stats, recent, drafts, ideas, placeholders, types, unread, settings] = await Promise.all([
    dashboardStats(actor),
    listDocuments(actor, { limit: 8 }),
    listDocuments(actor, { status: "draft", limit: 5 }),
    listDocuments(actor, { status: "idea", limit: 6 }),
    placeholderDocuments(actor),
    listContentTypes(),
    unreadCount(actor),
    loadAllSettings(),
  ]);
  const setup = [
    { done: settings.profiles.some((p) => p.enabled), label: "Confirm and enable your social profiles", href: "/admin/settings#profiles" },
    { done: Boolean(settings.identity.imageMediaId), label: "Add a portrait (used on /about and in structured data)", href: "/admin/settings#identity" },
    { done: Boolean(settings.seo.googleSiteVerification), label: "Verify the site in Google Search Console", href: "/admin/settings#seo" },
    { done: usesR2(), label: "Connect Cloudflare R2 for media (required in production)", href: "/admin/settings#system" },
    { done: isGitHubConfigured(), label: "Configure GitHub sign-in", href: "/admin/settings#system" },
  ];
  const quickTypes = types.filter((t) => t.showInQuickCreate && !t.archivedAt);

  return (
    <div>
      <PageHeader title="Desk" />
      <div className="grid gap-8 px-6 py-8 lg:grid-cols-3 lg:px-10">
        <section className="space-y-8 lg:col-span-2">
          <QuickCapture types={quickTypes.map((t) => ({ id: t.id, name: t.name }))} defaultTypeId={types.find((t) => t.slug === "note")?.id ?? quickTypes[0]?.id ?? ""} />

          {drafts.items.length > 0 && (
            <section aria-labelledby="continue-writing">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h2 id="continue-writing" className="font-semibold">Continue writing</h2>
                <Link href="/admin/documents?status=draft" className="text-sm text-muted hover:text-accent">All drafts</Link>
              </div>
              <ul className="divide-y divide-line">
                {drafts.items.map((draft) => (
                  <li key={draft.id}>
                    <Link href={`/admin/documents/${draft.id}`} className="flex items-center gap-3 py-4 hover:text-accent">
                      <FileText size={16} className="shrink-0 text-subtle" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-medium">{draft.title || "Untitled"}</span>
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-line py-3">
            {(["published", "draft", "idea", "scheduled"] as const).map((s) => (
              <Link key={s} href={`/admin/documents?status=${s}`} className="inline-flex items-baseline gap-2 py-1 text-sm hover:text-accent">
                <span className="font-medium tabular-nums">{stats.byStatus[s] ?? 0}</span>
                <span className="capitalize text-muted">{s === "idea" ? "Ideas" : s}</span>
              </Link>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Recently edited</h2>
              <Link href="/admin/documents" className="text-sm text-muted hover:text-accent">
                All documents →
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {recent.items.length === 0 && <li className="p-6 text-center text-sm text-muted">No documents yet. Capture an idea above or press “New”.</li>}
              {recent.items.map((d) => (
                <li key={d.id}>
                  <Link href={`/admin/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <FileText size={15} className="shrink-0 text-subtle" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{d.title || "Untitled"}</span>
                    {d.hasStagedChanges && <Badge tone="warning">staged</Badge>}
                    <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                    <span className="hidden w-24 text-right text-xs text-subtle sm:block">{d.typeName}</span>
                    <span className="hidden w-24 text-right text-xs text-subtle md:block">{relativeTime(d.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="space-y-6">
          {placeholders.length > 0 && (
            <div className="rounded-md border border-warning/50 bg-warning/5 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={15} className="text-warning" aria-hidden="true" /> Before visitors arrive
              </p>
              <p className="mt-1 text-xs text-muted">
                [TODO] markers to replace, and documents still named after their own type — test pieces are fine in the studio, but published they fill the home page, the Library and the feed.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {placeholders.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/documents/${p.id}`} className="truncate hover:text-accent">
                      {p.title}
                    </Link>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {p.reason === "demo" && <Badge tone="warning">demo?</Badge>}
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/admin/documents?health=placeholder" className="mt-3 inline-block text-xs text-muted hover:text-accent">
                Select and fix them in bulk →
              </Link>
            </div>
          )}

          <div className="rounded-md border border-line bg-surface p-4">
            <p className="text-sm font-semibold">Launch checklist</p>
            <ul className="mt-3 space-y-2 text-sm">
              {setup.map((s) => (
                <li key={s.label} className="flex items-start gap-2">
                  <span className={s.done ? "text-success" : "text-subtle"} aria-hidden="true">
                    {s.done ? "✓" : "○"}
                  </span>
                  <Link href={s.href} className={s.done ? "text-muted line-through" : "hover:text-accent"}>
                    {s.label}
                  </Link>
                  <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Lightbulb size={15} className="text-accent" aria-hidden="true" /> Ideas
              </p>
              <Link href="/admin/ideas" className="text-xs text-muted hover:text-accent">
                Backlog <ArrowRight size={11} className="inline" aria-hidden="true" />
              </Link>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {ideas.items.length === 0 && <li className="text-muted">No ideas waiting.</li>}
              {ideas.items.map((i) => (
                <li key={i.id}>
                  <Link href={`/admin/documents/${i.id}`} className="block truncate hover:text-accent">
                    {i.title || "Untitled idea"}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Link href="/admin/inbox" className="rounded-md border border-line bg-surface p-4 hover:border-accent">
              <p className="text-2xl font-semibold tabular-nums">{unread}</p>
              <p className="mt-1 text-muted">Unread messages</p>
            </Link>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="text-2xl font-semibold tabular-nums">{stats.publishedWords.toLocaleString("en-IN")}</p>
              <p className="mt-1 text-muted">Words published</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
