/**
 * Google Analytics 4: the one place that decides whether analytics runs and
 * the only code that talks to gtag. Components call the small API at the
 * bottom (track*), never window.gtag directly. See docs/ANALYTICS.md.
 *
 * Runs only when all of these hold, so development, tests, preview
 * deployments and localhost can never report into the production property:
 *   - NEXT_PUBLIC_GA_ID is a GA4 measurement id ("G-…")
 *   - it's a production build
 *   - the page is served from the canonical https origin (NEXT_PUBLIC_SITE_URL)
 *   - the page isn't an admin preview
 *   - the browser isn't sending Global Privacy Control
 *
 * Page views are GA4's own (the initial load plus enhanced measurement's
 * "page changes based on browser history events", which covers client-side
 * navigation). Everything here is a small, named event. No personal data is
 * ever sent: no form contents, no email addresses, no query strings.
 */

const GA_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

/** A valid GA4 measurement id, or null (unset, blank or malformed means "off"). */
export function gaMeasurementId(value: string | undefined): string | null {
  const id = value?.trim().toUpperCase();
  return id && GA_ID_PATTERN.test(id) ? id : null;
}

/** Origins GA4 needs in the Content-Security-Policy (Google's documented GA4 list). */
export const GA_CSP = {
  script: ["https://*.googletagmanager.com"],
  connect: ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com"],
  img: ["https://*.google-analytics.com", "https://*.googletagmanager.com"],
};

export type AnalyticsContext = {
  gaId: string | null;
  nodeEnv: string | undefined;
  siteUrl: string | undefined;
  origin: string;
  pathname: string;
  globalPrivacyControl: boolean;
};

/** Admin previews and the studio are never measured, by any analytics. */
function isPrivatePath(pathname: string): boolean {
  return pathname === "/preview" || pathname.startsWith("/preview/") || pathname.startsWith("/admin");
}

export function analyticsDecision(c: AnalyticsContext): boolean {
  if (!c.gaId || c.nodeEnv !== "production" || c.globalPrivacyControl) return false;
  if (isPrivatePath(c.pathname)) return false;
  try {
    const site = new URL(c.siteUrl ?? "");
    return site.protocol === "https:" && site.origin === c.origin;
  } catch {
    return false;
  }
}

/**
 * Vercel Web Analytics' beforeSend filter: it follows the same privacy rules as GA4 (no admin
 * previews, nothing when the browser sends Global Privacy Control). Page views only; the production-only
 * rule is Vercel's own (the component stays quiet outside a production build).
 */
