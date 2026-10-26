import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupLinks, isActive, isGroupActive } from "@/components/site/nav-links";
import type { AdminActor } from "@/server/auth/actor";
import { categories, documents } from "@/server/db/schema";
import { createContentType } from "@/server/services/content-types";
import { createDocument, runDocumentAction, saveDocument, setDocumentTaxonomy } from "@/server/services/documents";
import { getNavigation, navLinks, replaceNavigation, type NavItem } from "@/server/services/navigation";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

/**
 * The primary menu is five places a visitor can name without knowing the
 * CMS — Writing, Work, Speaking, Explore, About — and grows with the site:
 * a section appears once it has published content (Speaking also for its
 * invitation), a page link once the page is published. Each link is also
 * "current" on the pages its section holds: Writing on /article/…, About on
 * /now. A menu never offers a destination that would greet the visitor with
 * "Nothing published here yet".
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let admin: AdminActor;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  admin = await createAdmin(ctx.db);
});
afterAll(() => ctx.close());

const shape = (items: NavItem[]) => items.map((i) => (i.children.length ? { [i.label]: i.children.map((c) => c.label) } : i.label));

async function publish(typeSlug: string, title: string) {
  const { id } = await createDocument(admin, { typeId: await typeId(ctx.db, typeSlug), title });
  await saveDocument(admin, id, { body: { content: docOf(paragraph(`${title} body`)) } });
  await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

async function publishPage(slug: string) {
  const [row] = await ctx.db.select({ id: documents.id }).from(documents).where(eq(documents.slug, slug));
  await saveDocument(admin, row!.id, { body: { content: docOf(paragraph(`Completed ${slug} page.`)) } });
  await runDocumentAction(admin, row!.id, { action: "publish" });
}

describe("the seeded primary menu", () => {
  it("starts with only what exists: empty sections stay out, Speaking keeps its invitation", async () => {
    // A fresh site has nothing written or built yet; About is published and Speaking has an invitation.
    expect(shape(await getNavigation("primary"))).toEqual(["Library", "About"]);
  });

  it("offers a section once it holds something, and marks it current on every page it gathers", async () => {
    await publish("article", "First essay");
    await publish("guide", "First guide");
    const nav = await getNavigation("primary");
    expect(shape(nav)).toEqual(["Library", "About"]);

    const writing = nav.find((i) => i.label === "Library")!;
    expect(writing.href).toBe("/library");
    // The formats it gathers — including ones with nothing published yet — keep it current.
    expect(writing.match).toEqual(expect.arrayContaining(["/article", "/guide", "/note", "/book-review"]));
    expect(isActive("/article/first-essay", writing.href, writing.match)).toBe(true);
    expect(isActive("/blog/page/2", writing.href, writing.match)).toBe(true);
    expect(isActive("/project", writing.href, writing.match)).toBe(false);

    await publish("project", "First project");
    // Projects (/work) is no longer in the menu; the work page is reached by its address.
    expect(shape(await getNavigation("primary"))).toEqual(["Library", "About"]);

    // About is current on /now and on the journey; the Library on search results.
    const about = (await getNavigation("primary")).find((i) => i.label === "About")!;
    expect(isActive("/now", about.href, about.match)).toBe(true);
    expect(isActive("/journey", about.href, about.match)).toBe(true);
    const library = (await getNavigation("primary")).find((i) => i.label === "Library")!;
    expect(isActive("/search", library.href, library.match)).toBe(true);
    expect(isActive("/tag/aws", library.href, library.match)).toBe(false);
  });

  it("a content type created later joins the right section with no code change", async () => {
    // The owner invents "Newsletter" in the studio: editorial template, so it is writing.
    const type = await createContentType(admin, { name: "Newsletter", pluralName: "Newsletters", slug: "newsletter", template: "editorial", schemaType: "BlogPosting", icon: "pen", fields: [] });
    await publish("newsletter", "Issue one");
    const writing = (await getNavigation("primary")).find((i) => i.label === "Library")!;
    expect(writing.match).toContain(`/${type.slug}`);
  });

  it("links to pages hide until they are published", async () => {
    // Now, Uses and Start here are drafts on a fresh seed.
    const footer = shape(await getNavigation("footer"));
    const about = footer.find((g) => typeof g === "object" && "About" in g) as { About: string[] };
    expect(about.About).toEqual(["About", "Contact"]);
    await publishPage("now");
    const after = shape(await getNavigation("footer")).find((g) => typeof g === "object" && "About" in g) as { About: string[] };
    expect(after.About).toEqual(["About", "Now", "Contact"]);
  });

  it("still opens a group into a dropdown when the owner builds one, each link described by its target", async () => {
    const [article, guide] = await Promise.all([typeId(ctx.db, "article"), typeId(ctx.db, "guide")]);
    await replaceNavigation(admin, "primary", [
      { label: "Writing", linkType: "group", children: [{ label: "Articles", linkType: "content_type", refId: article }, { label: "Guides", linkType: "content_type", refId: guide }] },
      { label: "Explore", linkType: "internal", href: "/explore" },
    ]);
    const nav = await getNavigation("primary");
    expect(shape(nav)).toEqual([{ Writing: ["Articles", "Guides"] }, "Explore"]);
    expect(nav[0]!.children.map((c) => [c.href, c.description])).toEqual([
      ["/article", "Long-form essays, lessons and explanations."],
      ["/guide", "Step-by-step, practical how-tos."],
    ]);
  });

  it("never offers a topic with nothing published in it", async () => {
    const [empty] = await ctx.db.select().from(categories).where(eq(categories.slug, "money"));
    const [stocked] = await ctx.db.select().from(categories).where(eq(categories.slug, "technology"));
    await publish("note", "A technology note").then(async (id) => {
      await setDocumentTaxonomy(admin, id, { categoryIds: [stocked!.id], primaryCategoryId: stocked!.id, tagNames: [] });
    });

    await replaceNavigation(admin, "primary", [
      {
        label: "Topics",
        linkType: "group",
        children: [
          { label: "Invest", linkType: "category", refId: empty!.id },
          { label: "Tech", linkType: "category", refId: stocked!.id },
        ],
      },
      { label: "Explore", linkType: "internal", href: "/explore" },
    ]);

    // The empty topic drops out; the group collapses to the one link left.
    expect(shape(await getNavigation("primary"))).toEqual(["Tech", "Explore"]);
  });

  it("links a saved menu item for a retired path straight to its replacement", async () => {
    await replaceNavigation(admin, "primary", [
      { label: "Explore", linkType: "internal", href: "/explore" },
      { label: "Graph", linkType: "internal", href: "/graph" },
    ]);
    const nav = await getNavigation("primary");
    // /explore 308s to /library: linking there directly saves every visitor (and crawler) a redirect.
    expect(nav.map((i) => [i.label, i.href])).toEqual([["Explore", "/library"]]);
    // The retired graph stays hidden rather than becoming a second Topics link.
  });

  it("stays within the seven-item limit the studio enforces", async () => {
    const rows = await getNavigation("primary");
    expect(rows.length).toBeLessThanOrEqual(7);
  });

  it("footer groups stay columns, even with a single link", async () => {
    await replaceNavigation(admin, "footer", [{ label: "Elsewhere", linkType: "group", children: [{ label: "Explore", linkType: "internal", href: "/explore" }] }]);
    expect(shape(await getNavigation("footer"))).toEqual([{ Elsewhere: ["Explore"] }]);
  });
});

describe("menu helpers", () => {
  const link = (label: string, href: string | null, children: NavItem[] = [], external = false): NavItem => ({ id: label, label, href, external, description: null, match: [], children });
  const writing = link("Writing", null, [link("Articles", "/article"), link("Guides", "/guide")]);

  it("navLinks opens groups up and drops link-less items", () => {
    expect(navLinks([link("About", "/about"), writing]).map((i) => i.href)).toEqual(["/about", "/article", "/guide"]);
  });

  it("a group is current on any of its pages and beneath them", () => {
    expect(isGroupActive("/guide/deploying", writing)).toBe(true);
    expect(isGroupActive("/article", writing)).toBe(true);
    expect(isGroupActive("/articles-elsewhere", writing)).toBe(false);
    expect(isActive("/", "/about")).toBe(false);
  });

  it("an external link never marks its group current", () => {
    const speak = link("Speak", null, [link("Channel", "/", [], true)]);
    expect(isGroupActive("/", speak)).toBe(false);
  });

  it("a group that is itself a link leads its dropdown with that link", () => {
    expect(groupLinks(link("Projects", "/project", [link("Experiments", "/experiment")])).map((i) => i.label)).toEqual(["Projects", "Experiments"]);
  });
});
