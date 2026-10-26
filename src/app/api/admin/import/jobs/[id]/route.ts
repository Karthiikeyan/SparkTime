import { adminRoute } from "@/server/http/route";
import { discardImportJob, getImportJob } from "@/server/services/import/jobs";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = adminRoute<Params>(async ({ actor, params }) => getImportJob(actor, params.id));

/** Removes an import that never started, with its staged files. */
export const DELETE = adminRoute<Params>(async ({ actor, params }) => {
  await discardImportJob(actor, params.id);
  return { ok: true };
});
