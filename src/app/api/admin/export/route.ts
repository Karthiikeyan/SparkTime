import { NextResponse } from "next/server";
import { adminRoute } from "@/server/http/route";
import { exportBundle } from "@/server/services/export";

export const dynamic = "force-dynamic";

/** Full lossless JSON export (content, taxonomy, relations, settings). */
export const GET = adminRoute(async ({ actor }) => {
  const bundle = await exportBundle(actor);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="karthikeyan-a-studio-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
