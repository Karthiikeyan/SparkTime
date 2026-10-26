import { json, publicRoute } from "@/server/http/route";
import { issueContactToken } from "@/server/services/contact";

export const dynamic = "force-dynamic";

/** Issues a signed timestamp; submissions must arrive ≥3s and ≤2h later. */
export const GET = publicRoute(async () => json({ token: issueContactToken() }));
