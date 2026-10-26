/**
 * Site settings schemas and defaults. Settings are CMS-editable JSON rows;
 * these schemas are the contract (and the fallback if a row is missing or
 * malformed). Defaults deliberately contain NO invented facts: anything about
 * Karthikeyan that is not confirmed is an empty string or a marked TODO.
 */
import { z } from "zod";
import { isUuid } from "./content/blocks";
import { siteConfig } from "./site-config";
import { safeExternalUrl, safeHref } from "./url";

const uuidOrNull = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v && isUuid(v) ? v : null));

const text = (max: number) => z.string().trim().max(max).catch("");
const href = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return "";
    const safe = safeHref(v);
    if (!safe) ctx.addIssue({ code: "custom", message: "Enter a site path (/about) or an http(s) URL." });
    return safe ?? "";
  });

const cta = z.object({ label: text(60), href }).nullable().optional().transform((v) => (v && v.label && v.href ? v : null));

// ---------------------------------------------------------------------------

export const PROFILE_PLATFORMS = ["youtube", "linkedin", "github", "x", "instagram", "medium", "substack", "website", "other"] as const;
export type ProfilePlatform = (typeof PROFILE_PLATFORMS)[number];

export const profileSchema = z.object({
  id: z.string().min(1).max(40),
  platform: z.enum(PROFILE_PLATFORMS),
  label: text(60),
  url: z.string().transform((v, ctx) => {
    const safe = safeExternalUrl(v);
    if (!safe) ctx.addIssue({ code: "custom", message: "Profile URL must be an https:// link." });
    return safe ?? "";
  }),
  handle: text(80),
  /** Only enabled profiles are rendered anywhere. */
  enabled: z.boolean().default(false),
  /** Include in Person.sameAs — only for profiles that are verifiably yours. */
  sameAs: z.boolean().default(true),
  note: text(300),
});
export type Profile = z.infer<typeof profileSchema>;

export const pillarSchema = z.object({ label: text(60), description: text(240), href });

export const identitySchema = z.object({
  name: text(80),
  alternateNames: z.array(text(80)).max(10).catch([]),
  headline: text(160),
  description: text(320),
  jobTitle: text(120),
  worksFor: text(120),
  knowsAbout: z.array(text(80)).max(40).catch([]),
  location: text(120),
  imageMediaId: uuidOrNull,
  pillars: z.array(pillarSchema).max(8).catch([]),
});
export type Identity = z.infer<typeof identitySchema>;

export const seoSchema = z.object({
  defaultDescription: text(320),
  tagIndexThreshold: z.number().int().min(1).max(50).catch(3),
  twitterHandle: text(40),
  googleSiteVerification: text(120),
  bingSiteVerification: text(120),
});
export type SeoSettings = z.infer<typeof seoSchema>;

/** Content types a section draws from; empty = the section's sensible default (see lib/content/sections.ts). */
const typeIds = z.array(z.string()).max(20).catch([]).transform((ids) => ids.filter(isUuid));

// ---------------------------------------------------------------------------
// Site (brand) and Home page
//
// Reading is forgiving: a missing or malformed field becomes its default, so a
// value stored by an older layout (the section list) simply reads as the
// default page. Saving is strict: a link that isn't a site path or http(s) URL
// is reported, not quietly replaced.
// ---------------------------------------------------------------------------

/** A string that may be cleared on purpose; only a missing or malformed value falls back. */
const optionalText = (max: number, fallback: string) => z.string().trim().max(max).catch(fallback);
/** A string that is never blank: clearing it restores the default, so a heading or button can't vanish by accident. */
const requiredText = (max: number, fallback: string) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || fallback)
    .catch(fallback);
const flag = (fallback: boolean) => z.boolean().catch(fallback);
const count = (min: number, max: number, fallback: number) => z.number().int().min(min).max(max).catch(fallback);
/** A link that may be left empty; anything else must be a site path or http(s) URL. */
const optionalHref = z
  .string()
  .default("")
  .transform((v, ctx) => {
    const raw = v.trim();
    if (!raw) return "";
    const safe = safeHref(raw);
    if (!safe) ctx.addIssue({ code: "custom", message: "Enter a site path (/about) or an http(s) URL." });
    return safe ?? "";
  });
const requiredHref = (fallback: string) => optionalHref.transform((v) => v || fallback);
/** An object that is read as {} when it is missing, so each field can fall back to its own default. */
const group = <T extends z.ZodRawShape>(shape: T) => z.preprocess((v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}), z.object(shape));

