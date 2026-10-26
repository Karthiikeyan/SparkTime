import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { DocContent } from "@/components/content/renderer";
import { ContactForm } from "@/components/pages/contact-form";
import { stripPlaceholders } from "@/lib/content/placeholders";
import { safeHref } from "@/lib/url";
import { documentMetadata, pageMetadata } from "@/server/seo/metadata";
import { issueContactToken } from "@/server/services/contact";
import { getRootPage, mediaForDoc, resolveReferences } from "@/server/services/public-content";
import { loadAllSettings } from "@/server/services/settings";

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getRootPage("contact");
  return doc ? documentMetadata(doc) : pageMetadata({ title: "Contact", path: "/contact", description: "Get in touch with Karthikeyan A." });
}

type Props = { searchParams: Promise<{ reason?: string | string[] }> };

/** Rendered per request: the form carries a fresh signed token, and "?reason=Speaking" preselects the topic. */
export default async function ContactPage({ searchParams }: Props) {
  await connection();
  const [doc, settings, params] = await Promise.all([getRootPage("contact"), loadAllSettings(), searchParams]);
  const body = doc ? stripPlaceholders(doc.content) : null;
  const [refs, media] = body ? await Promise.all([resolveReferences(body), mediaForDoc(body)]) : [new Map(), new Map()];
  const wanted = (Array.isArray(params.reason) ? params.reason[0] : params.reason)?.toLowerCase();
  const reasons = settings.contact.reasons;
  const defaultReason = reasons.find((r) => r.toLowerCase() === wanted) ?? "";
  // Enabled Studio profiles, then the site's own links, each URL once.
  const profiles = [...settings.profiles.filter((p) => p.enabled && p.url).map((p) => ({ id: p.id, label: p.label || p.platform, url: p.url })), ...settings.site.social.map((s) => ({ id: s.id, label: s.label, url: s.url }))].filter((p, i, all) => all.findIndex((q) => q.url === p.url) === i);
  const methods = settings.contact.methods.flatMap((m) => {
    const href = safeHref(m.href);
    return href ? [{ ...m, href }] : [];
  });

  return (
    <div className="container-page flex flex-wrap items-start gap-x-16 gap-y-12 pb-20 pt-10 sm:pb-24 sm:pt-[72px]">
      <div className="min-w-0 flex-[1_1_26rem]">
        <p className="caps text-accent-ink">Contact</p>
        <h1 className="mt-3 font-serif text-[3rem] font-medium leading-none tracking-[-0.03em] sm:text-[4rem]">Say hello</h1>
        {body && body.content.length > 0 ? (
          <div className="mt-5 max-w-120">
            <DocContent doc={body} context={{ refs, media }} className="[&>*]:mx-0" />
          </div>
        ) : (
          <p className="mt-5 max-w-120 text-[1.1875rem] leading-relaxed text-ink-2 sm:text-xl">
            {doc?.excerpt || "Speaking invitations, collaboration ideas, an interview experience to share, or a question about something I wrote. I read every message."}
          </p>
        )}
        {methods.length > 0 && (
          <ul className="mt-8 max-w-105">
            {methods.map((m) => (
              <li key={m.label} className="border-b border-line">
                <a href={m.href} rel="noopener noreferrer" className="flex min-h-13 items-center justify-between gap-4 py-2 font-medium hover:text-accent-ink">
                  <span>
                    {m.label}
                    {m.description && <span className="block text-sm font-normal text-muted">{m.description}</span>}
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
                </a>
              </li>
            ))}
          </ul>
        )}
        {profiles.length > 0 && (
          <div className="mt-9 max-w-105">
            <h2 className="caps mb-1.5 text-muted">Or find me on</h2>
            <ul>
              {profiles.map((p) => (
                <li key={p.id} className="border-b border-line">
                  <a href={p.url} rel="me noopener noreferrer" target="_blank" className="flex min-h-13 items-center justify-between font-medium hover:text-accent-ink">
                    {p.label}
                    <span aria-hidden="true" className="text-muted">
                      ↗
                    </span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="w-full max-w-140 flex-[1_1_30rem] rounded-xl border border-line bg-surface p-6 sm:p-9">
        {settings.contact.enabled ? <ContactForm reasons={reasons} token={issueContactToken()} defaultReason={defaultReason} /> : <p className="text-muted">The contact form is closed at the moment.</p>}
      </div>
    </div>
  );
}
