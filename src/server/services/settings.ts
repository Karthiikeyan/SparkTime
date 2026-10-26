import "server-only";
import { cache } from "react";
import { inArray } from "drizzle-orm";
import { DEFAULT_SETTINGS, SETTINGS_SCHEMAS, type SettingsKey, type SettingsValue } from "@/lib/settings";
import { siteConfig, type SocialLink } from "@/lib/site-config";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb } from "../db/client";
import { siteSettings } from "../db/schema";
import { invalid } from "../errors";
import { recordAudit } from "./audit";

function parseOrDefault<K extends SettingsKey>(key: K, raw: unknown): SettingsValue<K> {
  if (raw === undefined) return DEFAULT_SETTINGS[key];
  const result = SETTINGS_SCHEMAS[key].safeParse(raw);
  if (result.success) return result.data as SettingsValue<K>;
  console.warn(`[settings] stored value for "${key}" is invalid; using defaults.`);
  return DEFAULT_SETTINGS[key];
}

export async function getSettings<K extends SettingsKey>(key: K): Promise<SettingsValue<K>> {
  const all = await loadAllSettings();
  return all[key] as SettingsValue<K>;
}

type AllSettings = { [K in SettingsKey]: SettingsValue<K> };

/** All settings in one query, memoised per request. */
export const loadAllSettings = cache(async (): Promise<AllSettings> => {
  const keys = Object.keys(SETTINGS_SCHEMAS) as SettingsKey[];
  const rows = await getDb().select().from(siteSettings).where(inArray(siteSettings.key, keys));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<SettingsKey, unknown>;
  for (const key of keys) out[key] = parseOrDefault(key, byKey.get(key));
  return out as AllSettings;
});

export async function updateSettings<K extends SettingsKey>(actor: Actor, key: K, value: unknown): Promise<SettingsValue<K>> {
  assertAdmin(actor);
  const result = SETTINGS_SCHEMAS[key].safeParse(value);
  if (!result.success) {
    const details: Record<string, string> = {};
    for (const issue of result.error.issues) details[issue.path.join(".") || key] = issue.message;
    throw invalid("Some settings are invalid.", details);
  }
  await getDb()
    .insert(siteSettings)
    .values({ key, value: result.data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: result.data, updatedAt: new Date() } });
  await recordAudit(actor, "settings.update", "settings", key, `Updated ${key} settings`);
  return result.data as SettingsValue<K>;
}

/** What the whole site says about itself: Studio → Settings → Site, over the defaults in lib/site-config.ts. */
export type Brand = {
  name: string;
  author: string;
  byline: string;
  tagline: string;
  description: string;
  homeTitle: string;
  /** "%s · SparkTime": the page title format. */
  titleTemplate: string;
  authorSummary: string;
  social: SocialLink[];
};

export const getBrand = cache(async (): Promise<Brand> => {
  const { site, identity } = await loadAllSettings();
  const author = identity.name || siteConfig.author;
  return {
    name: site.name,
    author,
    byline: `by ${author}`,
    tagline: site.tagline,
    description: site.description,
    homeTitle: site.homeTitle || `${site.name} — Free guides, courses and interview experiences for engineers in India`,
    titleTemplate: `%s · ${site.name}`,
    authorSummary: site.authorSummary,
    social: site.social,
  };
});

/** The top-level topic slugs the home page and Library feature (Settings → Home page → Topics); every other topic is a note. */
export async function getFeaturedTopics(): Promise<string[]> {
  return (await loadAllSettings()).home.topics.slugs;
}