export const socialLinkSchema = z.object({
  id: z.string().min(1).max(40),
  platform: z.enum(PROFILE_PLATFORMS),
  label: text(60),
  url: z.string().transform((v, ctx) => {
    const safe = safeExternalUrl(v);
    if (!safe) ctx.addIssue({ code: "custom", message: "Social link must be an https:// URL." });
    return safe ?? "";
  }),
});
export type SocialLinkSetting = z.infer<typeof socialLinkSchema>;

/**
 * The product's identity: its name, what it says about itself, and the links
 * the footer, the home page and the contact page share. Defaults are
 * lib/site-config.ts, so a site that never saved this panel reads the same.
 */
export const siteSchema = group({
  name: requiredText(40, siteConfig.name),
  /** The footer's line under the name. */
  tagline: requiredText(200, siteConfig.tagline),
  /** Default meta description and RSS description. */
  description: requiredText(320, siteConfig.description),
  /** The home page's <title>; blank derives "{name} — Free guides…". */
  homeTitle: optionalText(120, ""),
  /** Two sentences about the author, shown under their name on articles and the home page. */
  authorSummary: requiredText(400, siteConfig.authorSummary),
  social: z.array(socialLinkSchema).max(8).default(siteConfig.social),
});
export type SiteSettings = z.infer<typeof siteSchema>;

const popularSchema = z.object({ label: text(40), href: optionalHref, query: text(80) });

const heroSchema = group({
  eyebrow: optionalText(120, "Free · Practical · Written for engineers in India"),
  headline: requiredText(160, siteConfig.promise),
  subheadline: optionalText(400, "Free courses, real interview experiences and practical guides for freshers and early-career engineers. Written by a working software engineer."),
  /** "{count}" becomes the number of guides; with none published the number and its space are dropped. */
  searchPlaceholder: requiredText(120, "Search {count} guides, courses and interview experiences"),
  showStats: flag(true),
  popular: z
    .array(popularSchema)
    .max(8)
    .default(siteConfig.popular)
    .transform((items) => items.filter((p) => p.label).map((p) => ({ ...p, query: p.query || p.label }))),
});
const coursesSchema = group({
  enabled: flag(true),
  title: requiredText(120, "Start with your goal"),
  /** "{courses}" becomes "Three free courses". */
  intro: optionalText(300, "{courses}. Read in order, start to finish."),
  linkLabel: requiredText(40, "All courses →"),
});
const interviewsSchema = group({
  enabled: flag(true),
  title: requiredText(120, "Interview experiences, round by round"),
  intro: optionalText(300, "What candidates actually faced, organised by company and role, with every question we could find."),
  linkLabel: requiredText(40, "Browse all companies →"),
  /** Companies shown, most accounts first. */
  count: count(1, 8, 3),
  shareCard: group({
    enabled: flag(true),
    title: requiredText(80, "More companies coming"),
    text: optionalText(160, "Interviewed somewhere recently?"),
    linkLabel: requiredText(60, "Share your experience →"),
    href: requiredHref(siteConfig.shareInterviewHref),
  }),
});
const topicsSchema = group({
  enabled: flag(true),
  title: requiredText(120, "Browse the guides"),
  /** Top-level topic slugs, in order. The Library and /notes follow this list: every other topic is a note. */
  slugs: z
    .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
    .max(6)
    .default(siteConfig.featuredTopics),
});
const latestSchema = group({
  enabled: flag(true),
  title: requiredText(120, "Latest guides"),
  count: count(1, 12, 4),
  linkLabel: requiredText(40, "Full index →"),
});
const authorSchema = group({
  enabled: flag(true),
  label: requiredText(40, "Written by"),
  speakLabel: optionalText(60, "Invite me to speak"),
  speakHref: requiredHref(siteConfig.speakingHref),
});
const tribeSchema = group({
  enabled: flag(true),
  eyebrow: optionalText(60, "Learn in Tamil"),
  heading: requiredText(120, "Prefer learning in your mother tongue?"),
  body: optionalText(300, "SparkTribe teaches DSA and system design in Tamil, with a community preparing for top tech companies."),
  buttonLabel: requiredText(60, "Visit SparkTribe →"),
  href: requiredHref(siteConfig.sparktribeHref),
});

/**
 * The home page, band by band, in the order it renders. Counts (guides,
 * lessons, accounts, questions) are never stored: they are read from published content.
 */
export const homeSchema = group({
  hero: heroSchema,
  courses: coursesSchema,
  interviews: interviewsSchema,
  topics: topicsSchema,
  latest: latestSchema,
  author: authorSchema,
  tribe: tribeSchema,
});
export type HomeSettings = z.infer<typeof homeSchema>;

