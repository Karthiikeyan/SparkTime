"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useId, useState } from "react";
import { sendContact, type ContactState } from "@/app/(site)/contact/actions";
import { trackContactSubmit } from "@/lib/analytics";

const idle: ContactState = { status: "idle", message: "", errors: {} };
const field = "mt-1.5 min-h-12 w-full rounded-[8px] border border-line-field bg-surface px-3.5 text-base outline-none transition-colors placeholder:text-muted focus:border-accent focus:outline-2 focus:outline-offset-1 focus:outline-accent aria-[invalid=true]:border-danger";

/**
 * A server-rendered form: it posts to a server action, so it sends with or without JavaScript. The signed
 * timing token is rendered into the page (see the contact page). "Send another" starts a fresh form.
 */
export function ContactForm({ reasons, token, defaultReason = "" }: { reasons: string[]; token: string; defaultReason?: string }) {
  const [round, setRound] = useState(0);
  return <Form key={round} reasons={reasons} token={token} defaultReason={defaultReason} again={() => setRound((n) => n + 1)} />;
}

function Form({ reasons, token, defaultReason, again }: { reasons: string[]; token: string; defaultReason: string; again: () => void }) {
  const id = useId();
  const [state, action, pending] = useActionState(sendContact, idle);
  const { errors } = state;

  useEffect(() => {
    // That a message was sent — never what it said or who sent it.
    if (state.status === "sent") trackContactSubmit();
  }, [state.status]);

  if (state.status === "sent") {
    return (
      <div role="status" className="flex flex-col items-start gap-3 py-6">
        <span aria-hidden="true" className="flex size-13 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
          <Check size={26} strokeWidth={2.5} />
        </span>
        <p className="font-serif text-[1.875rem] font-medium leading-tight">Message sent</p>
        <p className="text-ink-2">{state.message || "Thanks for writing. I’ll reply to the email you gave, usually within a few days."}</p>
        <Link
          href="/contact"
          onClick={(e) => {
            e.preventDefault();
            again();
          }}
          className="inline-flex min-h-11 items-center rounded-[8px] border border-line-strong bg-surface px-4.5 text-[0.9375rem] font-semibold hover:border-line-field"
        >
          Send another
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5" aria-describedby={`${id}-status`}>
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor={`${id}-name`} className="text-[0.9375rem] font-semibold">
          Name
        </label>
        <input id={`${id}-name`} name="name" required maxLength={120} autoComplete="name" className={field} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${id}-name-err` : undefined} />
        {errors.name && (
          <p id={`${id}-name-err`} className="mt-1 text-sm text-danger">
            {errors.name}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${id}-email`} className="text-[0.9375rem] font-semibold">
          Email
        </label>
        <input id={`${id}-email`} name="email" type="email" required maxLength={254} autoComplete="email" className={field} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? `${id}-email-err` : undefined} />
        {errors.email && (
          <p id={`${id}-email-err`} className="mt-1 text-sm text-danger">
            {errors.email}
          </p>
        )}
      </div>
      {reasons.length > 0 && (
        <div>
          <label htmlFor={`${id}-reason`} className="text-[0.9375rem] font-semibold">
            What’s it about? <span className="font-normal text-muted">(optional)</span>
          </label>
          <select id={`${id}-reason`} name="reason" className={field} defaultValue={defaultReason}>
            <option value="">Choose one</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`${id}-message`} className="text-[0.9375rem] font-semibold">
          Message
        </label>
        <textarea id={`${id}-message`} name="message" required minLength={10} maxLength={5000} rows={6} className={`${field} min-h-36 py-3`} aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? `${id}-message-err` : undefined} />
        {errors.message && (
          <p id={`${id}-message-err`} className="mt-1 text-sm text-danger">
            {errors.message}
          </p>
        )}
      </div>
      {/* Honeypot: invisible to people and assistive tech; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <button type="submit" disabled={pending} className="inline-flex min-h-13 items-center self-start rounded-[8px] bg-accent px-7 text-base font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:opacity-60">
        {pending ? "Sending…" : "Send message"}
      </button>
      <p id={`${id}-status`} role="status" aria-live="polite" className={state.status === "error" ? "text-sm text-danger" : "text-sm text-muted"}>
        {state.status === "error" ? state.message : "Your email is only used to reply to you."}
      </p>
    </form>
  );
}
