import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardRow } from "@/components/content/cards";
import { SectionHeading } from "@/components/content/listing";
import { SystemPage } from "@/components/pages/system-page";
import { documentMetadata } from "@/server/seo/metadata";
import { getCollectionEntries, getRootPage, type CollectionEntry } from "@/server/services/public-content";
import { loadAllSettings } from "@/server/services/settings";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getRootPage("uses");
  return doc ? documentMetadata(doc) : { title: "Uses", robots: { index: false } };
}

export default async function UsesPage() {
  const [doc, settings] = await Promise.all([getRootPage("uses"), loadAllSettings()]);
  if (!doc) notFound();
  const entries = settings.pages.usesCollectionId ? await getCollectionEntries(settings.pages.usesCollectionId) : [];
  const groups = new Map<string, CollectionEntry[]>();
  for (const e of entries) groups.set(e.groupLabel || "Toolkit", [...(groups.get(e.groupLabel || "Toolkit") ?? []), e]);

  return (
    <SystemPage doc={doc} eyebrow="Toolkit" showUpdated>
      {groups.size > 0 && (
        <div className="mt-16 space-y-14">
          {[...groups.entries()].map(([label, items], i) => (
            <section key={label} aria-label={label}>
              <SectionHeading index={String(i + 1).padStart(2, "0")} title={label} />
              <div className="grid gap-x-10 sm:grid-cols-2">
                {items.map((e) => (
                  <CardRow key={e.card.id} card={e.card} note={e.note || undefined} showType={false} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </SystemPage>
  );
}