const uuidList = z.array(z.string()).max(20).catch([]).transform((ids) => ids.filter(isUuid));

/** One answer to "What brings you here?" on /start-here. */
export const pathSchema = z.object({ label: text(80), description: text(200), href });
export type StartHerePath = z.infer<typeof pathSchema>;

/** Visitor intents, answered in the owner's voice. A path to a page that isn't published is skipped. */
export const DEFAULT_START_HERE_PATHS: StartHerePath[] = [
  { label: "I want to know who you are", description: "My story, what I do, and what I'm working toward.", href: "/about" },
  { label: "I want something useful to read", description: "Essays, practical guides and short notes — the featured ones first.", href: "/blog" },
  { label: "I want to see what you've built", description: "SparkTribe, projects, and experiments with honest results.", href: "/work" },
  { label: "I'm preparing for placements", description: "SparkTribe is the platform I started to give students a clear path.", href: "/sparktribe" },
  { label: "I'd like you to speak at an event", description: "What I speak about, past sessions, and how to invite me.", href: "/speaking" },
  { label: "I want to see what you're up to now", description: "What has my attention at the moment.", href: "/now" },
];

export const pagesSchema = z.object({
  /** Content type whose documents form the journey timeline on /about. */
  journeyTypeId: uuidOrNull,
  /** Collections rendered on /uses and /start-here. */
  usesCollectionId: uuidOrNull,
  startHereCollectionId: uuidOrNull,
  /** The intent paths on /start-here; a path whose page isn't published hides itself. Never saved yet → the defaults; saved empty → none. */
  startHerePaths: z.array(pathSchema).max(8).default(DEFAULT_START_HERE_PATHS).catch(DEFAULT_START_HERE_PATHS),
  sparktribe: z
    .object({
      url: href,
      tagId: uuidOrNull,
      categoryId: uuidOrNull,
      /** Pieces in these topics end with a short note about SparkTribe (e.g. Career). */
      promoteCategoryIds: uuidList,
    })
    .catch({ url: "", tagId: null, categoryId: null, promoteCategoryIds: [] }),
});
export type PagesSettings = z.infer<typeof pagesSchema>;

/**
 * Site sections (/blog, /work, /speaking): what each is called, its one-line
 * promise, and which content types it gathers (none = automatic; see
 * lib/content/sections.ts). Speaking also carries what the owner speaks about
 * and the invitation, so an organiser has what they need on one page.
 */
const hubSchema = z.object({ title: text(60), intro: text(400), typeIds });
export const hubsSchema = z.object({
  writing: hubSchema.catch({ title: "Writing", intro: "", typeIds: [] }),
  work: hubSchema.catch({ title: "Work", intro: "", typeIds: [] }),
  speaking: hubSchema.extend({ topics: z.array(text(120)).max(12).catch([]), cta }).catch({ title: "Speaking", intro: "", typeIds: [], topics: [], cta: null }),
});
export type HubsSettings = z.infer<typeof hubsSchema>;

export const contactSchema = z.object({
  enabled: z.boolean().catch(true),
  reasons: z.array(text(60)).max(12).catch([]),
  successMessage: text(300),
  /** Public contact methods (links). Email addresses are never published by default. */
  methods: z.array(z.object({ label: text(60), href, description: text(200) })).max(10).catch([]),
});
export type ContactSettings = z.infer<typeof contactSchema>;

export const featuresSchema = z.object({
  graph: z.boolean().catch(true),
  search: z.boolean().catch(true),
  rss: z.boolean().catch(true),
});
export type FeatureSettings = z.infer<typeof featuresSchema>;

export const SETTINGS_SCHEMAS = {
  identity: identitySchema,
  profiles: z.array(profileSchema).max(30),
  seo: seoSchema,
  site: siteSchema,
  home: homeSchema,
  hubs: hubsSchema,
  pages: pagesSchema,
  contact: contactSchema,
  features: featuresSchema,
} as const;

export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
export type SettingsValue<K extends SettingsKey> = z.infer<(typeof SETTINGS_SCHEMAS)[K]>;

/** Settings → SEO title template ("%s — Name") applied to a page title. Shared by page metadata and the editor's preview. */
export function applyTitleTemplate(template: string, title: string, siteName: string): string {
  if (!title) return siteName;
  // "About Karthikeyan A" or the home page's "Karthikeyan A — …" already carry the name; never say it twice.
  if (mentionsName(title, siteName)) return title;
  return template.includes("%s") ? template.replace("%s", title) : `${title} — ${siteName}`;
}