export function vercelAnalyticsEvent<E extends { url: string }>(event: E, globalPrivacyControl: boolean): E | null {
  if (globalPrivacyControl) return null;
  try {
    return isPrivatePath(new URL(event.url).pathname) ? null : event;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Link clicks
// ---------------------------------------------------------------------------

export type AnalyticsEvent =
  | { name: "content_view"; params: { content_type: string; content_slug: string; content_title: string } }
  | { name: "reading_progress"; params: { percent: number; content_type: string; content_slug: string } }
  | { name: "outbound_click"; params: { link_domain: string; link_url: string } }
  | { name: "project_link_click"; params: { link_domain: string; link_url: string } }
  | { name: "social_profile_click"; params: { link_domain: string; link_url: string } }
  | { name: "sparktribe_click"; params: { link_url: string } }
  | { name: "contact_click"; params: { method: "email" | "phone" | "contact_page" } }
  | { name: "contact_submit"; params: Record<string, never> }
  | { name: "practice_link_click"; params: { link_domain: string; link_url: string } }
  | { name: "interview_copy"; params: { format: "ai" | "list"; scope: "all" | "filtered"; count: number; content_slug: string } };

export type LinkClick = {
  href: string;
  /** The page the click happened on. */
  pageUrl: string;
  /** The link's rel attribute: "me" marks the owner's own profiles. */
  rel: string;
  /** data-analytics on the link or an ancestor, e.g. "project" for a project's own links. */
  context: string | null;
  /** Host of the SparkTribe site (Settings → Pages), when configured. */
  sparktribeHost: string | null;
};

const hostOf = (url: URL) => url.hostname.replace(/^www\./, "");

/** Which event (if any) a link click is. Internal navigation is left to page views. */
export function classifyLink(click: LinkClick): AnalyticsEvent | null {
  let url: URL;
  let page: URL;
  try {
    page = new URL(click.pageUrl);
    url = new URL(click.href, page);
  } catch {
    return null;
  }
  // The method only — never the address itself.
  if (url.protocol === "mailto:") return { name: "contact_click", params: { method: "email" } };
  if (url.protocol === "tel:") return { name: "contact_click", params: { method: "phone" } };
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  if (url.origin === page.origin) {
    return url.pathname === "/contact" && page.pathname !== "/contact" ? { name: "contact_click", params: { method: "contact_page" } } : null;
  }

  // Origin and path only: query strings and fragments can carry tokens or personal data.
  const link = { link_domain: hostOf(url), link_url: `${url.origin}${url.pathname}` };
  if (/(^|\s)me(\s|$)/.test(click.rel)) return { name: "social_profile_click", params: link };
  const spark = click.sparktribeHost?.replace(/^www\./, "");
  if (spark && (link.link_domain === spark || link.link_domain.endsWith(`.${spark}`))) return { name: "sparktribe_click", params: { link_url: link.link_url } };
  if (click.context === "project") return { name: "project_link_click", params: link };
  if (click.context === "practice") return { name: "practice_link_click", params: link };
  return { name: "outbound_click", params: link };
}

// ---------------------------------------------------------------------------
// Reading progress
// ---------------------------------------------------------------------------

export const READING_THRESHOLDS = [25, 50, 75, 90] as const;

/** Share of the reading column (0–100) the reader has scrolled past the bottom of the screen. */
export function readingPercent(top: number, height: number, viewportHeight: number): number {
  if (height <= 0) return 0;
  return Math.max(0, Math.min(100, ((viewportHeight - top) / height) * 100));
}

/** Thresholds reached for the first time; each fires at most once per page view. */
export function newThresholds(percent: number, fired: ReadonlySet<number>): number[] {
  return READING_THRESHOLDS.filter((t) => percent >= t && !fired.has(t));
}

// ---------------------------------------------------------------------------
// Sending (browser only)
// ---------------------------------------------------------------------------

type Gtag = (command: "event", name: string, params: Record<string, unknown>) => void;
declare global {
  interface Window {
    gtag?: Gtag;
  }
}

let allowed: boolean | undefined;

/** Decided once per page load, from the landing page. */
export function analyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  allowed ??= analyticsDecision({
    gaId: gaMeasurementId(process.env.NEXT_PUBLIC_GA_ID),
    nodeEnv: process.env.NODE_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    origin: window.location.origin,
    pathname: window.location.pathname,
    globalPrivacyControl: (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true,
  });
  return allowed;
}

/**
 * Events raised before GA's init script has run (a content view on the
 * landing page) wait here, so they reach GA after its config, in order.
 */
const pending: AnalyticsEvent[] = [];

function send(event: AnalyticsEvent): void {
  window.gtag?.("event", event.name, event.params);
}

/** Sends queued events once GA's init script has defined gtag. */
export function flushAnalytics(): boolean {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return false;
  for (const event of pending.splice(0)) send(event);
  return true;
}

export function track(event: AnalyticsEvent): void {
  if (!analyticsAllowed()) return;
  if (flushAnalytics()) send(event);
  else if (pending.length < 20) pending.push(event);
}

export const trackContentView = (params: { content_type: string; content_slug: string; content_title: string }) => track({ name: "content_view", params });
export const trackReadingProgress = (params: { percent: number; content_type: string; content_slug: string }) => track({ name: "reading_progress", params });
export const trackContactSubmit = () => track({ name: "contact_submit", params: {} });
export const trackInterviewCopy = (params: { format: "ai" | "list"; scope: "all" | "filtered"; count: number; content_slug: string }) => track({ name: "interview_copy", params });
