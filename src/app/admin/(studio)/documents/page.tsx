import { X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/admin-shell";
import { ContentOperations } from "@/components/admin/content-operations";
import { inputBase } from "@/components/admin/styles";
import { NewDocumentButton } from "@/components/admin/new-document-button";
import { cn } from "@/lib/cn";
import { DOCUMENT_STATUSES, STATUS_LABELS, VISIBILITIES, VISIBILITY_LABELS } from "@/lib/content/model";
import { requireAdminPage } from "@/server/auth/guard";
import { HEALTH_CHECKS, isHealthCheck } from "@/server/services/content-health";
import { collectionOptions } from "@/server/services/content-ops";
import { listContentTypes } from "@/server/services/content-types";
import { AGE_FILTER_DAYS, FILTER_PARAMS, listDocuments, parseDocumentFilters, type FilterParams } from "@/server/services/documents";
import { listCategories, listTags } from "@/server/services/taxonomy";

export const metadata: Metadata = { title: "Documents" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const filterSize = "h-9 px-2.5 text-sm";
const PER_PAGE = 50;

/** Built-in views: plain links to filter combinations, so they are shareable and need no storage. */
const VIEWS: Array<{ label: string; params: FilterParams }> = [
  { label: "All", params: {} },
  { label: "Drafts", params: { status: "draft" } },
  { label: "Recently published", params: { status: "published", sort: "published" } },
  { label: "Unfinished", params: { health: "placeholder" } },
  { label: "Missing description", params: { health: "no-description" } },
  { label: "Broken links", params: { health: "broken-links" } },
  { label: "Not revised in a year", params: { health: "stale" } },
  { label: "Least recently edited", params: { sort: "updated_asc" } },
];

const qs = (params: FilterParams, page?: number) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as Array<[string, string]>);
  if (page && page > 1) s.set("page", String(page));
  const text = s.toString();
  return `/admin/documents${text ? `?${text}` : ""}`;
};

