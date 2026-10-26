import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentTypes, documents, navigationItems } from "@/server/db/schema";
import { SEED_JOURNEY, SEED_PAGES } from "@/server/seed/data";
import { seedDatabase } from "@/server/seed/seed";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { hasPlaceholderContent, hasPlaceholderText } from "@/lib/content/derive";
import { createTestDb } from "../helpers/db";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
});
afterAll(() => ctx.close());

describe("seed", () => {
  it("is idempotent", async () => {
    const before = { types: (await ctx.db.select().from(contentTypes)).length, docs: (await ctx.db.select().from(documents)).length, nav: (await ctx.db.select().from(navigationItems)).length };
    await seedDatabase(ctx.db);
    expect((await ctx.db.select().from(contentTypes)).length).toBe(before.types);
    expect((await ctx.db.select().from(documents)).length).toBe(before.docs);
    expect((await ctx.db.select().from(navigationItems)).length).toBe(before.nav);
  });

  it("publishes only pages whose facts are known; everything else is a draft", async () => {
    const published = SEED_PAGES.filter((p) => p.status === "published").map((p) => p.slug).sort();
    expect(published).toEqual(["about", "contact", "sparktribe"]);
    expect(SEED_JOURNEY.length).toBeGreaterThan(0);
  });

  it("contains no fabricated statistics, testimonials or claims", () => {
    const text = JSON.stringify({ SEED_PAGES, SEED_JOURNEY, DEFAULT_SETTINGS });
    // No follower counts, student numbers, salaries, awards or testimonials.
    expect(text).not.toMatch(/\d+\s*[kK]\+|\d{2,}\+|followers|subscribers|students (joined|placed)|LPA|₹\s?\d|award|testimonial|"I highly recommend/);
    // Social profiles found in other projects are never enabled by default.
    expect(DEFAULT_SETTINGS.profiles.every((p) => !p.enabled)).toBe(true);
  });

  it("marks every unknown as an explicit [TODO]", () => {
    const drafts = SEED_PAGES.filter((p) => p.status === "draft");
    for (const page of drafts) expect(JSON.stringify(page.content)).toContain("[TODO]");
  });

  it("keeps unfinished prompts out of published seed content", () => {
    for (const page of SEED_PAGES.filter((item) => item.status === "published")) {
      expect(hasPlaceholderContent(page.content)).toBe(false);
      expect(hasPlaceholderText(page.excerpt)).toBe(false);
    }
    expect(SEED_PAGES.find((page) => page.slug === "about")?.notes).toContain("[TODO]");
  });
});
