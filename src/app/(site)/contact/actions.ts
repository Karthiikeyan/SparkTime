"use server";

import { headers } from "next/headers";
import { isServiceError } from "@/server/errors";
import { submitContact } from "@/server/services/contact";
import { clientIp } from "@/server/services/rate-limit";

export type ContactState = { status: "idle" | "sent" | "error"; message: string; errors: Record<string, string> };

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

/**
 * The contact form's action. A plain form post, so it works before the page's script has loaded
 * (or without it): the same checks as the API apply (honeypot, timing token, rate limits).
 */
export async function sendContact(_previous: ContactState, form: FormData): Promise<ContactState> {
  const h = await headers();
  try {
    const result = await submitContact(
      { name: text(form.get("name")), email: text(form.get("email")), reason: text(form.get("reason")), message: text(form.get("message")), website: text(form.get("website")), token: text(form.get("token")) },
      { ip: clientIp(h), userAgent: h.get("user-agent") ?? "" },
    );
    return { status: "sent", message: result.message, errors: {} };
  } catch (error) {
    if (isServiceError(error)) return { status: "error", message: error.message, errors: error.details ?? {} };
    throw error;
  }
}
