import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/admin-shell";
import { cn } from "@/lib/cn";
import { requireAdminPage } from "@/server/auth/guard";
import { contentHealthReport } from "@/server/services/content-health";

export const metadata: Metadata = { title: "Content health" };

export default async function ContentHealthPage() {
  const actor = await requireAdminPage();
  const report = await contentHealthReport(actor);
  const groups = [...new Set(report.checks.map((c) => c.group))];
  const { taxonomy } = report;

  return (
    <div>
      <PageHeader
        title="Content health"
        description="Concrete checks across the library, outside the Trash. Each count opens the matching documents, where you can review and act on them in bulk. Nothing here changes content by itself."
      />
      <div className="grid gap-8 px-6 py-8 lg:grid-cols-2 lg:px-10">
        {groups.map((group) => (
          <section key={group} aria-labelledby={`health-${group}`}>
            <h2 id={`health-${group}`} className="border-b border-line pb-2 font-semibold">
              {group}
            </h2>
            <ul className="divide-y divide-line">
              {report.checks
                .filter((c) => c.group === group)
                .map((c) => (
                  <li key={c.key}>
                    <Link href={`/admin/documents?health=${c.key}`} className="group flex items-start gap-4 py-3 hover:text-accent">
                      <span className={cn("w-12 shrink-0 text-right text-xl font-semibold tabular-nums", c.count === 0 ? "text-subtle" : "text-ink")}>{c.count.toLocaleString("en-IN")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{c.label}</span>
                        <span className="block text-sm text-muted">{c.help}</span>
                      </span>
                      <ArrowRight size={16} className="mt-1 shrink-0 text-subtle group-hover:text-accent" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}

        <section aria-labelledby="health-taxonomy" className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <h2 id="health-taxonomy" className="font-semibold">
              Topics and tags
            </h2>
            <Link href="/admin/taxonomy" className="text-sm text-muted hover:text-accent">
              Merge, rename or delete in Topics &amp; tags →
            </Link>
          </div>
          <div className="mt-4 grid gap-6 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <Finding title="Topics with no documents" items={taxonomy.unusedTopics.map((t) => t.name)} empty="Every topic is in use." />
            <Finding title="Topics with nothing published" items={taxonomy.topicsWithoutPublished.map((t) => `${t.name} (${t.documents} unpublished)`)} empty="Every used topic has published work." hint="Hidden from the public site until something is published." />
            <Finding title="Look-alike topics" items={taxonomy.duplicateTopics.map((d) => d.names.join(" · "))} empty="No look-alike topic names." hint="Same name once punctuation and case are ignored. Consider merging." />
            <Finding title="Unused tags" items={taxonomy.unusedTags.map((t) => `#${t.name}`)} empty="Every tag is in use." />
            <Finding title="Look-alike tags" items={taxonomy.duplicateTags.map((d) => d.names.map((n) => `#${n}`).join(" · "))} empty="No look-alike tag names." />
          </div>
        </section>
      </div>
    </div>
  );
}

function Finding({ title, items, empty, hint }: { title: string; items: string[]; empty: string; hint?: string }) {
  return (
    <div>
      <p className="font-medium">
        {title} <span className="font-normal tabular-nums text-muted">({items.length})</span>
      </p>
      {hint && items.length > 0 && <p className="text-xs text-subtle">{hint}</p>}
      {items.length === 0 ? (
        <p className="mt-1 text-muted">{empty}</p>
      ) : (
        <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto text-muted">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
