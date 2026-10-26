import "server-only";
import { z } from "zod";

/**
 * The single place server-side configuration is read. Nothing else touches
 * process.env for secrets, so auditing "what can leak" means reading one file.
 */

const optional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().trim().default("postgres://postgres:postgres@127.0.0.1:54329/postgres"),
  // Default to 2 — safe for Supabase's Transaction Pooler (Supavisor) which has a
  // 25-connection free-tier limit. Multiple build workers each create their own pool,
  // so keep this low. Override with DATABASE_POOL_MAX=5+ on a paid plan.
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(2),
  /** Seconds before an idle connection closes (use 1 with the local PGlite server). */
  DATABASE_IDLE_TIMEOUT: z.coerce.number().int().min(1).max(600).default(5),
  /** Set by Next.js itself: "phase-production-build" while `next build` renders pages. */
  NEXT_PHASE: optional,
  /** Set to "1" by Vercel (reported by the owner-only health check). */
  VERCEL: optional,
  NEXT_PUBLIC_SITE_URL: z.string().trim().default("http://localhost:3000"),

  AUTH_SECRET: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  ADMIN_GITHUB_ID: optional,
  ADMIN_GITHUB_LOGIN: optional,
  AUTH_DEV_LOGIN: optional,

  MEDIA_DRIVER: z.enum(["local", "r2"]).optional(),
  R2_ACCOUNT_ID: optional,
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_BUCKET: optional,
  R2_PUBLIC_URL: optional,

  /** Imports may write to R2 outside production only when this is "true" (see services/import/storage-guard.ts). */
  IMPORT_ALLOW_R2_IN_DEV: optional,

  CRON_SECRET: optional,
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      // Report which variables are wrong without echoing their values.
      const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment configuration: ${fields}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests only: re-read process.env after mutating it. */
export function resetEnvCache(): void {
  cached = null;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

export function siteUrl(): string {
  return env().NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
}

export function isSecureOrigin(): boolean {
  return siteUrl().startsWith("https://");
}

export type MediaConfig =
  | { driver: "local" }
  | { driver: "r2"; accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicUrl: string };

export function mediaConfig(): MediaConfig {
  const e = env();
  const r2Complete = Boolean(e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET && e.R2_PUBLIC_URL);
  const driver = e.MEDIA_DRIVER ?? (r2Complete ? "r2" : "local");
  if (driver === "r2") {
    if (!r2Complete) throw new Error("MEDIA_DRIVER=r2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_URL.");
    return {
      driver: "r2",
      accountId: e.R2_ACCOUNT_ID!,
      accessKeyId: e.R2_ACCESS_KEY_ID!,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY!,
      bucket: e.R2_BUCKET!,
      publicUrl: e.R2_PUBLIC_URL!.replace(/\/+$/, ""),
    };
  }
  if (e.NODE_ENV === "production" && !process.env.ALLOW_LOCAL_MEDIA_IN_PRODUCTION) {
    // Serverless filesystems are ephemeral; local media would silently vanish.
    throw new Error("Local media storage is not supported in production. Configure Cloudflare R2.");
  }
  return { driver: "local" };
}

/** Public origin that serves media, used for CSP img-src and absolute URLs. */
export function mediaPublicOrigin(): string | null {
  const url = env().R2_PUBLIC_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
