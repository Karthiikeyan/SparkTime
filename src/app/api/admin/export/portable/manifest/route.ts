import { adminRoute, readJson } from "@/server/http/route";
import { exportManifest } from "@/server/services/portable-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The package manifest, README and asset list. Content files come from /files pages. */
export const POST = adminRoute(async ({ req, actor }) => exportManifest(actor, await readJson(req, 512 * 1024)));
