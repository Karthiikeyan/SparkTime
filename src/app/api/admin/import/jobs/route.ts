import { adminRoute, readJson } from "@/server/http/route";
import { createImportJob, listImportJobs } from "@/server/services/import/jobs";

export const dynamic = "force-dynamic";

/** Import history. */
export const GET = adminRoute(async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return listImportJobs(actor, { status: sp.get("status") ?? undefined, limit: Number(sp.get("limit") ?? 30), offset: Number(sp.get("offset") ?? 0) });
});

/** Starts a new import (nothing is staged or written yet). */
export const POST = adminRoute(async ({ req, actor }) => createImportJob(actor, await readJson(req)));
