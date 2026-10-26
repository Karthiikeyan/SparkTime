import { adminRoute, readJson } from "@/server/http/route";
import { exportPage } from "@/server/services/portable-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One page of content files (Markdown and editor documents). */
export const POST = adminRoute(async ({ req, actor }) => exportPage(actor, await readJson(req, 512 * 1024)));
