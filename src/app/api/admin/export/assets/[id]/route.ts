import { NextResponse } from "next/server";
import { adminRoute } from "@/server/http/route";
import { exportAsset } from "@/server/services/portable-export";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One stored media file for an export, owner only, never cached. */
export const GET = adminRoute<{ id: string }>(async ({ actor, params }) => {
  const asset = await exportAsset(actor, params.id);
  return new NextResponse(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.bytes.length),
      "Content-Disposition": `attachment; filename="${asset.name.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
