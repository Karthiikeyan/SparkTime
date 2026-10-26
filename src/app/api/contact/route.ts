import { publicRoute, readJson } from "@/server/http/route";
import { submitContact } from "@/server/services/contact";
import { clientIp } from "@/server/services/rate-limit";

export const dynamic = "force-dynamic";

export const POST = publicRoute(
  async ({ req }) => {
    const body = await readJson(req, 20_000);
    return submitContact(body, { ip: clientIp(req.headers), userAgent: req.headers.get("user-agent") ?? "" });
  },
  { mutation: true },
);
