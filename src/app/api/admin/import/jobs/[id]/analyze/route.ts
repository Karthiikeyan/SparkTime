import { adminRoute, readJson } from "@/server/http/route";
import { analyzeImportJob } from "@/server/services/import/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Dry run: parse, map and plan against the current site. Writes no content. */
export const POST = adminRoute<{ id: string }>(async ({ req, actor, params }) => analyzeImportJob(actor, params.id, await readJson(req, 1024 * 1024)));
