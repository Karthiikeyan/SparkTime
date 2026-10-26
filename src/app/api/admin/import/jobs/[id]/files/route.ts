import { IMPORT_LIMITS } from "@/lib/portability/limits";
import { adminRoute, readJson } from "@/server/http/route";
import { stageImportFiles } from "@/server/services/import/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One batch of staged files (text content, media checksums and leading bytes). */
export const POST = adminRoute<{ id: string }>(async ({ req, actor, params }) => stageImportFiles(actor, params.id, await readJson(req, IMPORT_LIMITS.maxBatchBytes + 512 * 1024)));
