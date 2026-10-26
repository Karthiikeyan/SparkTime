import { adminRoute } from "@/server/http/route";
import { importDocumentDetail } from "@/server/services/import/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Full plan and converted-body preview for one document (?key=…). */
export const GET = adminRoute<{ id: string }>(async ({ req, actor, params }) => importDocumentDetail(actor, params.id, req.nextUrl.searchParams.get("key") ?? ""));
