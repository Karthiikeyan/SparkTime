import { adminRoute } from "@/server/http/route";
import { invalidatePublicSite } from "@/server/http/revalidate";
import { runImportJob } from "@/server/services/import/execute";

export const dynamic = "force-dynamic";
// Must be a literal. The run loop stops itself after RUN_BUDGET_MS (20 s); this leaves room for the item in flight.
export const maxDuration = 60;

/** Processes the next batch of approved work. The browser calls it until the import finishes. */
export const POST = adminRoute<{ id: string }>(async ({ actor, params }) => {
  const result = await runImportJob(actor, params.id);
  if (result.affectsPublic) invalidatePublicSite();
  return result;
});
