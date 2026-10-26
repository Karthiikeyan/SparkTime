import { ServiceError } from "@/server/errors";
import { adminRoute } from "@/server/http/route";
import { maxUploadBytes } from "@/server/services/media";
import { uploadImportAsset } from "@/server/services/import/execute";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One media file for an approved import (multipart: "key", "file"). Checked against the analysed checksum. */
export const POST = adminRoute<{ id: string }>(async ({ req, actor, params }) => {
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) throw new ServiceError("unsupported_media", "Expected a file upload.");
  if (Number(req.headers.get("content-length") ?? 0) > maxUploadBytes() + 64 * 1024) throw new ServiceError("too_large", "File is too large.");
  const form = await req.formData();
  const key = form.get("key");
  const file = form.get("file");
  if (typeof key !== "string" || !(file instanceof File)) throw new ServiceError("invalid", "No file received.");
  if (file.size > maxUploadBytes()) throw new ServiceError("too_large", "File is too large.");
  return uploadImportAsset(actor, params.id, key, { bytes: Buffer.from(await file.arrayBuffer()), declaredType: file.type });
});
