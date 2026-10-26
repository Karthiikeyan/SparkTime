import { adminRoute, readJson } from "@/server/http/route";
import { exportSummary } from "@/server/services/portable-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** What a selection would include: counts, private content, excluded references. */
export const POST = adminRoute(async ({ req, actor }) => exportSummary(actor, await readJson(req, 512 * 1024)));
