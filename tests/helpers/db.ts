import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { AdminActor } from "@/server/auth/actor";
import { setDbForTesting, type Db } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { seedDatabase } from "@/server/seed/seed";

/**
 * A fresh, fully migrated, in-process Postgres (PGlite) per test file.
 * Real SQL — full-text search, trigram, JSONB, constraints — no mocks.
 */
export async function createTestDb(options: { seed?: boolean } = {}) {
  const client = await PGlite.create({ extensions: { pg_trgm } });
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  setDbForTesting(db);
  if (options.seed) await seedDatabase(db);
  return {
    db,
    /** The underlying PGlite instance, e.g. to count the statements an operation issues. */
    client,
    async close() {
      setDbForTesting(null);
      await client.close();
    },
  };
}

export async function createAdmin(db: Db, overrides: Partial<typeof schema.users.$inferInsert> = {}): Promise<AdminActor> {
  const [user] = await db
    .insert(schema.users)
    .values({ githubId: 424242, githubLogin: "karthikeyan-test", ...overrides })
    .returning();
  return { kind: "admin", userId: user!.id, login: user!.githubLogin };
}

export async function typeId(db: Db, slug: string): Promise<string> {
  const rows = await db.select({ id: schema.contentTypes.id, slug: schema.contentTypes.slug }).from(schema.contentTypes);
  const found = rows.find((r) => r.slug === slug);
  if (!found) throw new Error(`No content type ${slug}`);
  return found.id;
}

export const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
export const docOf = (...nodes: unknown[]) => ({ type: "doc", content: nodes });
