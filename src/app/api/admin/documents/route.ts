import { adminRoute, readJson } from "@/server/http/route";
import { createDocument, FILTER_PARAMS, listDocuments, parseDocumentFilters, type FilterParams } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const params: FilterParams = Object.fromEntries(FILTER_PARAMS.map((key) => [key, sp.get(key) ?? undefined]));
  return listDocuments(actor, {
    ...parseDocumentFilters(params),
    limit: Number(sp.get("limit") ?? 50),
    offset: Number(sp.get("offset") ?? 0),
  });
});

export const POST = adminRoute(async ({ req, actor }) => createDocument(actor, await readJson(req)));
