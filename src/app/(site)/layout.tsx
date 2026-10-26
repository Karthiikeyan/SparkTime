import { Analytics } from "@/components/analytics/analytics";
import { CommandPalette, type PaletteAction } from "@/components/search/command-palette";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { typeIndexPath } from "@/lib/content/paths";
import { isNotesTopic } from "@/lib/site-config";
import { listContentTypes } from "@/server/services/content-types";
import { getNavigation, navLinks } from "@/server/services/navigation";
import { publicTypeCounts, visibleCategories } from "@/server/services/public-content";
import { isLivePath } from "@/server/services/sections";
import { getBrand, loadAllSettings } from "@/server/services/settings";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [primary, footer, settings, types, typeCounts, categories, startHere, sparktribe, brand] = await Promise.all([
    getNavigation("primary"),
    getNavigation("footer"),
    loadAllSettings(),
    listContentTypes(),
    publicTypeCounts(),
    visibleCategories(),
    isLivePath("/start-here"),
    isLivePath("/sparktribe"),
    getBrand(),
  ]);
  const { features } = settings;
  const primaryLinks = navLinks(primary);
  // Footer links the primary menu doesn't already offer (inside its dropdowns included), for the mobile menu and the palette.
  const secondary = navLinks(footer).filter((i) => !primaryLinks.some((p) => p.href === i.href));

  const goTo: PaletteAction[] = [
    { id: "home", label: "Home", href: "/", group: "Go to" },
    { id: "library", label: "The library", href: "/library", group: "Go to", keywords: "browse explore all writing index" },
    { id: "topics", label: "Every topic", href: "/topics", group: "Go to", keywords: "subjects categories" },
    ...(categories.some((c) => isNotesTopic(c, settings.home.topics.slugs)) ? [{ id: "notes", label: "Notes", href: "/notes", group: "Go to", keywords: "everything else personal life travel learning creator" }] : []),
    { id: "search", label: "Full search", href: "/search", group: "Go to" },
  ];
  const sections: PaletteAction[] = types
    .filter((t) => t.routing === "type" && (typeCounts.get(t.id) ?? 0) > 0)
    .map((t) => ({ id: `type-${t.id}`, label: t.pluralName, href: typeIndexPath(t), group: "Sections" }));
  // Every menu destination is one ⌘K away; a place already listed isn't listed twice.
  const menu: PaletteAction[] = [...primaryLinks, ...secondary]
    .filter((i) => ![...goTo, ...sections].some((a) => a.href === i.href))
    .filter((i, index, all) => all.findIndex((j) => j.href === i.href) === index)
    .map((i) => ({ id: `nav-${i.id}`, label: i.label, href: i.href!, group: "Go to" }));
  // The palette prints a heading whenever the group changes, so each group stays together.
  const actions: PaletteAction[] = [
    ...goTo,
    ...menu,
    ...sections,
    ...categories.filter((c) => c.count > 0).map((c) => ({ id: `cat-${c.id}`, label: c.name, href: `/${c.slug}`, group: "Topics" })),
  ];

  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-sm bg-ink px-4 py-2 text-bg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Header primary={primary} secondary={secondary} search={features.search} brand={brand} />
      {/* Reading text is never below 16px; the site's body size is 17px. */}
      <main id="main" tabIndex={-1} className="text-[1.0625rem] outline-none">
        {children}
      </main>
      <Footer groups={footer} rss={features.rss} brand={brand} startHere={startHere} sparktribe={sparktribe} />
      {/* The palette is the search UI; with search off there is nothing for ⌘K to open. */}
      {features.search && <CommandPalette actions={actions} />}
      {/* Vercel Web Analytics always; GA4 only in production on the canonical origin with NEXT_PUBLIC_GA_ID set. */}
      <Analytics sparktribeUrl={settings.pages.sparktribe.url} />
    </>
  );
}
