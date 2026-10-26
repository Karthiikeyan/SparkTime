import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/db";

/**
 * Supabase exposes the `public` schema (and any schema added to its Data API)
 * to the anon and authenticated roles. This app keeps everything in `studio`
 * and relies on migrations 0002/0004 to enable row level security on every
 * table with no policies. A new table added by a later migration silently
 * misses that unless its author remembers, so this test fails the build instead.
 */
let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb();
});
afterAll(() => ctx.close());

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await ctx.db.execute(query);
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

describe("database lockdown", () => {
  it("every table in the studio schema has row level security enabled", async () => {
    const tables = await rows<{ name: string; rls: boolean }>(sql`
      select c.relname as name, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'studio' and c.relkind in ('r', 'p')
      order by c.relname`);
    expect(tables.length).toBeGreaterThan(10);
    expect(tables.filter((t) => !t.rls).map((t) => t.name)).toEqual([]);
  });

  it("no policies exist, so every non-owner role is denied by default", async () => {
    const policies = await rows<{ tablename: string; policyname: string }>(sql`select tablename, policyname from pg_policies where schemaname = 'studio'`);
    expect(policies).toEqual([]);
  });

  it("creates no application tables outside the studio schema (public is exposed by Supabase)", async () => {
    const outside = await rows<{ schemaname: string; tablename: string }>(sql`
      select schemaname, tablename from pg_tables
      where schemaname not in ('studio', 'drizzle', 'pg_catalog', 'information_schema')`);
    expect(outside).toEqual([]);
  });
});
