import { adminRoute, readJson } from "@/server/http/route";
import { resolveSelection } from "@/server/services/content-ops";

export const dynamic = "force-dynamic";

/** Resolves a selection (explicit ids, or every document matching the list's filter) to ids plus a preview for the confirmation. Read-only. */
export const POST = adminRoute(async ({ req, actor }) => resolveSelection(actor, await readJson(req, 512 * 1024)));