export default async function DocumentsPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireAdminPage();
  const sp = await searchParams;
  const params: FilterParams = Object.fromEntries(FILTER_PARAMS.map((key) => [key, one(sp[key]) || undefined]).filter(([, v]) => v));
  // The Trash has its own page; this list never shows it.
  if (params.status === "trashed") delete params.status;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [types, categories, tags, collections, result] = await Promise.all([
    listContentTypes(),
    listCategories(),
    listTags(),
    collectionOptions(actor),
    listDocuments(actor, { ...parseDocumentFilters(params), limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / PER_PAGE));
  const health = isHealthCheck(params.health) ? HEALTH_CHECKS[params.health] : null;
  const viewKey = (p: FilterParams) => JSON.stringify(Object.entries(p).filter(([, v]) => v).sort());
  const activeView = VIEWS.find((v) => viewKey(v.params) === viewKey(params));
  // A filter change remounts the operations island, which clears its selection; paging within a filter keeps it.
  const filterKey = qs(params);

  return (
    <div>
      <PageHeader
        title="Documents"
        description={`${result.total.toLocaleString("en-IN")} document${result.total === 1 ? "" : "s"}${Object.keys(params).length ? ` ${result.total === 1 ? "matches" : "match"} these filters` : " across every content type"}.`}
        actions={<NewDocumentButton types={types.filter((t) => !t.archivedAt).map((t) => ({ id: t.id, name: t.name }))} />}
      />
      <nav aria-label="Views" className="flex gap-1 overflow-x-auto border-b border-line px-6 py-2 text-sm lg:px-10">
        {VIEWS.map((v) => (
          <Link key={v.label} href={qs(v.params)} aria-current={activeView === v ? "page" : undefined} className={cn("shrink-0 rounded-sm px-2.5 py-1", activeView === v ? "bg-surface-2 font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink")}>
            {v.label}
          </Link>
        ))}
        <Link href="/admin/content-health" className="ml-auto shrink-0 rounded-sm px-2.5 py-1 text-muted hover:bg-surface-2 hover:text-ink">
          Content health
        </Link>
        <Link href="/admin/trash" className="shrink-0 rounded-sm px-2.5 py-1 text-muted hover:bg-surface-2 hover:text-ink">
          Trash
        </Link>
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-2 border-b border-line px-6 py-4 lg:px-10" role="search" aria-label="Filter documents">
        <label className="sr-only" htmlFor="f-q">
          Search
        </label>
        <input id="f-q" name="q" defaultValue={params.q} placeholder="Search title or slug…" className={`${inputBase} ${filterSize} min-w-40 flex-1 basis-full sm:basis-40`} />
        <select name="type" defaultValue={params.type ?? ""} className={`${inputBase} ${filterSize}`} aria-label="Type">
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={params.status ?? ""} className={`${inputBase} ${filterSize}`} aria-label="Status">
          <option value="">Any status</option>
          {DOCUMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select name="visibility" defaultValue={params.visibility ?? ""} className={`${inputBase} ${filterSize}`} aria-label="Visibility">
          <option value="">Any visibility</option>
          {VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {VISIBILITY_LABELS[v]}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={params.category ?? ""} className={`${inputBase} ${filterSize} max-w-44`} aria-label="Topic">
          <option value="">Any topic</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parentId ? "— " : ""}
              {c.name}
            </option>
          ))}
        </select>
        <select name="tag" defaultValue={params.tag ?? ""} className={`${inputBase} ${filterSize} max-w-40`} aria-label="Tag">
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.name}
            </option>
          ))}
        </select>
        <select name="featured" defaultValue={params.featured ?? ""} className={`${inputBase} ${filterSize}`} aria-label="Featured">
          <option value="">Featured or not</option>
          <option value="yes">Featured</option>
          <option value="no">Not featured</option>
        </select>
        <select name="stale" defaultValue={params.stale ?? ""} className={`${inputBase} ${filterSize}`} aria-label="Last edited">
          <option value="">Edited any time</option>
          {AGE_FILTER_DAYS.map((d) => (
            <option key={d} value={d}>
              Not edited in {d} days
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={params.sort ?? "updated"} className={`${inputBase} ${filterSize}`} aria-label="Sort">
          <option value="updated">Recently edited</option>
          <option value="updated_asc">Least recently edited</option>
          <option value="created">Newest</option>
          <option value="created_asc">Oldest</option>
          <option value="published">Recently published</option>
          <option value="title">Title A–Z</option>
          <option value="words">Longest first</option>
        </select>
        {params.health && <input type="hidden" name="health" value={params.health} />}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary btn-md">
            Apply
          </button>
          <Link href="/admin/documents" className="btn btn-ghost btn-md">
            Reset
          </Link>
        </div>
      </form>
      {health && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-warning/5 px-6 py-2.5 text-sm lg:px-10">
          <span className="font-medium">Health check: {health.label}</span>
          <span className="text-muted">— {health.help}</span>
          <Link href={qs({ ...params, health: undefined })} className="ml-auto inline-flex items-center gap-1 rounded-sm px-2 py-1 text-muted hover:bg-surface-2 hover:text-ink">
            <X size={13} aria-hidden="true" /> Remove
          </Link>
        </div>
      )}

      <ContentOperations
        key={filterKey}
        mode="documents"
        total={result.total}
        filter={Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>}
        rows={result.items.map((d) => ({
          id: d.id,
          title: d.title,
          path: d.path,
          typeName: d.typeName,
          status: d.status,
          visibility: d.visibility,
          robotsIndex: d.robotsIndex,
          typeIndexable: d.typeIndexable,
          featured: d.featured,
          hasStagedChanges: d.hasStagedChanges,
          publishedAt: d.publishedAt?.toISOString() ?? null,
          updatedAt: d.updatedAt.toISOString(),
          trashedAt: null,
          trashedBy: null,
        }))}
        options={{
          topics: categories.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, name: c.parentId ? `${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}` : c.name })),
          tags: tags.map((t) => ({ id: t.id, name: t.name })),
          collections,
        }}
      />

      {pages > 1 && (
        <nav className="flex items-center justify-between px-6 pb-8 text-sm lg:px-10" aria-label="Pagination">
          {page > 1 ? <Link href={qs(params, page - 1)} className="link-quiet">← Previous</Link> : <span />}
          <span className="text-subtle">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={qs(params, page + 1)} className="link-quiet">Next →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
