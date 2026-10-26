import { adminRoute, readJson } from "@/server/http/route";
import { controlImportJob } from "@/server/services/import/execute";

export const dynamic = "force-dynamic";

/** { action: "cancel" | "retry" | "skipAssets" } */
export const POST = adminRoute<{ id: string }>(async ({ req, actor, params }) => controlImportJob(actor, params.id, await readJson(req)));
