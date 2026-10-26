import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb } from "../db/client";
import { contactMessages, type ContactMessageRow } from "../db/schema";
import { env, isProduction } from "../env";
import { invalid, notFound, ServiceError } from "../errors";
import { getSettings } from "./settings";
import { consumeRateLimit, hashIdentifier } from "./rate-limit";

/**
 * Contact form, defended in layers:
 *   1. honeypot field real people never fill,
 *   2. signed timing token (issued by /api/contact/token; must be ≥3s and ≤2h old),
 *   3. per-IP (hashed) and global rate limits in Postgres,
 *   4. strict length/link limits.
 * Messages are stored for the admin inbox; nothing is emailed, so the
 * owner's address is never exposed and no mail provider is needed.
 */

const MIN_FILL_MS = 3000;
const MAX_TOKEN_AGE_MS = 2 * 60 * 60 * 1000;

function secret(): string {
  const value = env().AUTH_SECRET;
  if (!value) {
    if (isProduction()) throw new ServiceError("forbidden", "Contact form is not configured.");
    return "dev-only-contact-secret";
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`contact:${payload}`).digest("base64url");
}

export function issueContactToken(now = Date.now()): string {
  const issued = String(now);
  return `${issued}.${sign(issued)}`;
}

export function verifyContactToken(token: unknown, now = Date.now()): "ok" | "invalid" | "too-fast" | "expired" {
  if (typeof token !== "string" || token.length > 200) return "invalid";
  const [issued, signature] = token.split(".");
  if (!issued || !signature || !/^\d{10,16}$/.test(issued)) return "invalid";
  const expected = Buffer.from(sign(issued));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  const age = now - Number(issued);
  if (age < MIN_FILL_MS) return "too-fast";
  if (age > MAX_TOKEN_AGE_MS) return "expired";
  return "ok";
}

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Please tell me your name.").max(120),
  email: z.email("Please enter a valid email so I can reply.").max(254),
  reason: z.string().trim().max(60).default(""),
  message: z.string().trim().min(10, "A little more detail helps (10+ characters).").max(5000),
  website: z.string().max(200).optional(), // honeypot
  token: z.string().max(200),
});

export type ContactResult = { ok: true; message: string };

export async function submitContact(input: unknown, context: { ip: string; userAgent: string }): Promise<ContactResult> {
  const settings = await getSettings("contact");
  if (!settings.enabled) throw new ServiceError("forbidden", "The contact form is currently closed.");

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    const details: Record<string, string> = {};
    for (const issue of parsed.error.issues) details[String(issue.path[0] ?? "form")] = issue.message;
    throw invalid("Please check the form.", details);
  }
  const data = parsed.data;
  const successMessage = settings.successMessage || "Thanks — your message has arrived.";

  // Honeypot: pretend success so bots learn nothing.
  if (data.website) return { ok: true, message: successMessage };

  const token = verifyContactToken(data.token);
  if (token === "too-fast") throw invalid("That was quick! Please take a moment and try again.");
  if (token !== "ok") throw invalid("Your form session expired. Please reload the page and try again.");

  const links = data.message.match(/https?:\/\//gi)?.length ?? 0;
  if (links > 4) throw invalid("Please include fewer links (max 4).");
  const reason = settings.reasons.includes(data.reason) ? data.reason : "";

  const ipHash = hashIdentifier(context.ip);
  const perIp = await consumeRateLimit(`contact:ip:${ipHash}`, 5, 3600);
  const global = await consumeRateLimit("contact:global", 200, 86400);
  if (!perIp.allowed || !global.allowed) throw new ServiceError("rate_limited", "Too many messages right now. Please try again later.");

  await getDb()
    .insert(contactMessages)
    .values({ name: data.name, email: data.email.toLowerCase(), reason, message: data.message, ipHash, userAgent: context.userAgent.slice(0, 300) });
  return { ok: true, message: successMessage };
}

// ---------------------------------------------------------------------------
// Admin inbox
// ---------------------------------------------------------------------------

export async function listMessages(actor: Actor, options: { archived?: boolean } = {}): Promise<ContactMessageRow[]> {
  assertAdmin(actor);
  return getDb()
    .select()
    .from(contactMessages)
    .where(options.archived ? sql`${contactMessages.archivedAt} is not null` : isNull(contactMessages.archivedAt))
    .orderBy(desc(contactMessages.createdAt))
    .limit(200);
}

export async function unreadCount(actor: Actor): Promise<number> {
  assertAdmin(actor);
  const [row] = await getDb().select({ n: count() }).from(contactMessages).where(and(isNull(contactMessages.readAt), isNull(contactMessages.archivedAt)));
  return Number(row?.n ?? 0);
}

export async function updateMessage(actor: Actor, id: string, patch: { read?: boolean; archived?: boolean }): Promise<void> {
  assertAdmin(actor);
  const set: Partial<typeof contactMessages.$inferInsert> = {};
  if (patch.read !== undefined) set.readAt = patch.read ? new Date() : null;
  if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
  const updated = await getDb().update(contactMessages).set(set).where(eq(contactMessages.id, id)).returning({ id: contactMessages.id });
  if (!updated.length) throw notFound("Message");
}

export async function deleteMessage(actor: Actor, id: string): Promise<void> {
  assertAdmin(actor);
  const deleted = await getDb().delete(contactMessages).where(eq(contactMessages.id, id)).returning({ id: contactMessages.id });
  if (!deleted.length) throw notFound("Message");
}
