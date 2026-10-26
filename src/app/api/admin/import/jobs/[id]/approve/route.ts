import { adminRoute, readJson } from "@/server/http/route";
import { approveImportJob } from "@/server/services/import/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Approves exactly the reviewed plan (by hash). Content is written only by /run afterwards. */
export const POST = adminRoute<{ id: string }>(async ({ req, actor, params }) => approveImportJob(actor, params.id, await readJson(req)));
