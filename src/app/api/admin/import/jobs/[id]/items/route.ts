import { adminRoute } from "@/server/http/route";
import { listImportItems } from "@/server/services/import/jobs";

export const dynamic = "force-dynamic";

/** Per-item outcomes for the history view. */
export const GET = adminRoute<{ id: string }>(async ({ req, actor, params }) => {
  const sp = req.nextUrl.searchParams;
  return listImportItems(actor, params.id, { status: sp.get("status") ?? undefined, limit: Number(sp.get("limit") ?? 100), offset: Number(sp.get("offset") ?? 0) });
});
