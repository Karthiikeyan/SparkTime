import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/admin-shell";
import { Badge, type BadgeTone } from "@/components/admin/badge";
import { relativeTime } from "@/lib/dates";
import { requireAdminPage } from "@/server/auth/guard";
import { listImportJobs } from "@/server/services/import/jobs";

export const metadata: Metadata = { title: "Import history" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const STATUS_TONE: Record<string, BadgeTone> = { completed: "success", partial: "warning", failed: "danger", running: "info", cancelled: "neutral", analyzed: "accent", staging: "neutral" };
const STATUSES = ["completed", "partial", "failed", "running", "analyzed", "cancelled"];
const SYSTEMS: Record<string, string> = { folder: "Folder", notion: "Notion", obsidian: "Obsidian", "studio-portable": "Studio package", "studio-bundle": "JSON backup" };
const tab = (active: boolean) => (active ? "rounded-sm bg-surface-2 px-2 py-1 font-medium" : "rounded-sm px-2 py-1 text-muted hover:text-ink");

export default async function ImportHistoryPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireAdminPage();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status) ? sp.status : undefined;
  const { items, total } = await listImportJobs(actor, { status, limit: 100 });
  return (
    <div>
      <PageHeader
        title="Import history"
        description="Every import with its result. Open one to see each step, inspect failures and retry them."
        actions={
          <Link href="/admin/import" className="btn btn-accent btn-md">
            New import
          </Link>
        }
      />
      <div className="max-w-6xl space-y-4 px-6 py-6 lg:px-10">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1 text-sm">
          <Link href="/admin/import/history" aria-current={!status ? "page" : undefined} className={tab(!status)}>
            All
          </Link>
          {STATUSES.map((s) => (
            <Link key={s} href={`/admin/import/history?status=${s}`} aria-current={status === s ? "page" : undefined} className={tab(status === s)}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </Link>
          ))}
          <span className="ml-auto self-center text-xs text-subtle">
            {total} import{total === 1 ? "" : "s"}
          </span>
        </nav>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-subtle">
                <th scope="col" className="py-2 font-medium">Source</th>
                <th scope="col" className="py-2 font-medium">Status</th>
                <th scope="col" className="py-2 font-medium">Started</th>
                <th scope="col" className="py-2 text-right font-medium">Created · updated</th>
                <th scope="col" className="py-2 text-right font-medium">Failed</th>
                <th scope="col" className="py-2" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted">
                    No imports yet.{" "}
                    <Link href="/admin/import" className="underline underline-offset-2">
                      Start one
                    </Link>
                    .
                  </td>
                </tr>
              )}
              {items.map((job) => {
                const result = (job.summary.result ?? {}) as Record<string, number>;
                const planned = (job.summary.planned ?? {}) as Record<string, number>;
                const href = job.status === "analyzed" || job.status === "running" ? `/admin/import?job=${job.id}` : `/admin/import/history/${job.id}`;
                return (
                  <tr key={job.id} className="border-b border-line/70">
                    <td className="max-w-[18rem] py-2 pr-3">
                      <p className="truncate font-medium">{job.sourceName || "Untitled import"}</p>
                      <p className="text-xs text-subtle">
                        {job.sourceSystem ? (SYSTEMS[job.sourceSystem] ?? job.sourceSystem) : "Not analysed"} · {job.fileCount} files
                      </p>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={STATUS_TONE[job.status] ?? "neutral"}>{job.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted">{relativeTime(job.startedAt ?? job.createdAt)}</td>
                    <td className="py-2 pr-3 text-right text-xs">
                      {job.completedAt ? (
                        `${result.created ?? 0} · ${result.updated ?? 0}`
                      ) : planned.create !== undefined ? (
                        <span className="text-subtle">
                          planned {planned.create} · {planned.update}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={job.progress.failed ? "py-2 pr-3 text-right text-xs font-medium text-danger" : "py-2 pr-3 text-right text-xs text-subtle"}>{job.progress.failed}</td>
                    <td className="py-2 text-right">
                      <Link href={href} className="text-xs underline underline-offset-2">
                        {job.status === "analyzed" ? "Review" : job.status === "running" ? "Resume" : "Details"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
