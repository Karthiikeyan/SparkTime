import { ServiceError } from "@/server/errors";
import { adminRoute } from "@/server/http/route";
import { listMedia, maxUploadBytes, uploadMedia } from "@/server/services/media";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = adminRoute(async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return listMedia(actor, { kind: sp.get("kind") ?? undefined, q: sp.get("q") ?? undefined, limit: Number(sp.get("limit") ?? 60), offset: Number(sp.get("offset") ?? 0) });
});

/**
 * Authenticated upload (multipart/form-data, field "file"). The server never
 * trusts the declared type or name: bytes are sniffed, images re-encoded, and
 * the object key is generated server-side.
 */
export const POST = adminRoute(async ({ req, actor }) => {
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) throw new ServiceError("unsupported_media", "Expected a file upload.");
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > maxUploadBytes() + 64 * 1024) throw new ServiceError("too_large", "File is too large.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ServiceError("invalid", "No file received.");
  if (file.size > maxUploadBytes()) throw new ServiceError("too_large", "File is too large.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const alt = form.get("alt");
  return uploadMedia(actor, { bytes, filename: file.name, declaredType: file.type, alt: typeof alt === "string" ? alt : undefined });
});
