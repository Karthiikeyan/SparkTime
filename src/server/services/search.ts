import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { isUuid } from "@/lib/content/blocks";
import { kindOf } from "@/lib/content/kind";
import { documentPath } from "@/lib/content/paths";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb } from "../db/client";
import { listContentTypes } from "./content-types";
import { listCategories } from "./taxonomy";
import { descendantIds } from "./public-content";
import { clampInt } from "@/lib/numbers";

/**
 * Postgres full-text search (weighted tsvector: title A, excerpt/taxonomy B,
 * body D) with prefix matching for as-you-type results and a trigram fallback
 * for typos. No external search service.
 *
 * Injection safety: user input never reaches to_tsquery syntax directly. It is
 * reduced to letter/number tokens, each suffixed with ":*" and joined with "&";
 * the resulting string is then passed as a bound parameter.
 */

export const HIGHLIGHT_START = "⟦";
export const HIGHLIGHT_END = "⟧";
const MAX_TOKENS = 8;

export function toPrefixTsQuery(input: string): string | null {
  const tokens = (input.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length <= 40).slice(0, MAX_TOKENS);
  if (!tokens.length) return null;
  return tokens.map((t) => `${t}:*`).join(" & ");
}

export type SearchResult = {
  id: string;
  title: string;
  path: string;
  typeName: string;
  typeSlug: string;
  snippet: string;
  rank: number;
  status?: string;
  visibility?: string;
};

export type SearchOptions = { typeSlug?: string; /** Course, guide or interview pages, whatever content types those are. */ kind?: "course" | "guide" | "interview"; categorySlug?: string; limit?: number; offset?: number };

type Row = { id: string; title: string; slug: string; type_id: string; snippet: string | null; rank: number; status: string; visibility: string };

async function runSearch(q: string, scope: SQL, limit: number, offset = 0): Promise<SearchResult[]> {
  const text = q.trim().slice(0, 120);
  const tsquery = toPrefixTsQuery(text);
  if (!tsquery) return [];
  const headlineOpts = `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, MaxWords=26, MinWords=10, MaxFragments=1, ShortWord=2`;

  const result = await getDb().execute(sql`
    with q as (select to_tsquery('english', ${tsquery}) as query),
    matching_context as (
      select context.id from studio.documents context, q
      where context.status = 'published' and context.visibility = 'public'
        and context.search_vector @@ q.query
        and to_tsvector('english', context.title) @@ q.query
    ),
    connected as (
      select ci.document_id as id from studio.collection_items ci
      inner join matching_context context on context.id = ci.collection_id
      union
      select relation.source_id as id from studio.document_relations relation
      inner join matching_context context on context.id = relation.target_id
      union
      select relation.target_id as id from studio.document_relations relation
      inner join matching_context context on context.id = relation.source_id
    )
    select d.id, d.title, d.slug, d.type_id, d.status, d.visibility,
      ts_headline('english', coalesce(nullif(d.excerpt, ''), left(d.plain_text, 4000)), q.query, ${headlineOpts}) as snippet,
      (ts_rank_cd(d.search_vector, q.query, 32) + 0.4 * similarity(d.title, ${text}) + case when d.featured then 0.05 else 0 end + case when connected.id is not null then 0.1 else 0 end)::float as rank
    from studio.documents d left join connected on connected.id = d.id cross join q
    where ${scope}
      and (d.search_vector @@ q.query or similarity(d.title, ${text}) > 0.3 or connected.id is not null)
    order by rank desc, d.id
    limit ${limit}
    offset ${offset}
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Row[];
  const types = new Map((await listContentTypes()).map((t) => [t.id, t]));
  return rows.flatMap((r) => {
    const type = types.get(r.type_id);
    if (!type) return [];
    return [
      {
        id: r.id,
        title: r.title || "Untitled",
        path: documentPath(type, r.slug),
        typeName: type.name,
        typeSlug: type.slug,
        snippet: (r.snippet ?? "").replace(/\s+/g, " ").trim(),
        rank: Number(r.rank),
        status: r.status,
        visibility: r.visibility,
      },
    ];
  });
}

/** Public search: listed documents only. */
export async function searchPublic(q: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const limit = Number.isFinite(options.limit) ? Math.min(Math.max(Math.trunc(options.limit!), 1), 30) : 12;
  const offset = Number.isFinite(options.offset) ? Math.min(Math.max(Math.trunc(options.offset!), 0), 100_000) : 0;
  const scope: SQL[] = [sql`d.status = 'published' and d.visibility = 'public'`];
  if (options.typeSlug) {
    const type = (await listContentTypes()).find((t) => t.slug === options.typeSlug);
    if (!type) return [];
    scope.push(sql`d.type_id = ${type.id}`);
  }
  if (options.kind) {
    const ids = (await listContentTypes()).filter((t) => t.routing === "type" && !t.archivedAt && kindOf(t) === options.kind).map((t) => t.id);
    if (!ids.length) return [];
    scope.push(sql`d.type_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  }
  if (options.categorySlug) {
    const all = await listCategories();
    const cat = all.find((c) => c.slug === options.categorySlug);
    if (!cat) return [];
    const ids = descendantIds(all, cat.id).filter(isUuid);
    scope.push(sql`exists (select 1 from studio.document_categories dc where dc.document_id = d.id and dc.category_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}))`);
  }
  const results = await runSearch(q, sql.join(scope, sql` and `), limit, offset);
  // Never leak lifecycle fields through the public API.
  return results.map(({ status: _s, visibility: _v, ...rest }) => (void _s, void _v, rest));
}

/** Admin search across every document regardless of status or visibility (the Trash has its own page). */
export async function searchAdmin(actor: Actor, q: string, limit = 12): Promise<SearchResult[]> {
  assertAdmin(actor);
  const max = clampInt(limit, 1, 30, 12);
  const results = await runSearch(q, sql`d.status <> 'trashed'`, max);
  if (results.length) return results;
  // Titles of brand-new drafts may not be tokenised yet — fall back to a plain match.
  const pattern = `%${q.trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await getDb().execute(sql`
    select d.id, d.title, d.slug, d.type_id, d.status, d.visibility, '' as snippet, 0::float as rank
    from studio.documents d where d.status <> 'trashed' and d.title ilike ${pattern} order by d.updated_at desc limit ${max}`);
  const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Row[];
  const types = new Map((await listContentTypes()).map((t) => [t.id, t]));
  return list.flatMap((r) => {
    const type = types.get(r.type_id);
    return type ? [{ id: r.id, title: r.title || "Untitled", path: documentPath(type, r.slug), typeName: type.name, typeSlug: type.slug, snippet: "", rank: 0, status: r.status, visibility: r.visibility }] : [];
  });
}
