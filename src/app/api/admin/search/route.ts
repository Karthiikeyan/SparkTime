import { adminRoute } from "@/server/http/route";
import { searchAdmin } from "@/server/services/search";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async ({ req, actor }) => ({ results: await searchAdmin(actor, req.nextUrl.searchParams.get("q") ?? "") }));
