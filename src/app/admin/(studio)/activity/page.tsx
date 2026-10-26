import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/admin-shell";
import { Badge } from "@/components/admin/badge";
import { BULK_ACTION_TEXT, isBulkActionName } from "@/lib/content/bulk-actions";
import { cn } from "@/lib/cn";
import { formatDate, relativeTime } from "@/lib/dates";
import { requireAdminPage } from "@/server/auth/guard";
import { listActivity, type ActivityEntry } from "@/server/services/audit";

export const metadata: Metadata = { title: "Activity" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SCOPES = [
  { value: "all", label: "Everything" },
  { value: "content", label: "Content" },
  { value: "bulk", label: "Bulk operations" },
] as const;

type Row =
  | { kind: "single"; entry: ActivityEntry }
  | { kind: "operation"; id: string; first: ActivityEntry; action: string; batches: number; requested: number; updated: number; unchanged: number; failed: number; failures: Array<{ title: string; message: string }>; undo?: ActivityEntry };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Bulk operations write one entry per batch; show each operation (and its undo) as one row. */
function group(entries: ActivityEntry[]): Row[] {
  const rows: Row[] = [];
  const byOperation = new Map<string, Extract<Row, { kind: "operation" }>>();
  for (const entry of entries) {
    const operationId = typeof entry.metadata.operationId === "string" ? entry.metadata.operationId : null;
    if (!operationId || !entry.action.startsWith("bulk.")) {
      rows.push({ kind: "single", entry });
      continue;
    }
    let row = byOperation.get(operationId);
    if (!row) {
      row = { kind: "operation", id: operationId, first: entry, action: "", batches: 0, requested: 0, updated: 0, unchanged: 0, failed: 0, failures: [] };
      byOperation.set(operationId, row);
      rows.push(row);
    }
    if (entry.action === "bulk.undo") {
      row.undo = entry;
      continue;
    }
    const m = entry.metadata;
    row.action = typeof m.action === "string" ? m.action : entry.action.slice(5);
    row.batches++;
    row.requested += num(m.requested);
    row.updated += num(m.updated);
    row.unchanged += num(m.unchanged);
    row.failed += num(m.failed);
    if (Array.isArray(m.failures)) row.failures.push(...(m.failures as Array<{ title: string; message: string }>));
    row.first = entry.id < row.first.id ? entry : row.first;
  }
  return rows;
}

const label = (action: string) => action.replace(/^document\./, "").replace(/[._]/g, " ");

export default async function ActivityPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireAdminPage();
  const sp = await searchParams;
  const scope = SCOPES.find((s) => s.value === one(sp.scope))?.value ?? "all";
  const before = Number(one(sp.before)) || undefined;
  const { entries, next } = await listActivity(actor, { scope, before, limit: 150 });
  const rows = group(entries);

  return (
    <div>
      <PageHeader title="Activity" description="Who changed what, newest first. Recorded by the server for every admin change; bulk operations show their counts and failures." />
      <nav aria-label="Filter activity" className="flex gap-1 border-b border-line px-6 py-2 text-sm lg:px-10">
        {SCOPES.map((s) => (
          <Link key={s.value} href={s.value === "all" ? "/admin/activity" : `/admin/activity?scope=${s.value}`} aria-current={scope === s.value ? "page" : undefined} className={cn("rounded-sm px-2.5 py-1", scope === s.value ? "bg-surface-2 font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink")}>
            {s.label}
          </Link>
        ))}
      </nav>
      <ol className="divide-y divide-line px-6 lg:px-10">
        {rows.length === 0 && <li className="py-16 text-center text-muted">Nothing recorded yet.</li>}
        {rows.map((row) => {
          const entry = row.kind === "single" ? row.entry : row.first;
          return (
            <li key={row.kind === "single" ? row.entry.id : row.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:gap-4">
              <time dateTime={entry.createdAt.toISOString()} title={formatDate(entry.createdAt, "medium")} className="w-28 shrink-0 text-muted">
                {relativeTime(entry.createdAt)}
              </time>
              <div className="min-w-0 flex-1">
                {row.kind === "single" ? (
                  <p>
                    <span className="font-medium capitalize">{label(entry.action)}</span>
                    {entry.summary && <span className="text-muted"> — {entry.summary}</span>}
                    {entry.entityType === "document" && entry.entityId && entry.action !== "document.delete" && (
                      <>
                        {" "}
                        <Link href={`/admin/documents/${entry.entityId}`} className="text-subtle hover:text-accent">
                          open
                        </Link>
                      </>
                    )}
                  </p>
                ) : (
                  <>
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">bulk</Badge>
                      <span className="font-medium">{isBulkActionName(row.action) ? BULK_ACTION_TEXT[row.action].verb : row.action}</span>
                      <span className="text-muted">
                        {row.requested.toLocaleString("en-IN")} requested · <span className="text-success">{row.updated.toLocaleString("en-IN")} changed</span>
                        {row.unchanged > 0 && ` · ${row.unchanged.toLocaleString("en-IN")} unchanged`}
                        {row.failed > 0 && <span className="text-danger"> · {row.failed.toLocaleString("en-IN")} failed</span>}
                        {row.batches > 1 && ` · ${row.batches} batches`}
                      </span>
                      {row.undo && <Badge tone="warning">undone</Badge>}
                    </p>
                    {row.undo && <p className="text-muted">{row.undo.summary}</p>}
                    {row.failures.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-muted">Failures</summary>
                        <ul className="mt-1 space-y-0.5">
                          {row.failures.slice(0, 100).map((f, i) => (
                            <li key={i}>
                              {f.title} — <span className="text-muted">{f.message}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </div>
              <span className="shrink-0 text-xs text-subtle">{entry.actor ?? "system"}</span>
            </li>
          );
        })}
      </ol>
      {next && (
        <div className="px-6 py-6 lg:px-10">
          <Link href={`/admin/activity?${new URLSearchParams({ ...(scope !== "all" ? { scope } : {}), before: String(next) })}`} className="link-quiet text-sm">
            Older activity →
          </Link>
        </div>
      )}
    </div>
  );
}
