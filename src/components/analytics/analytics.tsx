"use client";

import { GoogleAnalytics } from "@next/third-parties/google";
import { Analytics as VercelAnalytics, type BeforeSend } from "@vercel/analytics/next";
import { useEffect, useSyncExternalStore } from "react";
import { analyticsAllowed, classifyLink, flushAnalytics, gaMeasurementId, track, vercelAnalyticsEvent } from "@/lib/analytics";

const noopSubscribe = () => () => {};

const vercelBeforeSend: BeforeSend = (event) =>
  vercelAnalyticsEvent(event, (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true);

/**
 * Mounts Vercel Web Analytics (cookieless page views; filtered by src/lib/analytics.ts)
 * and loads GA4 (via Next's official @next/third-parties integration) after
 * hydration, and only when src/lib/analytics.ts allows it; otherwise renders
 * nothing and sends nothing. Link clicks are classified by one delegated
 * listener, so no link in the site needs analytics code of its own.
 */
export function Analytics({ sparktribeUrl }: { sparktribeUrl: string }) {
  const gaId = gaMeasurementId(process.env.NEXT_PUBLIC_GA_ID);
  const enabled = useSyncExternalStore(noopSubscribe, analyticsAllowed, () => false);

  useEffect(() => {
    if (!enabled) return;
    // GA's init script (a child, so it ran first) defines gtag; wait briefly if it hasn't yet.
    let tries = 0;
    const timer = window.setInterval(() => {
      if (flushAnalytics() || ++tries > 50) window.clearInterval(timer);
    }, 100);
    flushAnalytics();

    let sparktribeHost: string | null = null;
    try {
      sparktribeHost = sparktribeUrl ? new URL(sparktribeUrl).hostname : null;
    } catch {}
    const onClick = (event: MouseEvent) => {
      // Primary and middle clicks (a new tab) both count.
      if (event.button !== 0 && event.button !== 1) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link) return;
      const found = classifyLink({
        href: link.getAttribute("href") ?? "",
        pageUrl: window.location.href,
        rel: link.rel,
        context: link.closest<HTMLElement>("[data-analytics]")?.dataset.analytics ?? null,
        sparktribeHost,
      });
      if (found) track(found);
    };
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("auxclick", onClick, { capture: true });
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("auxclick", onClick, { capture: true });
    };
  }, [enabled, sparktribeUrl]);

  return (
    <>
      <VercelAnalytics beforeSend={vercelBeforeSend} />
      {enabled && gaId ? <GoogleAnalytics gaId={gaId} /> : null}
    </>
  );
}
