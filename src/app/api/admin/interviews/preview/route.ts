import { adminRoute, readJson } from "@/server/http/route";
import { previewInterviewImport } from "@/server/services/interview-import";

export const dynamic = "force-dynamic";

/** Validate a company's import.json and compare every page with what exists. Writes nothing. */
export const POST = adminRoute(async ({ req, actor }) => previewInterviewImport(actor, await readJson(req, 4 * 1024 * 1024)));