/** The name as a whole phrase: "Karthikeyan A." yes, "Karthikeyan Always" no. */
function mentionsName(title: string, name: string): boolean {
  if (!name) return false;
  const at = title.indexOf(name);
  if (at < 0) return false;
  const letter = /[\p{L}\p{N}]/u;
  const before = title[at - 1];
  const after = title[at + name.length];
  return !(before && letter.test(before)) && !(after && letter.test(after));
}

export function isSettingsKey(value: unknown): value is SettingsKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMAS, value);
}

// ---------------------------------------------------------------------------
// Defaults. Facts here come only from material Karthikeyan wrote himself
// (his previous site's content); see docs/CONTENT-FACTS.md for provenance.
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: { [K in SettingsKey]: SettingsValue<K> } = {
  identity: {
    name: "Karthikeyan A",
    alternateNames: [],
    headline: "Software engineer, creator, speaker and founder — building things and sharing what I learn.",
    description:
      "Karthikeyan A is a software engineer, content creator, public speaker and founder of SparkTribe, writing about software engineering, careers, building products and financial independence.",
    jobTitle: "Senior Analyst",
    worksFor: "Capgemini",
    knowsAbout: ["Software Engineering", "AWS", "TypeScript", "Java", "Spring Boot", "Content Creation", "Public Speaking", "Personal Finance"],
    // In his own words on /who-am-i: "based in Bengaluru, India".
    location: "Bengaluru, India",
    imageMediaId: null,
    pillars: [
      { label: "Software Engineer", description: "Building production software with AWS, TypeScript, Java and Spring Boot.", href: "" },
      { label: "Content Creator", description: "Sharing what I learn through writing and video.", href: "" },
      { label: "Public Speaker", description: "Talks on engineering, careers and learning.", href: "" },
      { label: "Founder", description: "Founder of SparkTribe.", href: "/sparktribe" },
      { label: "Financial Independence", description: "Learning and writing about money, investing and FI.", href: "" },
    ],
  },
  profiles: [
    {
      id: "youtube",
      platform: "youtube",
      label: "YouTube",
      url: "https://www.youtube.com/@trendiikarthii",
      handle: "@trendiikarthii",
      enabled: false,
      sameAs: true,
      note: "Found in the SparkTribe site's contact page. Confirm this is your personal channel, then enable it.",
    },
    {
      id: "linkedin",
      platform: "linkedin",
      label: "LinkedIn",
      url: "https://www.linkedin.com/in/trendiikarthii",
      handle: "trendiikarthii",
      enabled: false,
      sameAs: true,
      note: "Found in the SparkTribe site's contact page. Confirm this is your personal profile, then enable it.",
    },
  ],
  seo: {
    defaultDescription:
      "Karthikeyan A — software engineer, content creator, public speaker and founder. Writing, projects, talks and resources on engineering, careers, building and financial independence.",
    tagIndexThreshold: 3,
    twitterHandle: "",
    googleSiteVerification: "",
    bingSiteVerification: "",
  },
  // The product's name, tagline and links come from lib/site-config.ts; the home page's own wording is the schema's defaults.
  site: siteSchema.parse({}),
  home: homeSchema.parse({}),
  hubs: {
    writing: {
      title: "Writing",
      intro: "Essays, practical guides and short notes on software, careers, building things and money — written down so they're useful to someone else.",
      typeIds: [],
    },
    work: {
      title: "Work",
      intro: "What I build — at work, on my own, and the experiments that taught me something along the way.",
      typeIds: [],
    },
    speaking: {
      title: "Speaking",
      intro: "Talks, sessions and videos — and an open invitation if you're organising something for students or engineers.",
      typeIds: [],
      // The "Public Speaker" pillar, in the owner's words: talks on engineering, careers and learning.
      topics: ["Software engineering", "Careers and placements", "Learning and building in public"],
      cta: { label: "Invite me to speak", href: "/contact?reason=Speaking" },
    },
  },
  pages: {
    journeyTypeId: null,
    usesCollectionId: null,
    startHereCollectionId: null,
    startHerePaths: DEFAULT_START_HERE_PATHS,
    sparktribe: { url: "", tagId: null, categoryId: null, promoteCategoryIds: [] },
  },
  contact: {
    enabled: true,
    reasons: ["Speaking", "Collaboration", "Consulting", "Community", "Career", "Something else"],
    successMessage: "Thanks — your message has arrived. I read everything and reply when I can.",
    methods: [],
  },
  features: { graph: true, search: true, rss: true },
};
