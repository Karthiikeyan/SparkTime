import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/admin-shell";
import { Badge, type BadgeTone } from "@/components/admin/badge";
import { ImportJobActions } from "@/components/admin/import/job-actions";
import { isUuid } from "@/lib/content/blocks";
import { formatDate } from "@/lib/dates";
import { requireAdminPage } from "@/server/auth/guard";
import { isServiceError } from "@/server/errors";
import { getImportJob, listImportItems } from "@/server/services/import/jobs";

export const metadata: Metadata = { title: "Import details" };

type Params = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

const TONE: Record<string, BadgeTone> = { done: "success", failed: "danger", pending: "info", skipped: "neutral", cancelled: "neutral", completed: "success", partial: "warning", running: "info", analyzed: "accent" };
const STAGE: Record<string, string> = { asset: "Media", topic: "Topic", tag: "Tag", document: "Document", collection: "Collection", relations: "Relationships", finalize: "Links", links: "Backlinks", status: "Status", verify: "Verify" };
const ITEM_STATUSES = ["failed", "done", "pending", "cancelled"];
const tab = (active: boolean) => (active ? "rounded-sm bg-surface-2 px-2 py-1 font-medium" : "rounded-sm px-2 py-1 text-muted hover:text-ink");

export default async function ImportJobPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const actor = await requireAdminPage();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && ITEM_STATUSES.includes(sp.status) ? sp.status : undefined;
  let job;
  try {
    job = await getImportJob(actor, id);
  } catch (error) {
    if (isServiceError(error) && error.code === "not_found") notFound();
    throw error;
  }
  const { items, total } = await listImportItems(actor, id, { status, limit: 500 });
  const result = (job.summary.result ?? {}) as Record<string, number>;
  const planned = (job.summary.planned ?? {}) as Record<string, number>;
  const stats: Array<[string, number | undefined]> = [
    ["Planned new", planned.create],
    ["Planned updates", planned.update],
    ["Planned skips", planned.skip],
    ["Created", result.created],
    ["Updated", result.updated],
    ["Copied", result.copied],
    ["Topics created", result.topicsCreated],
    ["Tags created", result.tagsCreated],
    ["Media uploaded", result.mediaUploaded],
    ["Published", result.published],
    ["Failed steps", job.progress.failed],
    ["Plan warnings", planned.warnings],
  ];
  return (
    <div>
      <PageHeader
        title={job.sourceName || "Import"}
        description={`Started ${formatDate(job.startedAt ?? job.createdAt)}${job.completedAt ? ` · finished ${formatDate(job.completedAt)}` : ""}`}
        actions={<ImportJobActions id={job.id} status={job.status} failed={job.progress.failed} />}
      />
      <div className="max-w-6xl space-y-6 px-6 py-6 lg:px-10">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={TONE[job.status] ?? "neutral"}>{job.status}</Badge>
          <span className="text-muted">
            {job.sourceSystem ?? "—"}
            {job.schemaVersion ? ` · format v${job.schemaVersion}` : ""} · {job.fileCount} files · {job.progress.done} of {job.progress.total} steps done
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
          {stats
            .filter(([, v]) => v !== undefined)
            .map(([label, value]) => (
              <div key={label} className="rounded-sm border border-line px-3 py-2">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-lg font-semibold">{value}</dd>
              </div>
            ))}
        </dl>
        <section aria-labelledby="steps-heading" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="steps-heading" className="font-medium">
              Steps
            </h2>
            <nav aria-label="Filter steps" className="flex flex-wrap gap-1 text-sm">
              <Link href={`/admin/import/history/${id}`} className={tab(!status)}>
                All
              </Link>
              {ITEM_STATUSES.map((s) => (
                <Link key={s} href={`/admin/import/history/${id}?status=${s}`} className={tab(status === s)}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </Link>
              ))}
            </nav>
            <span className="ml-auto text-xs text-subtle">{total}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-subtle">
                  <th scope="col" className="py-2 font-medium">Step</th>
                  <th scope="col" className="py-2 font-medium">Item</th>
                  <th scope="col" className="py-2 font-medium">Action</th>
                  <th scope="col" className="py-2 font-medium">Result</th>
                  <th scope="col" className="py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key} className="border-b border-line/70 align-top">
                    <td className="py-2 pr-3 text-xs text-muted">{STAGE[item.stage] ?? item.stage}</td>
                    <td className="max-w-[22rem] py-2 pr-3">
                      <p className="truncate">{item.label}</p>
                      {item.error && <p className="mt-0.5 text-xs text-danger">{item.error}</p>}
                    </td>
                    <td className="py-2 pr-3 text-xs">{item.action}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={TONE[item.status] ?? "neutral"}>{item.status}</Badge>
                      {item.attempts > 1 && <span className="ml-1 text-xs text-subtle">{item.attempts} attempts</span>}
                    </td>
                    <td className="py-2 text-right text-xs">
                      {item.stage === "document" && item.targetId && item.status === "done" && (
                        <Link href={`/admin/documents/${item.targetId}`} className="underline underline-offset-2">
                          Open
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-muted">
                      {job.status === "analyzed" || job.status === "staging" ? "Not approved yet — nothing has been written." : "No steps match."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        {job.error && <p className="text-sm text-danger">{job.error}</p>}
      </div>
    </div>
  );
}
