/**
 * Apply the recommended public information architecture to an existing site.
 *
 *   npx tsx --conditions=react-server scripts/apply-ia.ts            # show the plan, change nothing
 *   npx tsx --conditions=react-server scripts/apply-ia.ts --apply    # make the changes
 *
 * The seed only builds navigation for an *empty* database, so a site that is
 * already live keeps whatever menu its owner built. This script brings such a
 * site up to the structure in docs/internet-library-redesign.md:
 *
 *   Library (/library) · Topics (/topics) · Projects (/work) · About
 *
 * (The same menu is one click away in Studio → Navigation → "Use recommended
 * menu"; this script is for doing it from a terminal.) The footer becomes the
 * recommended Library / About groups; topics are listed in it automatically.
 *
 * It also gives two content types the name their page should show ("Articles",
 * "Talks") and renames the footer's "Studio" group, which is CMS vocabulary.
 *
 * Safe by design: it prints the plan and exits unless --apply is passed, it
 * goes through the same
 * replaceNavigation() the studio uses (same validation, same audit entry), and
 * it never touches documents, fields, URLs or visibility.
 *
 * Run `npm run export` first if you want a way back.
 */
import { eq } from "drizzle-orm";
import { RECOMMENDED_FOOTER, RECOMMENDED_PRIMARY } from "@/lib/navigation-presets";
import type { AdminActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { contentTypes, navigationItems, users } from "@/server/db/schema";
import { recordAudit } from "@/server/services/audit";
import { getNavigation, replaceNavigation, type NavInput } from "@/server/services/navigation";

const APPLY = process.argv.includes("--apply");
const db = getDb();

function say(line = "") {
  console.log(line);
}

async function admin(): Promise<AdminActor> {
  const [user] = await db.select().from(users).limit(1);
  if (!user) throw new Error("No user in this database. Sign in to /admin once, then run this again.");
  return { kind: "admin", userId: user.id, login: user.githubLogin };
}

/** Plural names that describe the page rather than the menu group above it. */
const TYPE_RENAMES: Array<{ slug: string; from: string; to: string; why: string }> = [
  { slug: "article", from: "Writing", to: "Articles", why: "the topic /writing is a different page" },
  { slug: "talk", from: "Speaking", to: "Talks", why: '"Speaking" is the site section (/speaking) holding Talks and Videos' },
];

async function renameTypes(actor: AdminActor): Promise<string[]> {
  const done: string[] = [];
  for (const rename of TYPE_RENAMES) {
    const [row] = await db.select({ id: contentTypes.id, pluralName: contentTypes.pluralName }).from(contentTypes).where(eq(contentTypes.slug, rename.slug)).limit(1);
    if (!row) continue;
    if (row.pluralName === rename.to) continue;
    done.push(`type "${rename.slug}": "${row.pluralName}" → "${rename.to}"  (${rename.why})`);
    if (!APPLY) continue;
    await db.update(contentTypes).set({ pluralName: rename.to, updatedAt: new Date() }).where(eq(contentTypes.id, row.id));
    await recordAudit(actor, "content_type.update", "content_type", row.id, `Renamed plural to ${rename.to}`);
  }
  return done;
}

async function renameFooterGroup(actor: AdminActor): Promise<string[]> {
  const [row] = await db
    .select({ id: navigationItems.id, label: navigationItems.label })
    .from(navigationItems)
    .where(eq(navigationItems.location, "footer"))
    .then((rows) => rows.filter((r) => r.label.toLowerCase() === "studio"));
  if (!row) return [];
  if (!APPLY) return [`footer group: "Studio" → "About"`];
  await db.update(navigationItems).set({ label: "About" }).where(eq(navigationItems.id, row.id));
  await recordAudit(actor, "navigation.update", "navigation", row.id, 'Renamed footer group "Studio" to "About"');
  return [`footer group: "Studio" → "About"`];
}

/** Every link is a plain site path; links to an empty section or an unpublished page hide themselves. */
function buildPrimary(): NavInput[] {
  return RECOMMENDED_PRIMARY.map((item) => ({ label: item.label, linkType: "internal", href: item.href }));
}

function buildFooter(): NavInput[] {
  return RECOMMENDED_FOOTER.map((group) => ({ label: group.label, linkType: "group", children: group.children.map((item) => ({ label: item.label, linkType: "internal" as const, href: item.href })) }));
}

function printMenu(title: string, items: Array<{ label: string; href: string | null; children: Array<{ label: string; href: string | null }> }>) {
  say(`  ${title}`);
  if (!items.length) say("    (empty)");
  for (const item of items) {
    say(`    ${item.label}${item.href ? `  → ${item.href}` : " ▾"}`);
    for (const child of item.children) say(`        ${child.label}  → ${child.href ?? "?"}`);
  }
}

async function main() {
  const actor = await admin();

  say();
  say(APPLY ? "Applying the recommended information architecture." : "Dry run — nothing will be changed. Pass --apply to make these changes.");
  say();

  say("BEFORE");
  printMenu("primary:", await getNavigation("primary"));
  printMenu("footer:", await getNavigation("footer"));
  say();

  const typeChanges = await renameTypes(actor);
  const footerChanges = await renameFooterGroup(actor);
  const items = buildPrimary();

  say("PLAN");
  for (const change of [...typeChanges, ...footerChanges]) say(`  rename  ${change}`);
  say(`  replace primary menu with ${items.length} item(s):`);
  for (const item of items) say(`    ${item.label}  → ${item.href}`);
  say(`  replace footer with ${RECOMMENDED_FOOTER.map((g) => g.label).join(" / ")} groups`);
  say();
  say("  A section link hides itself until the section has something published");
  say("  and a page link until the page is published. Formats and topics remain");
  say("  available through the Library. Existing document URLs are unchanged.");
  say();

  if (!APPLY) {
    say("Nothing changed. Re-run with --apply (after `npm run export`) to commit it.");
    return;
  }

  await replaceNavigation(actor, "primary", items);
  await replaceNavigation(actor, "footer", buildFooter());
  say("AFTER");
  printMenu("primary:", await getNavigation("primary"));
  printMenu("footer:", await getNavigation("footer"));
  say();
  say("Done. Published pages are cached for an hour; redeploy or wait for the next revalidation to see it live.");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
