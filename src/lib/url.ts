/**
 * URL safety. Every href/src that originates from content (editor JSON,
 * custom properties, navigation, settings) passes through these functions
 * before it is stored AND again before it is rendered.
 */

const MAX_URL_LENGTH = 2048;

// Browsers ignore ASCII control characters and whitespace inside a scheme
// ("java\tscript:" executes). Strip them before any scheme inspection.
const CONTROL_AND_SPACE = /[\u0000-\u0020\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;

export type SafeUrlOptions = {
  /** Allow same-site paths such as "/article/x". Default true. */
  allowRelative?: boolean;
  /** Allow "#fragment" links. Default true. */
  allowHash?: boolean;
  /** Allow mailto: links. Default true. */
  allowMailto?: boolean;
};

/**
 * Returns a normalised safe href, or null when the value must not become a
 * link. Only http(s), mailto and same-origin relative paths survive.
 */
export function safeHref(input: unknown, options: SafeUrlOptions = {}): string | null {
  const { allowRelative = true, allowHash = true, allowMailto = true } = options;
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  const probe = trimmed.replace(CONTROL_AND_SPACE, "");
  if (probe !== trimmed.replace(/\s/g, "")) {
    // Hidden control characters are never legitimate in a stored URL.
    return null;
  }

  if (probe.startsWith("#")) {
    return allowHash && /^#[\w\-:.]*$/.test(probe) ? probe : null;
  }

  if (probe.startsWith("/")) {
    if (!allowRelative) return null;
    return isSafeInternalPath(probe) ? probe : null;
  }

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(probe);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1]!.toLowerCase();

  if (scheme === "mailto") {
    return allowMailto && /^mailto:[^\s<>"']+@[^\s<>"']+$/i.test(probe) ? probe : null;
  }
  if (scheme !== "http" && scheme !== "https") return null;

  try {
    const url = new URL(probe);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    // Credentials in URLs are a phishing vector ("https://trusted.com@evil.com").
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Absolute http(s) URL only — used for external links, canonical URLs, profiles. */
export function safeExternalUrl(input: unknown): string | null {
  return safeHref(input, { allowRelative: false, allowHash: false, allowMailto: false });
}

/**
 * A same-origin path: starts with a single "/", has no scheme, no backslashes
 * (some browsers treat "/\\evil.com" as protocol-relative) and no encoded
 * slashes that could be decoded into "//".
 */
export function isSafeInternalPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (!path.startsWith("/") || path.length > MAX_URL_LENGTH) return false;
  if (path.startsWith("//") || path.includes("\\")) return false;
  // Encoded slashes/backslashes can be decoded by a browser or proxy into "//host".
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.startsWith("//") || decoded.includes("\\")) return false;
  if (path.replace(CONTROL_AND_SPACE, "") !== path || decoded.replace(CONTROL_AND_SPACE, "") !== decoded) return false;
  try {
    const resolved = new URL(path, "http://internal.invalid");
    return resolved.host === "internal.invalid";
  } catch {
    return false;
  }
}

/** Strip query/hash and trailing slash; used as the canonical key for redirects. */
export function normalizePath(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] ?? "/";
  const collapsed = withoutQuery.replace(/\/{2,}/g, "/");
  if (collapsed.length > 1 && collapsed.endsWith("/")) return collapsed.slice(0, -1);
  return collapsed || "/";
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
