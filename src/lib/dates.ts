/**
 * All user-visible date formatting goes through here. Locale and time zone
 * are pinned so server and browser render identical strings (a bare
 * toLocaleDateString() causes hydration mismatches).
 */

export const SITE_LOCALE = "en-GB";
export const SITE_TIME_ZONE = process.env.NEXT_PUBLIC_SITE_TIME_ZONE || "Asia/Kolkata";

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const formatters = {
  long: new Intl.DateTimeFormat(SITE_LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: SITE_TIME_ZONE }),
  medium: new Intl.DateTimeFormat(SITE_LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: SITE_TIME_ZONE }),
  monthYear: new Intl.DateTimeFormat(SITE_LOCALE, { month: "short", year: "numeric", timeZone: SITE_TIME_ZONE }),
  year: new Intl.DateTimeFormat(SITE_LOCALE, { year: "numeric", timeZone: SITE_TIME_ZONE }),
  dateTime: new Intl.DateTimeFormat(SITE_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: SITE_TIME_ZONE,
  }),
  time: new Intl.DateTimeFormat(SITE_LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: SITE_TIME_ZONE }),
} as const;

export type DateStyle = keyof typeof formatters;

export function formatDate(value: DateInput, style: DateStyle = "medium"): string {
  const date = toDate(value);
  return date ? formatters[style].format(date) : "";
}

const dateOnlyFormatters = {
  long: new Intl.DateTimeFormat(SITE_LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
  monthYear: new Intl.DateTimeFormat(SITE_LOCALE, { month: "short", year: "numeric", timeZone: "UTC" }),
  year: new Intl.DateTimeFormat(SITE_LOCALE, { year: "numeric", timeZone: "UTC" }),
} as const;

/** Calendar dates ("2026-02-01") are formatted in UTC so they never shift a day. */
export function formatDateOnly(value: string | null | undefined, style: keyof typeof dateOnlyFormatters = "long"): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : dateOnlyFormatters[style].format(date);
}

/**
 * A span of calendar dates: "2017 – 2021", "2021 – now", or month precision
 * when it starts and ends in the same year ("May 2026", "Mar – Jun 2026"),
 * so a one-month experiment never reads "2026 – 2026".
 */
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  const startYear = formatDateOnly(start, "year");
  const endYear = formatDateOnly(end, "year");
  if (!startYear) return endYear;
  if (!endYear) return `${startYear} – now`;
  if (startYear !== endYear) return `${startYear} – ${endYear}`;
  const from = formatDateOnly(start, "monthYear");
  const to = formatDateOnly(end, "monthYear");
  return from === to ? from : `${from.split(" ")[0]} – ${to}`;
}

/**
 * `<input type="datetime-local">` speaks the browser's local wall-clock time
 * ("2026-09-13T15:30"), while we store UTC ISO strings. Both directions must
 * use local time: slicing an ISO string shows UTC, and reading it back as
 * local shifts the stored instant by the UTC offset on every edit.
 */
export function toDateTimeLocal(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The inverse of toDateTimeLocal: a local wall-clock value → UTC ISO string (or null when empty/invalid). */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value); // no offset in the string → parsed as local time
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toIsoString(value: DateInput): string | undefined {
  return toDate(value)?.toISOString();
}

/** "Updated" is only worth showing when it is meaningfully later than publication. */
export function isMeaningfullyUpdated(publishedAt: DateInput, modifiedAt: DateInput): boolean {
  const published = toDate(publishedAt);
  const modified = toDate(modifiedAt);
  if (!published || !modified) return false;
  return modified.getTime() - published.getTime() > 24 * 60 * 60 * 1000;
}

export function relativeTime(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return "";
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(SITE_LOCALE, { numeric: "auto" });
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), "day");
  return formatDate(date, "medium");
}
