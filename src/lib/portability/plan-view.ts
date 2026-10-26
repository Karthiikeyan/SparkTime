/**
 * The preview the browser receives: everything the summary and the document
 * table need, without per-reference detail. Full detail for one document is
 * fetched on demand, so even a 1,000-document plan stays a small response.
 */
import type { Issue } from "./model";
import type { DocumentPlan, ImportPlan } from "./plan-types";

export type DocumentRow = Pick<
  DocumentPlan,
  "key" | "sourcePath" | "sourceFormat" | "synthetic" | "title" | "titleFrom" | "slug" | "slugFrom" | "typeSlug" | "typeFrom" | "action" | "updateFields" | "clearFields" | "status" | "visibility" | "statusFrom" | "robotsIndex" | "robotsFrom" | "topicKeys" | "tagKeys" | "collectionKey" | "wordCount"
> & {
  conflict: DocumentPlan["conflict"];
  position: number | null;
  errors: number;
  warnings: number;
  firstIssue: string | null;
  unresolvedRefs: number;
  mediaMissing: number;
};

export type PlanView = Omit<ImportPlan, "documents"> & { documents: DocumentRow[] };

function counts(issues: Issue[]) {
  return {
    errors: issues.filter((i) => i.level === "error").length,
    warnings: issues.filter((i) => i.level === "warning").length,
    firstIssue: (issues.find((i) => i.level === "error") ?? issues.find((i) => i.level === "warning"))?.message ?? null,
  };
}

export function toPlanView(plan: ImportPlan): PlanView {
  const positions = new Map<string, number>();
  for (const c of plan.collections) for (const item of c.items) positions.set(item.documentKey, item.position + 1);
  const missingMedia = new Set(plan.media.filter((m) => m.action !== "upload" && m.action !== "reuse").map((m) => m.key));
  return {
    ...plan,
    documents: plan.documents.map((d) => ({
      key: d.key,
      sourcePath: d.sourcePath,
      sourceFormat: d.sourceFormat,
      synthetic: d.synthetic,
      title: d.title,
      titleFrom: d.titleFrom,
      slug: d.slug,
      slugFrom: d.slugFrom,
      typeSlug: d.typeSlug,
      typeFrom: d.typeFrom,
      action: d.action,
      updateFields: d.updateFields,
      clearFields: d.clearFields,
      status: d.status,
      visibility: d.visibility,
      statusFrom: d.statusFrom,
      robotsIndex: d.robotsIndex,
      robotsFrom: d.robotsFrom,
      topicKeys: d.topicKeys,
      tagKeys: d.tagKeys,
      collectionKey: d.collectionKey,
      wordCount: d.wordCount,
      conflict: d.conflict,
      position: positions.get(d.key) ?? null,
      ...counts(d.issues),
      unresolvedRefs: d.refs.filter((r) => r.resolution.status === "unresolved" || r.resolution.status === "ambiguous").length,
      mediaMissing: d.mediaRefs.filter((m) => m.mediaKey && missingMedia.has(m.mediaKey)).length,
    })),
  };
}
