import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { pruneExpiredSessions } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { json } from "@/server/http/route";
import { pruneRateLimits } from "@/server/services/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Daily cron (vercel.json). Supabase's free tier pauses inactive projects;
 * a statically cached site may not query the database for days, so this
 * keeps it awake and prunes expired sessions and rate-limit windows.
 */
export async function GET(request: NextRequest) {
  const secret = env().CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(secret ?? "");
  // Compare BYTE lengths: timingSafeEqual throws (a 500) when they differ, and a multibyte header can match in characters but not in bytes.
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return json({ error: "Unauthorized" }, 401);
  }
  await getDb().execute(sql`select 1`);
  await Promise.all([pruneExpiredSessions(), pruneRateLimits()]);
  return json({ ok: true, at: new Date().toISOString() });
}
