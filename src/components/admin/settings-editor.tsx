"use client";

import { ArrowDown, ArrowUp, Download, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { HUB_KEYS, HUB_PATHS, resolveHubTypeIds, type HubKey, type SectionableType } from "@/lib/content/sections";
import {
  DEFAULT_SETTINGS,
  DEFAULT_START_HERE_PATHS,
  PROFILE_PLATFORMS,
  type ContactSettings,
  type FeatureSettings,
  type HomeSettings,
  type HubsSettings,
  type Identity,
  type PagesSettings,
  type Profile,
  type SeoSettings,
  type SiteSettings,
} from "@/lib/settings";
import type { MediaAsset } from "@/lib/media";
import { api, errorMessage } from "./api";
import { InlineSwitch, Select, TextArea, TextInput, Toggle } from "./fields";
import { useMediaPicker } from "./media-picker";
import { useToast } from "./toast";

type Option = { id: string; name: string };

export type SettingsBootstrap = {
  identity: Identity;
  profiles: Profile[];
  seo: SeoSettings;
  site: SiteSettings;
  home: HomeSettings;
  hubs: HubsSettings;
  pages: PagesSettings;
  contact: ContactSettings;
  features: FeatureSettings;
  portrait: MediaAsset | null;
  types: Option[];
  sectionTypes: Array<SectionableType & { name: string }>;
  collections: Option[];
  categories: Option[];
  tags: Option[];
  /** Top-level topics, for choosing the home page's main topics. */
  topics: Array<{ slug: string; name: string }>;
  system: { siteUrl: string; mediaDriver: string; github: boolean; allowlist: string; database: string; devLogin: boolean };
};

const lines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

const GROUP_KEYS = ["identity", "profiles", "seo", "site", "home", "hubs", "pages", "contact", "features"] as const;
type GroupKey = (typeof GROUP_KEYS)[number];

function snapshot(source: Record<GroupKey, unknown>): Record<GroupKey, string> {
  return Object.fromEntries(GROUP_KEYS.map((k) => [k, JSON.stringify(source[k])])) as Record<GroupKey, string>;
}

/** The panels, in the order they're listed. One is shown at a time; the rest stay mounted, so unsaved edits survive switching. */
const PANELS = [
  ["identity", "Identity"],
  ["profiles", "Profiles"],
  ["seo", "SEO"],
  ["site", "Site & brand"],
  ["home", "Home page"],
  ["hubs", "Site sections"],
  ["pages", "Pages"],
  ["contact", "Contact"],
  ["features", "Features"],
  ["system", "System & data"],
] as const;
type PanelId = (typeof PANELS)[number][0];
const isPanel = (v: string): v is PanelId => PANELS.some(([id]) => id === v);

/** The panel named in the URL hash (/admin/settings#profiles), so dashboard links land on the right one. */
function usePanel(): PanelId {
  const [panel, setPanel] = useState<PanelId>("identity");
  useEffect(() => {
    const read = () => {
      const id = window.location.hash.slice(1);
      if (isPanel(id)) {
        setPanel(id);
        window.scrollTo({ top: 0 });
      }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return panel;
}

function Group({ id, title, description, children, onSave, busy, dirty = false, current }: { id: PanelId; title: string; description?: string; children: React.ReactNode; onSave?: () => void; busy?: boolean; dirty?: boolean; current: PanelId }) {
  return (
    <section id={id} hidden={current !== id} className={cn("scroll-mt-20 rounded-md border bg-surface p-5 transition-colors", dirty ? "border-accent/60" : "border-line")} aria-labelledby={`${id}-h`}>
      {/* Sticky within its own section, so Save stays in reach while scrolling a long group (Home page). */}
      <div className="sticky top-14 z-10 -mx-5 -mt-5 mb-4 flex items-start justify-between gap-4 rounded-t-md bg-surface/95 px-5 pb-3 pt-5 backdrop-blur-sm lg:top-0">
        <div>
          <h2 id={`${id}-h`} className="font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {onSave && (
          <div className="flex shrink-0 items-center gap-3">
            {dirty && !busy && (
              <span className="hidden text-xs text-accent sm:inline" role="status">
                Unsaved changes
              </span>
            )}
            <button type="button" onClick={onSave} disabled={busy || !dirty} className={cn("btn btn-md", dirty ? "btn-accent" : "btn-ghost")} title={dirty ? undefined : "No changes to save"}>
              {busy ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </div>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** What each site section is for, in the words a visitor would use. */
const HUB_HELP: Record<HubKey, string> = {
  writing: "Everything written — one stream at /blog, with each format as a tab. Automatic: types using the Editorial or Minimal template (articles, guides, notes, reviews).",
  work: "What you build — SparkTribe, work in progress, projects and experiments, at /work. Automatic: Project-template types, and Story-template types with a Status field.",
  speaking: "For organisers — what you speak about, the invitation, then talks and videos, at /speaking. Automatic: Media-template types and types with an event field.",
};

/** A chip row for choosing ids (content types, topics). */
function ChipPicker({ options, value, onChange }: { options: Option[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])} className={on ? "chip border-accent text-xs text-accent" : "chip text-xs"}>
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

/** One band of the home page: a titled card with an optional Visible switch. */
function HomeBand({ title, help, enabled, onEnabled, children }: { title: string; help?: string; enabled?: boolean; onEnabled?: (v: boolean) => void; children: React.ReactNode }) {
  const off = enabled === false;
  return (
    <div className="rounded-sm border border-line p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="flex-1" />
        {onEnabled && <InlineSwitch label="Visible" checked={enabled !== false} onChange={onEnabled} />}
      </div>
      {help && <p className="mt-1 text-xs text-muted">{help}</p>}
      <div className={cn("mt-3 space-y-4", off && "opacity-60")}>{children}</div>
    </div>
  );
}

export function SettingsEditor({ initial }: { initial: SettingsBootstrap }) {
  const router = useRouter();
  const toast = useToast();
  const { pick, element } = useMediaPicker();
  const [identity, setIdentity] = useState(initial.identity);
  const [portrait, setPortrait] = useState(initial.portrait);
  const [profiles, setProfiles] = useState(initial.profiles);
  const [seo, setSeo] = useState(initial.seo);
  const [site, setSite] = useState(initial.site);
  const [home, setHome] = useState(initial.home);
  const [hubs, setHubs] = useState(initial.hubs);
  const [pages, setPages] = useState(initial.pages);
  const [contact, setContact] = useState(initial.contact);
  const [features, setFeatures] = useState(initial.features);
  const [busy, setBusy] = useState<string | null>(null);
  const panel = usePanel();

  // What each group would save right now, and what was last saved — so a
  // flipped switch or edited field visibly waits for its group's Save.
  const values: Record<GroupKey, unknown> = {
    identity: { ...identity, imageMediaId: portrait?.id ?? null },
    profiles,
    seo,
    site,
    home,
    hubs,
    pages,
    contact,
    features,
  };
  const [baseline, setBaseline] = useState<Record<GroupKey, string>>(() =>
    snapshot({ ...initial, identity: { ...initial.identity, imageMediaId: initial.portrait?.id ?? null }, }),
  );
  const isDirty = (key: GroupKey) => JSON.stringify(values[key]) !== baseline[key];
  const anyDirty = GROUP_KEYS.some(isDirty);

  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const save = async (key: GroupKey) => {
    const value = values[key];
    setBusy(key);
    try {
      await api(`/api/admin/settings/${key}`, { method: "PUT", body: value });
      setBaseline((b) => ({ ...b, [key]: JSON.stringify(value) }));
      toast.success("Saved — the public site is updated.");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const groupProps = (key: GroupKey) => ({ onSave: () => void save(key), busy: busy === key, dirty: isDirty(key), current: panel });

  const hubMembers = resolveHubTypeIds(initial.sectionTypes, { writing: hubs.writing.typeIds, work: hubs.work.typeIds, speaking: hubs.speaking.typeIds }, pages.journeyTypeId ? [pages.journeyTypeId] : []);
  const typeName = (id: string) => initial.sectionTypes.find((t) => t.id === id)?.name ?? "";
  const updateHub = <K extends HubKey>(key: K, patch: Partial<HubsSettings[K]>) => setHubs((h) => ({ ...h, [key]: { ...h[key], ...patch } }));
  const updatePath = (i: number, patch: Partial<PagesSettings["startHerePaths"][number]>) => setPages((p) => ({ ...p, startHerePaths: p.startHerePaths.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  const updateHome = <K extends keyof HomeSettings>(key: K, patch: Partial<HomeSettings[K]>) => setHome((h) => ({ ...h, [key]: { ...h[key], ...patch } }));
  const topicName = (slug: string) => initial.topics.find((t) => t.slug === slug)?.name ?? slug;

  return (
    <div className="grid gap-6 px-6 py-6 lg:grid-cols-[12rem_1fr] lg:gap-8 lg:px-10 lg:py-8">
      {element}
      {/* One panel at a time: a column of links on a laptop, a scrolling row on a phone. A dot marks a panel with unsaved changes. */}
      <nav aria-label="Settings sections" className="-mx-6 overflow-x-auto border-b border-line px-6 lg:mx-0 lg:overflow-visible lg:border-0 lg:px-0">
        <ul className="flex min-w-max gap-1 text-sm lg:sticky lg:top-6 lg:min-w-0 lg:flex-col lg:gap-0.5">
          {PANELS.map(([id, label]) => {
            const dirty = (GROUP_KEYS as readonly string[]).includes(id) && isDirty(id as GroupKey);
            const here = panel === id;
            return (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={here ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center justify-between gap-2 whitespace-nowrap rounded-sm px-2.5 py-1.5 transition-colors",
                    here ? "bg-surface-2 font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {label}
                  {dirty && (
                    <span className="size-1.5 rounded-full bg-accent" title="Unsaved changes">
                      <span className="sr-only">(unsaved changes)</span>
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="max-w-3xl space-y-6">
        <Group id="identity" title="Identity" description="Your Person entity for search engines. Only state what's true — empty fields are simply omitted." {...groupProps("identity")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Name" value={identity.name} onChange={(v) => setIdentity({ ...identity, name: v })} help="Use exactly the same name everywhere (site, YouTube, LinkedIn, GitHub)." />
            <TextInput label="Alternate names (comma separated)" value={identity.alternateNames.join(", ")} onChange={(v) => setIdentity({ ...identity, alternateNames: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <TextInput label="Job title" value={identity.jobTitle} onChange={(v) => setIdentity({ ...identity, jobTitle: v })} />
            <TextInput label="Works for" value={identity.worksFor} onChange={(v) => setIdentity({ ...identity, worksFor: v })} />
            <TextInput label="Location (optional)" value={identity.location} onChange={(v) => setIdentity({ ...identity, location: v })} />
            <TextInput label="Knows about (comma separated)" value={identity.knowsAbout.join(", ")} onChange={(v) => setIdentity({ ...identity, knowsAbout: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
          </div>
          <TextInput label="Headline (one line under your name on the About page)" value={identity.headline} onChange={(v) => setIdentity({ ...identity, headline: v })} maxLength={160} />
          <TextArea label="Description (Person.description and default meta)" value={identity.description} onChange={(v) => setIdentity({ ...identity, description: v })} rows={3} maxLength={320} />
          <div className="flex items-center gap-4">
            {portrait ? (
              // eslint-disable-next-line @next/next/no-img-element -- admin preview
              <img src={portrait.variants[0]?.url ?? portrait.url} alt="" className="size-16 rounded-sm object-cover" />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-sm bg-surface-2 text-xs text-subtle">No photo</span>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { const a = await pick("image"); if (a) setPortrait(a); }}>
              Choose portrait
            </button>
            {portrait && (
              <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => setPortrait(null)}>
                Remove
              </button>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Pillars (shown on the About page)</p>
            <div className="mt-2 space-y-2">
              {identity.pillars.map((p, i) => (
                <div key={i} className="grid gap-2 rounded-sm border border-line p-2 sm:grid-cols-[10rem_1fr_9rem_auto]">
                  <input value={p.label} onChange={(e) => setIdentity({ ...identity, pillars: identity.pillars.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label" className="rounded-xs border border-line bg-bg px-2 py-1 text-sm" aria-label="Pillar label" />
                  <input value={p.description} onChange={(e) => setIdentity({ ...identity, pillars: identity.pillars.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} placeholder="Description" className="rounded-xs border border-line bg-bg px-2 py-1 text-sm" aria-label="Pillar description" />
                  <input value={p.href} onChange={(e) => setIdentity({ ...identity, pillars: identity.pillars.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)) })} placeholder="/technology" className="rounded-xs border border-line bg-bg px-2 py-1 font-mono text-xs" aria-label="Pillar link" />
                  <button type="button" onClick={() => setIdentity({ ...identity, pillars: identity.pillars.filter((_, j) => j !== i) })} aria-label="Remove pillar" className="p-1 text-subtle hover:text-danger">
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIdentity({ ...identity, pillars: [...identity.pillars, { label: "", description: "", href: "" }] })}>
                <Plus size={13} aria-hidden="true" /> Add pillar
              </button>
            </div>
          </div>
        </Group>

        <Group id="profiles" title="Profiles" description="Links to your accounts elsewhere. Enable only profiles that are verifiably yours — they become sameAs identity signals." {...groupProps("profiles")}>
          {profiles.map((p, i) => (
            <div key={p.id} className="rounded-sm border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-[9rem_1fr_9rem]">
                <select value={p.platform} onChange={(e) => setProfiles(profiles.map((x, j) => (j === i ? { ...x, platform: e.target.value as Profile["platform"] } : x)))} className="rounded-xs border border-line bg-bg px-2 py-1.5 text-sm" aria-label="Platform">
                  {PROFILE_PLATFORMS.map((pl) => (
                    <option key={pl} value={pl}>
                      {pl}
                    </option>
                  ))}
                </select>
                <input value={p.url} onChange={(e) => setProfiles(profiles.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://" className="rounded-xs border border-line bg-bg px-2 py-1.5 font-mono text-xs" aria-label="Profile URL" />
                <input value={p.handle} onChange={(e) => setProfiles(profiles.map((x, j) => (j === i ? { ...x, handle: e.target.value } : x)))} placeholder="@handle" className="rounded-xs border border-line bg-bg px-2 py-1.5 text-sm" aria-label="Handle" />
              </div>
              {p.note && <p className="mt-2 rounded-xs bg-warning/10 px-2 py-1 text-xs text-warning">{p.note}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={p.enabled} onChange={(e) => setProfiles(profiles.map((x, j) => (j === i ? { ...x, enabled: e.target.checked, note: e.target.checked ? "" : x.note } : x)))} className="accent-[var(--accent)]" /> Show on site
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={p.sameAs} onChange={(e) => setProfiles(profiles.map((x, j) => (j === i ? { ...x, sameAs: e.target.checked } : x)))} className="accent-[var(--accent)]" /> Identity signal (sameAs)
                </label>
                <span className="flex-1" />
                <button type="button" onClick={() => setProfiles(profiles.filter((_, j) => j !== i))} aria-label="Remove profile" className="text-subtle hover:text-danger">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProfiles([...profiles, { id: `p-${Date.now().toString(36)}`, platform: "website", label: "", url: "", handle: "", enabled: false, sameAs: true, note: "" }])}>
            <Plus size={13} aria-hidden="true" /> Add profile
          </button>
        </Group>

        <Group id="seo" title="SEO" description="Defaults and ownership verification. Verify the site in Google Search Console and Bing Webmaster Tools, then submit /sitemap.xml." {...groupProps("seo")}>
          <p className="rounded-sm bg-surface-2 px-3 py-2 text-xs text-muted">Page titles are “Page title · {site.name || "Site name"}”. Change the name in Site &amp; brand.</p>
          <TextArea label="Fallback description (topic pages without their own)" value={seo.defaultDescription} onChange={(v) => setSeo({ ...seo, defaultDescription: v })} rows={2} maxLength={320} help="The site-wide description for the home page, search results and RSS is in Site & brand." />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput label="Tag index threshold" type="number" value={String(seo.tagIndexThreshold)} onChange={(v) => setSeo({ ...seo, tagIndexThreshold: Math.max(1, Math.min(50, Number(v) || 3)) })} help="Tags with fewer public pieces stay noindex." />
            <TextInput label="X/Twitter handle" value={seo.twitterHandle} onChange={(v) => setSeo({ ...seo, twitterHandle: v })} placeholder="@handle" />
            <TextInput label="Google verification code" value={seo.googleSiteVerification} onChange={(v) => setSeo({ ...seo, googleSiteVerification: v })} mono />
          </div>
          <TextInput label="Bing verification code (msvalidate.01)" value={seo.bingSiteVerification} onChange={(v) => setSeo({ ...seo, bingSiteVerification: v })} mono />
        </Group>

        <Group
          id="site"
          title="Site & brand"
          description="The name and wording the whole site shares: header, footer, page titles, search results, the RSS feed and share cards. Page titles read “Page · Name”."
          {...groupProps("site")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Site name" value={site.name} onChange={(v) => setSite({ ...site, name: v })} maxLength={40} help="Header, footer, tab titles, share cards, the RSS feed and the web app name." />
            <TextInput
              label="Home page title (tab and search results)"
              value={site.homeTitle}
              onChange={(v) => setSite({ ...site, homeTitle: v })}
              maxLength={120}
              placeholder={`${site.name || "Name"} — Free guides, courses and interview experiences for engineers in India`}
              help="Leave empty to use the wording shown here."
            />
          </div>
          <TextInput label="Footer line (under the name)" value={site.tagline} onChange={(v) => setSite({ ...site, tagline: v })} maxLength={200} />
          <TextArea label="Site description (default meta description and RSS)" value={site.description} onChange={(v) => setSite({ ...site, description: v })} rows={2} maxLength={320} />
          <TextArea label="Author summary" value={site.authorSummary} onChange={(v) => setSite({ ...site, authorSummary: v })} rows={2} maxLength={400} help="Under your name on the home page and the author card at the end of every article." />
          <div>
            <p className="text-xs font-medium text-muted">Social links (footer, home page, contact page and “Get new guides”)</p>
            <div className="mt-2 space-y-2">
              {site.social.map((s, i) => {
                const update = (patch: Partial<typeof s>) => setSite({ ...site, social: site.social.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={s.id} className="grid gap-2 rounded-sm border border-line p-2 sm:grid-cols-[8rem_9rem_1fr_auto]">
                    <select value={s.platform} onChange={(e) => update({ platform: e.target.value as Profile["platform"] })} className="rounded-xs border border-line bg-bg px-2 py-1 text-sm" aria-label="Platform">
                      {PROFILE_PLATFORMS.map((pl) => (
                        <option key={pl} value={pl}>
                          {pl}
                        </option>
                      ))}
                    </select>
                    <input value={s.label} onChange={(e) => update({ label: e.target.value })} placeholder="Label" className="rounded-xs border border-line bg-bg px-2 py-1 text-sm" aria-label="Label" />
                    <input value={s.url} onChange={(e) => update({ url: e.target.value })} placeholder="https://" className="rounded-xs border border-line bg-bg px-2 py-1 font-mono text-xs" aria-label="URL" />
                    <span className="flex items-center">
                      <button type="button" disabled={i === 0} onClick={() => setSite({ ...site, social: swap(site.social, i, i - 1) })} aria-label="Move up" className="p-1 text-subtle disabled:opacity-30">
                        <ArrowUp size={13} aria-hidden="true" />
                      </button>
                      <button type="button" disabled={i === site.social.length - 1} onClick={() => setSite({ ...site, social: swap(site.social, i, i + 1) })} aria-label="Move down" className="p-1 text-subtle disabled:opacity-30">
                        <ArrowDown size={13} aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => setSite({ ...site, social: site.social.filter((_, j) => j !== i) })} aria-label="Remove link" className="p-1 text-subtle hover:text-danger">
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                );
              })}
              {site.social.length < 8 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSite({ ...site, social: [...site.social, { id: `s-${Date.now().toString(36)}`, platform: "website", label: "", url: "" }] })}>
                  <Plus size={13} aria-hidden="true" /> Add link
                </button>
              )}
            </div>
          </div>
          <p className="rounded-sm bg-surface-2 px-3 py-2 text-xs text-muted">
            The logo is <span className="font-mono">public/images/Logo.png</span>. To change it, replace that file and run <span className="font-mono">node scripts/make-brand-assets.mjs</span>: it rebuilds the header mark, the browser-tab icon and the home-screen icons.
          </p>
        </Group>

        <Group
          id="home"
          title="Home page"
          description="What the home page says, band by band, top to bottom. Counts (guides, lessons, interview accounts, questions) are never typed in: they are counted from what is published."
          {...groupProps("home")}
        >
          <p className="text-xs text-muted">
            Changes appear on the public home page as soon as you save.{" "}
            <Link href="/" target="_blank" rel="noopener" className="font-medium text-accent hover:underline">
              Open the home page ↗
            </Link>
          </p>

          <HomeBand title="Top of the page" help="The headline, the search box and the “Popular” shortcuts.">
            <TextInput label="Eyebrow (small line above the headline)" value={home.hero.eyebrow} onChange={(v) => updateHome("hero", { eyebrow: v })} maxLength={120} />
            <TextArea label="Headline" value={home.hero.headline} onChange={(v) => updateHome("hero", { headline: v })} rows={2} maxLength={160} />
            <TextArea label="Supporting line" value={home.hero.subheadline} onChange={(v) => updateHome("hero", { subheadline: v })} rows={2} maxLength={400} />
            <TextInput label="Search box placeholder" value={home.hero.searchPlaceholder} onChange={(v) => updateHome("hero", { searchPlaceholder: v })} maxLength={120} help="{count} becomes the number of published guides." />
            <Toggle label="Show the numbers row" checked={home.hero.showStats} onChange={(v) => updateHome("hero", { showStats: v })} help="Guides, courses and lessons, interview accounts, questions: each counted from published content." />
            <div>
              <p className="text-xs font-medium text-muted">Popular shortcuts</p>
              <p className="mt-0.5 text-xs text-subtle">A shortcut opens its page; if that page isn&apos;t published yet it searches for the search text instead, so it never leads to a dead end.</p>
              <div className="mt-2 space-y-2">
                {home.hero.popular.map((p, i) => {
                  const update = (patch: Partial<typeof p>) => updateHome("hero", { popular: home.hero.popular.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                  return (
                    <div key={i} className="grid gap-2 rounded-sm border border-line p-2 sm:grid-cols-[10rem_1fr_10rem_auto]">
                      <input value={p.label} onChange={(e) => update({ label: e.target.value })} placeholder="Label" maxLength={40} className="rounded-xs border border-line bg-bg px-2 py-1 text-sm" aria-label="Shortcut label" />
                      <input value={p.href} onChange={(e) => update({ href: e.target.value })} placeholder="/interviews/zoho" className="rounded-xs border border-line bg-bg px-2 py-1 font-mono text-xs" aria-label="Shortcut link" />
                      <input value={p.query} onChange={(e) => update({ query: e.target.value })} placeholder="Search text" maxLength={80} className="rounded-xs border border-line bg-bg px-2 py-1 text-sm" aria-label="Search text" />
                      <span className="flex items-center">
                        <button type="button" disabled={i === 0} onClick={() => updateHome("hero", { popular: swap(home.hero.popular, i, i - 1) })} aria-label="Move up" className="p-1 text-subtle disabled:opacity-30">
                          <ArrowUp size={13} aria-hidden="true" />
                        </button>
                        <button type="button" disabled={i === home.hero.popular.length - 1} onClick={() => updateHome("hero", { popular: swap(home.hero.popular, i, i + 1) })} aria-label="Move down" className="p-1 text-subtle disabled:opacity-30">
                          <ArrowDown size={13} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => updateHome("hero", { popular: home.hero.popular.filter((_, j) => j !== i) })} aria-label="Remove shortcut" className="p-1 text-subtle hover:text-danger">
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                  );
                })}
                {home.hero.popular.length < 8 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateHome("hero", { popular: [...home.hero.popular, { label: "", href: "", query: "" }] })}>
                    <Plus size={13} aria-hidden="true" /> Add shortcut
                  </button>
                )}
              </div>
            </div>
          </HomeBand>

          <HomeBand title="Courses" help="One card per published course (Course format), with its lesson count and hours." enabled={home.courses.enabled} onEnabled={(v) => updateHome("courses", { enabled: v })}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="Heading" value={home.courses.title} onChange={(v) => updateHome("courses", { title: v })} maxLength={120} />
              <TextInput label="“See all” link text" value={home.courses.linkLabel} onChange={(v) => updateHome("courses", { linkLabel: v })} maxLength={40} />
            </div>
            <TextInput label="Intro" value={home.courses.intro} onChange={(v) => updateHome("courses", { intro: v })} maxLength={300} help="{courses} becomes “Three free courses”, counted from what is published." />
          </HomeBand>

          <HomeBand title="Interview experiences" help="The companies with the most interview accounts, then an invitation to share one." enabled={home.interviews.enabled} onEnabled={(v) => updateHome("interviews", { enabled: v })}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="Heading" value={home.interviews.title} onChange={(v) => updateHome("interviews", { title: v })} maxLength={120} />
              <TextInput label="“Browse all” link text" value={home.interviews.linkLabel} onChange={(v) => updateHome("interviews", { linkLabel: v })} maxLength={40} />
            </div>
            <TextArea label="Intro" value={home.interviews.intro} onChange={(v) => updateHome("interviews", { intro: v })} rows={2} maxLength={300} />
            <TextInput label="How many companies" type="number" value={String(home.interviews.count)} onChange={(v) => updateHome("interviews", { count: Math.max(1, Math.min(8, Number(v) || 3)) })} help="Most accounts first." />
            <div className="rounded-sm border border-dashed border-line p-3">
              <Toggle label="Show the “share your experience” card" checked={home.interviews.shareCard.enabled} onChange={(v) => updateHome("interviews", { shareCard: { ...home.interviews.shareCard, enabled: v } })} />
              {home.interviews.shareCard.enabled && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <TextInput label="Title" value={home.interviews.shareCard.title} onChange={(v) => updateHome("interviews", { shareCard: { ...home.interviews.shareCard, title: v } })} maxLength={80} />
                  <TextInput label="Line under the title" value={home.interviews.shareCard.text} onChange={(v) => updateHome("interviews", { shareCard: { ...home.interviews.shareCard, text: v } })} maxLength={160} />
                  <TextInput label="Link text" value={home.interviews.shareCard.linkLabel} onChange={(v) => updateHome("interviews", { shareCard: { ...home.interviews.shareCard, linkLabel: v } })} maxLength={60} />
                  <TextInput label="Link" value={home.interviews.shareCard.href} onChange={(v) => updateHome("interviews", { shareCard: { ...home.interviews.shareCard, href: v } })} mono />
                </div>
              )}
            </div>
          </HomeBand>

          <HomeBand
            title="Browse the guides"
            help="Your main topics, in this order, each with its count, description and sub-topics. Every other top-level topic is a note: the Library and /notes follow this list too."
            enabled={home.topics.enabled}
            onEnabled={(v) => updateHome("topics", { enabled: v })}
          >
            <TextInput label="Heading" value={home.topics.title} onChange={(v) => updateHome("topics", { title: v })} maxLength={120} />
            <div>
              <p className="text-xs font-medium text-muted">Main topics (up to 6)</p>
              <ol className="mt-2 space-y-1.5">
                {home.topics.slugs.map((slug, i) => (
                  <li key={slug} className="flex items-center gap-2 rounded-sm border border-line px-2.5 py-1.5 text-sm">
                    <span className="font-medium">{topicName(slug)}</span>
                    <span className="flex-1" />
                    <button type="button" disabled={i === 0} onClick={() => updateHome("topics", { slugs: swap(home.topics.slugs, i, i - 1) })} aria-label={`Move ${topicName(slug)} up`} className="p-1 text-subtle disabled:opacity-30">
                      <ArrowUp size={13} aria-hidden="true" />
                    </button>
                    <button type="button" disabled={i === home.topics.slugs.length - 1} onClick={() => updateHome("topics", { slugs: swap(home.topics.slugs, i, i + 1) })} aria-label={`Move ${topicName(slug)} down`} className="p-1 text-subtle disabled:opacity-30">
                      <ArrowDown size={13} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => updateHome("topics", { slugs: home.topics.slugs.filter((s) => s !== slug) })} aria-label={`Remove ${topicName(slug)}`} className="p-1 text-subtle hover:text-danger">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
              {home.topics.slugs.length < 6 && initial.topics.some((t) => !home.topics.slugs.includes(t.slug)) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted">Add:</span>
                  {initial.topics
                    .filter((t) => !home.topics.slugs.includes(t.slug))
                    .map((t) => (
                      <button key={t.slug} type="button" className="chip text-xs" onClick={() => updateHome("topics", { slugs: [...home.topics.slugs, t.slug] })}>
                        + {t.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </HomeBand>

          <HomeBand title="Latest guides" help="The newest published articles and guides. Courses and interview pages have their own bands." enabled={home.latest.enabled} onEnabled={(v) => updateHome("latest", { enabled: v })}>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextInput label="Heading" value={home.latest.title} onChange={(v) => updateHome("latest", { title: v })} maxLength={120} />
              <TextInput label="“See all” link text" value={home.latest.linkLabel} onChange={(v) => updateHome("latest", { linkLabel: v })} maxLength={40} />
              <TextInput label="How many" type="number" value={String(home.latest.count)} onChange={(v) => updateHome("latest", { count: Math.max(1, Math.min(12, Number(v) || 4)) })} />
            </div>
          </HomeBand>

          <HomeBand title="Written by" help="Your name comes from Identity; the summary and social links are in Site & brand; the photo is the one on the About page." enabled={home.author.enabled} onEnabled={(v) => updateHome("author", { enabled: v })}>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextInput label="Small label" value={home.author.label} onChange={(v) => updateHome("author", { label: v })} maxLength={40} />
              <TextInput label="Speaking link text" value={home.author.speakLabel} onChange={(v) => updateHome("author", { speakLabel: v })} maxLength={60} help="Leave empty to hide the link." />
              <TextInput label="Speaking link" value={home.author.speakHref} onChange={(v) => updateHome("author", { speakHref: v })} mono />
            </div>
          </HomeBand>

          <HomeBand title="Second card (SparkTribe)" help="The dark card beside “Written by”." enabled={home.tribe.enabled} onEnabled={(v) => updateHome("tribe", { enabled: v })}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="Small label" value={home.tribe.eyebrow} onChange={(v) => updateHome("tribe", { eyebrow: v })} maxLength={60} />
              <TextInput label="Heading" value={home.tribe.heading} onChange={(v) => updateHome("tribe", { heading: v })} maxLength={120} />
            </div>
            <TextArea label="Text" value={home.tribe.body} onChange={(v) => updateHome("tribe", { body: v })} rows={2} maxLength={300} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="Button text" value={home.tribe.buttonLabel} onChange={(v) => updateHome("tribe", { buttonLabel: v })} maxLength={60} />
              <TextInput label="Button link" value={home.tribe.href} onChange={(v) => updateHome("tribe", { href: v })} mono />
            </div>
          </HomeBand>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (confirm("Reset the home page wording to the defaults? Nothing is saved until you press Save.")) setHome(structuredClone(DEFAULT_SETTINGS.home));
            }}
          >
            Reset to the default wording
          </button>
        </Group>

        <Group
          id="hubs"
          title="Site sections"
          description="The places in the main menu. Each gathers several content types behind one visitor intent; the types become tabs and labels, and keep their own pages. Pick types to override the automatic choice — a type belongs to one section at most."
          {...groupProps("hubs")}
        >
          {HUB_KEYS.map((key) => {
            const hub = hubs[key];
            const members = hubMembers[key].map(typeName).filter(Boolean);
            return (
              <div key={key} className="rounded-sm border border-line p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{hub.title || key}</p>
                  <code className="font-mono text-xs text-subtle">{HUB_PATHS[key]}</code>
                </div>
                <p className="mt-1 text-xs text-muted">{HUB_HELP[key]}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <TextInput label="Title (also the menu label)" value={hub.title} onChange={(v) => updateHub(key, { title: v })} maxLength={60} />
                  <div className="sm:col-span-2">
                    <TextArea label="Intro (the page's one-line promise, and its meta description)" value={hub.intro} onChange={(v) => updateHub(key, { intro: v })} rows={2} maxLength={400} />
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium text-muted">Content types (none = automatic)</p>
                    <ChipPicker options={initial.types} value={hub.typeIds} onChange={(ids) => updateHub(key, { typeIds: ids })} />
                    <p className="mt-1.5 text-xs text-subtle">
                      {hub.typeIds.length ? "Chosen" : "Automatic"}: {members.length ? members.join(", ") : "none yet"}
                    </p>
                  </div>
                  {key === "speaking" && (
                    <>
                      <div className="sm:col-span-2">
                        <TextArea label="What you speak about (one per line)" value={hubs.speaking.topics.join("\n")} onChange={(v) => updateHub("speaking", { topics: lines(v) })} rows={3} />
                      </div>
                      <TextInput label="Invitation button label" value={hubs.speaking.cta?.label ?? ""} onChange={(v) => updateHub("speaking", { cta: { label: v, href: hubs.speaking.cta?.href ?? "/contact?reason=Speaking" } })} />
                      <TextInput label="Invitation button link" value={hubs.speaking.cta?.href ?? ""} onChange={(v) => updateHub("speaking", { cta: { label: hubs.speaking.cta?.label ?? "", href: v } })} mono />
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-subtle">Resources, courses and collections belong to no section: the Library holds them. Your journey chapters sit under About. Link the menu to these paths in Navigation.</p>
        </Group>

        <Group id="pages" title="Pages" description="Bind system pages to content: the journey timeline on /about, the collections behind /start-here and /uses, and SparkTribe." {...groupProps("pages")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Journey chapters type" value={pages.journeyTypeId ?? ""} onChange={(v) => setPages({ ...pages, journeyTypeId: v || null })} options={[{ value: "", label: "None" }, ...initial.types.map((t) => ({ value: t.id, label: t.name }))]} />
            <Select label="Start here collection" value={pages.startHereCollectionId ?? ""} onChange={(v) => setPages({ ...pages, startHereCollectionId: v || null })} options={[{ value: "", label: "None" }, ...initial.collections.map((c) => ({ value: c.id, label: c.name }))]} />
            <Select label="Uses / toolkit collection" value={pages.usesCollectionId ?? ""} onChange={(v) => setPages({ ...pages, usesCollectionId: v || null })} options={[{ value: "", label: "None" }, ...initial.collections.map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput label="SparkTribe official URL" value={pages.sparktribe.url} onChange={(v) => setPages({ ...pages, sparktribe: { ...pages.sparktribe, url: v } })} mono placeholder="https://" />
            <Select label="SparkTribe tag (related updates)" value={pages.sparktribe.tagId ?? ""} onChange={(v) => setPages({ ...pages, sparktribe: { ...pages.sparktribe, tagId: v || null } })} options={[{ value: "", label: "None" }, ...initial.tags.map((t) => ({ value: t.id, label: t.name }))]} />
            <Select label="SparkTribe category" value={pages.sparktribe.categoryId ?? ""} onChange={(v) => setPages({ ...pages, sparktribe: { ...pages.sparktribe, categoryId: v || null } })} options={[{ value: "", label: "None" }, ...initial.categories.map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Suggest SparkTribe at the end of pieces in these topics</p>
            <ChipPicker options={initial.categories} value={pages.sparktribe.promoteCategoryIds} onChange={(ids) => setPages({ ...pages, sparktribe: { ...pages.sparktribe, promoteCategoryIds: ids } })} />
            <p className="mt-1.5 text-xs text-subtle">A student reading a career piece gets a short note pointing to SparkTribe. Sub-topics are included.</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Start here — “What brings you here?”</p>
            <p className="mt-0.5 text-xs text-subtle">Each answer links one intent to the right place. A path to a section with nothing in it, or a page that isn’t published, is hidden until it is.</p>
            <div className="mt-2 space-y-2">
              {pages.startHerePaths.map((path, i) => (
                <div key={i} className="grid gap-2 rounded-sm border border-line p-2 sm:grid-cols-[12rem_1fr_8rem_auto]">
                  <input value={path.label} onChange={(e) => updatePath(i, { label: e.target.value })} placeholder="I want to…" className="rounded-xs border border-line bg-bg px-2 py-1 text-sm" aria-label="Path label" />
                  <input value={path.description} onChange={(e) => updatePath(i, { description: e.target.value })} placeholder="One line, in your voice" className="rounded-xs border border-line bg-bg px-2 py-1 text-sm" aria-label="Path description" />
                  <input value={path.href} onChange={(e) => updatePath(i, { href: e.target.value })} placeholder="/blog" className="rounded-xs border border-line bg-bg px-2 py-1 font-mono text-xs" aria-label="Path link" />
                  <div className="flex items-center">
                    <button type="button" disabled={i === 0} onClick={() => setPages({ ...pages, startHerePaths: swap(pages.startHerePaths, i, i - 1) })} aria-label="Move up" className="p-1 text-subtle disabled:opacity-30">
                      <ArrowUp size={13} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setPages({ ...pages, startHerePaths: pages.startHerePaths.filter((_, j) => j !== i) })} aria-label="Remove path" className="p-1 text-subtle hover:text-danger">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-ghost btn-sm" disabled={pages.startHerePaths.length >= 8} onClick={() => setPages({ ...pages, startHerePaths: [...pages.startHerePaths, { label: "", description: "", href: "" }] })}>
                  <Plus size={13} aria-hidden="true" /> Add path
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPages({ ...pages, startHerePaths: structuredClone(DEFAULT_START_HERE_PATHS) })}>
                  Use recommended paths
                </button>
              </div>
            </div>
          </div>
        </Group>

        <Group id="contact" title="Contact" description="Messages arrive in your Inbox. Your email address is never shown." {...groupProps("contact")}>
          <Toggle label="Contact form open" checked={contact.enabled} onChange={(v) => setContact({ ...contact, enabled: v })} help="Off: /contact still shows your other contact methods, but the form is replaced by a “closed” note and new submissions are refused." />
          <TextArea label="Reasons (one per line)" value={contact.reasons.join("\n")} onChange={(v) => setContact({ ...contact, reasons: lines(v) })} rows={4} />
          <TextInput label="Success message" value={contact.successMessage} onChange={(v) => setContact({ ...contact, successMessage: v })} />
          <div>
            <p className="text-xs font-medium text-muted">Other contact methods (links)</p>
            {contact.methods.map((m, i) => (
              <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto]">
                <input value={m.label} onChange={(e) => setContact({ ...contact, methods: contact.methods.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label" className="rounded-xs border border-line bg-bg px-2 py-1 text-sm" aria-label="Method label" />
                <input value={m.href} onChange={(e) => setContact({ ...contact, methods: contact.methods.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)) })} placeholder="https:// or /path" className="rounded-xs border border-line bg-bg px-2 py-1 font-mono text-xs" aria-label="Method link" />
                <input value={m.description} onChange={(e) => setContact({ ...contact, methods: contact.methods.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} placeholder="Description" className="rounded-xs border border-line bg-bg px-2 py-1 text-sm" aria-label="Method description" />
                <button type="button" onClick={() => setContact({ ...contact, methods: contact.methods.filter((_, j) => j !== i) })} aria-label="Remove" className="p-1 text-subtle hover:text-danger">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setContact({ ...contact, methods: [...contact.methods, { label: "", href: "", description: "" }] })}>
              <Plus size={13} aria-hidden="true" /> Add method
            </button>
          </div>
        </Group>

        <Group id="features" title="Features" description="Switch whole parts of the public site on or off." {...groupProps("features")}>
          <Toggle label="Site search" checked={features.search} onChange={(v) => setFeatures({ ...features, search: v })} help="The search button and ⌘K palette, /search, and menu links to it. Off: /search returns 404." />
          <Toggle label="RSS feed" checked={features.rss} onChange={(v) => setFeatures({ ...features, rss: v })} help="/feed.xml, its footer and home links, and the feed <link> in every page's head." />
        </Group>

        <Group id="system" title="System & data" description="Configuration comes from environment variables (see README). Nothing secret is shown here." current={panel}>
          <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted">Site URL</dt>
            <dd className="font-mono text-xs">{initial.system.siteUrl}</dd>
            <dt className="text-muted">Database</dt>
            <dd>{initial.system.database}</dd>
            <dt className="text-muted">Media storage</dt>
            <dd>{initial.system.mediaDriver === "r2" ? "Cloudflare R2" : "Local (.data/media) — development only"}</dd>
            <dt className="text-muted">GitHub sign-in</dt>
            <dd>{initial.system.github ? "Configured" : "Not configured"} · allowlist: {initial.system.allowlist}</dd>
            {initial.system.devLogin && (
              <>
                <dt className="text-muted">Dev login</dt>
                <dd className="text-warning">Enabled (development only)</dd>
              </>
            )}
          </dl>
          {/* A file download from an API route, not a page navigation. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/admin/export" className="btn btn-ghost btn-md">
            <Download size={14} aria-hidden="true" /> Export everything (JSON)
          </a>
          <p className="text-xs text-subtle">
            Portable packages, readable Markdown and imports: <Link href="/admin/export" className="underline underline-offset-2">Export</Link> · <Link href="/admin/import" className="underline underline-offset-2">Import</Link>. For files on disk, run <code className="font-mono">npm run export</code>.
          </p>
        </Group>
      </div>
    </div>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}
