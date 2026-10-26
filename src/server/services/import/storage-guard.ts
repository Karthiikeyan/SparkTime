import "server-only";
import { env, mediaConfig, siteUrl } from "../../env";
import { invalid } from "../../errors";
import { getStorage } from "../../media/storage";

/**
 * Imports upload media in bulk, so a development machine that happens to
 * hold production R2 credentials must not write to that bucket by accident.
 * (The ordinary media library keeps its existing behaviour.) Outside
 * production, R2 is used for imports only after an explicit
 * IMPORT_ALLOW_R2_IN_DEV=true, or MEDIA_DRIVER=local keeps files in .data/media.
 */
export type MediaGuard = { driver: "local" | "r2"; blocked: boolean; note: string | null };

export function mediaStorageGuard(): MediaGuard {
  const driver = getStorage().driver;
  if (driver !== "r2") return { driver, blocked: false, note: null };
  let bucket = "";
  try {
    const config = mediaConfig();
    if (config.driver === "r2") bucket = ` "${config.bucket}"`;
  } catch {
    // The injected storage (tests) has no config; the note just omits the bucket.
  }
  // `next start` on a laptop has NODE_ENV=production, so a localhost site URL also counts as development.
  const isProduction = env().NODE_ENV === "production" && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(siteUrl());
  if (isProduction || env().IMPORT_ALLOW_R2_IN_DEV === "true") {
    return { driver, blocked: false, note: `Media will be uploaded to the Cloudflare R2 bucket${bucket} this site is configured with.` };
  }
  return {
    driver,
    blocked: true,
    note: `Blocked: this is a development environment configured with Cloudflare R2 credentials, so importing media would write to the R2 bucket${bucket}. Set MEDIA_DRIVER=local to keep imported media in .data/media, or set IMPORT_ALLOW_R2_IN_DEV=true to import into R2 deliberately.`,
  };
}

export function assertMediaUploadAllowed(): void {
  const guard = mediaStorageGuard();
  if (guard.blocked && guard.note) throw invalid(guard.note);
}
