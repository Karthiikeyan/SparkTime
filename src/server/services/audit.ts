import "server-only";
import { and, desc, eq, like, lt, or } from "drizzle-orm";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb, type Db } from "../db/client";
import { auditLogs, users } from "../db/schema";
import { clampInt } from "@/lib/numbers";

/**
 * Best-effort audit trail of admin mutations. Never throws into the caller.
 * Inside a transaction, pass the transaction as `executor`.
 */
export async function recordAudit(
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  summary = "",
  metadata: Record<string, unknown> = {},
  executor?: Db,
): Promise<void> {
  try {
    await (executor ?? getDb())
      .insert(auditLogs)
      .values({
        actorId: actor.kind === "admin" ? actor.userId : null,
        action,
        entityType,
        entityId,
        summary: summary.slice(0, 500),
        metadata,
      });
  } catch (error) {
    console.error("[audit] failed to record", action, error instanceof Error ? error.message : error);
  }
}

export async function listAudit(actor: Actor, limit = 50) {
  assertAdmin(actor);
  return getDb().select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(clampInt(limit, 1, 200, 50));
}

export type ActivityEntry = {
  id: number;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  actor: string | null;
};

/** The activity log, newest first, paged by id (`before`) so new entries never shift a page. */
export async function listActivity(actor: Actor, options: { before?: number; limit?: number; scope?: "all" | "bulk" | "content" } = {}): Promise<{ entries: ActivityEntry[]; next: number | null }> {
  assertAdmin(actor);
  const limit = clampInt(options.limit, 1, 200, 100);
  const where = [
    options.before && Number.isSafeInteger(options.before) ? lt(auditLogs.id, options.before) : undefined,
    options.scope === "bulk" ? like(auditLogs.action, "bulk.%") : options.scope === "content" ? or(like(auditLogs.action, "document.%"), like(auditLogs.action, "bulk.%")) : undefined,
  ].filter(Boolean);
  const rows = await getDb()
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actor: users.githubLogin,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLogs.id))
    .limit(limit + 1);
  const entries = rows.slice(0, limit).map((r) => ({ ...r, metadata: (r.metadata ?? {}) as Record<string, unknown> }));
  return { entries, next: rows.length > limit ? entries.at(-1)!.id : null };
}
