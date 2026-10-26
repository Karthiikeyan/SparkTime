import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { cardsByIds, listPublished, type Card } from "./public-content";

/**
 * "Continue exploring" — an explainable relevance score, not randomness:
 *
 *   explicit relation (either direction)  +100
 *   in the same curated collection          +20
 *   each shared category                   +12
 *   each shared tag (max 5)                 +8
 *   same content type                       +4
 *   featured                                +3
 *   curated priority (clamped ±10)        ±10
 *
 * Only listed documents are candidates. Results are diversified so one
 * content type cannot crowd out everything else.
 */
export const RELEVANCE_WEIGHTS = { relation: 100, collection: 20, category: 12, tag: 8, sameType: 4, featured: 3 } as const;

export type Recommendation = Card & { score: number; reasons: string[] };

type ScoredRow = { id: string; score: number; related: boolean; shared_collection: boolean; shared_cats: number; shared_tags: number; same_type: boolean };

/** `exclude`: pieces the page already offers (its series, neighbours, connections, a collection's own items). */
export async function recommendFor(doc: { id: string; typeId: string }, limit = 6, exclude: Iterable<string> = []): Promise<Recommendation[]> {
  const w = RELEVANCE_WEIGHTS;
  const skip = new Set(exclude);
  const result = await getDb().execute(sql`
    with
      src_cats as (select category_id from studio.document_categories where document_id = ${doc.id}),
      src_tags as (select tag_id from studio.document_tags where document_id = ${doc.id}),
      -- Collections this piece sits in: the owner already said these belong together.
      src_cols as (
        select ci.collection_id from studio.collection_items ci
        inner join studio.documents collection on collection.id = ci.collection_id
        where ci.document_id = ${doc.id} and collection.status = 'published' and collection.visibility = 'public'
      ),
      rel as (
        select case when source_id = ${doc.id} then target_id else source_id end as id
        from studio.document_relations
        where source_id = ${doc.id} or target_id = ${doc.id}
      ),
      candidates as (
        select d.id, d.type_id, d.featured, d.priority,
          exists (select 1 from rel where rel.id = d.id) as related,
          exists (select 1 from studio.collection_items ci where ci.document_id = d.id and ci.collection_id in (select collection_id from src_cols)) as shared_collection,
          (select count(*) from studio.document_categories dc where dc.document_id = d.id and dc.category_id in (select category_id from src_cats))::int as shared_cats,
          least(5, (select count(*) from studio.document_tags dt where dt.document_id = d.id and dt.tag_id in (select tag_id from src_tags)))::int as shared_tags
        from studio.documents d
        where d.id <> ${doc.id} and d.status = 'published' and d.visibility = 'public'
          and d.type_id not in (select id from studio.content_types where routing = 'root')
      )
    select id,
      (case when related then ${w.relation} else 0 end)
      + (case when shared_collection then ${w.collection} else 0 end)
      + ${w.category} * shared_cats
      + ${w.tag} * shared_tags
      + (case when type_id = ${doc.typeId} then ${w.sameType} else 0 end)
      + (case when featured then ${w.featured} else 0 end)
      + greatest(-10, least(10, priority))
      as score,
      related, shared_collection, shared_cats, shared_tags, (type_id = ${doc.typeId}) as same_type
    from candidates
    where related or shared_collection or shared_cats > 0 or shared_tags > 0
    order by score desc, id
    limit ${40 + skip.size}
  `);
  const rows = ((Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as ScoredRow[]).filter((r) => !skip.has(r.id));
  const cards = new Map((await cardsByIds(rows.map((r) => r.id), "listed")).map((c) => [c.id, c]));

  const picked: Recommendation[] = [];
  const perType = new Map<string, number>();
  const maxPerType = Math.max(2, Math.ceil(limit / 2));
  for (const row of rows) {
    const card = cards.get(row.id);
    if (!card) continue;
    const used = perType.get(card.type.id) ?? 0;
    if (used >= maxPerType && !row.related) continue;
    perType.set(card.type.id, used + 1);
    const reasons: string[] = [];
    if (row.related) reasons.push("Connected");
    if (row.shared_collection) reasons.push("Same collection");
    if (row.shared_cats > 0) reasons.push("Same topic");
    if (row.shared_tags > 0) reasons.push(`${row.shared_tags} shared tag${row.shared_tags > 1 ? "s" : ""}`);
    picked.push({ ...card, score: Number(row.score), reasons });
    if (picked.length >= limit) break;
  }

  // Sparse graph: offer curated pieces without claiming a topical connection.
  if (picked.length < Math.min(3, limit)) {
    const exclude = [doc.id, ...skip, ...picked.map((p) => p.id)];
    const sameType = await listPublished({ typeIds: [doc.typeId], excludeIds: exclude, limit: limit - picked.length, order: "library" });
    for (const card of sameType.items) picked.push({ ...card, score: 0, reasons: ["More to explore"] });
    if (picked.length < Math.min(3, limit)) {
      const any = await listPublished({ excludeIds: [...exclude, ...picked.map((p) => p.id)], limit: limit - picked.length, order: "curated" });
      for (const card of any.items) picked.push({ ...card, score: 0, reasons: ["Worth exploring"] });
    }
  }
  return picked.slice(0, limit);
}
