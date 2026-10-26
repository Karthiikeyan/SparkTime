import { mediaConfig } from "@/server/env";
import { readLocalObject } from "@/server/media/storage";
import { CONTENT_TYPE_BY_EXT, isValidObjectKey } from "@/server/media/validation";

/**
 * Serves locally stored media during development (production uses the R2
 * public domain). Only server-generated key shapes are accepted; the path is
 * resolved inside .data/media with a traversal check in readLocalObject().
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (mediaConfig().driver !== "local") return new Response("Not found", { status: 404 });
  const { key } = await params;
  const objectKey = key.join("/");
  if (!isValidObjectKey(objectKey)) return new Response("Not found", { status: 404 });
  const body = await readLocalObject(objectKey);
  if (!body) return new Response("Not found", { status: 404 });
  const ext = objectKey.split(".").pop() ?? "";
  const type = CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(body.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Media is never a document context: no scripts, no plugins.
      ...(type === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; sandbox" }),
    },
  });
}
