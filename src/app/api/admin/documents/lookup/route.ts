import { adminRoute } from "@/server/http/route";
import { lookupDocuments } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const items = await lookupDocuments(actor, sp.get("q") ?? "", {
    excludeId: sp.get("exclude") ?? undefined,
    typeIds: sp.getAll("type"),
    limit: Number(sp.get("limit") ?? 12),
  });
  return { items };
});
