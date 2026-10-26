import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminActor } from "@/server/auth/actor";
import { createDocument, runDocumentAction, saveDocument, setDocumentTaxonomy } from "@/server/services/documents";
import { topicDescription } from "@/server/seo/metadata";
import { visibleCategories } from "@/server/services/public-content";
import { loadAllSettings } from "@/server/services/settings";
import { listCategories } from "@/server/services/taxonomy";
import { createAdmin, createTestDb, docOf, paragraph, typeId } from "../helpers/db";

/**
 * Topic counts (home "In the library", /topics, menus, the sitemap's empty-topic
 * rule) are the number of pieces a visitor finds on the topic page. A piece filed
 * under a topic and its sub-topic — or under two sub-topics — appears there once,
 * so it counts once. Production showed "Technology 343" beside "253 pieces".
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let admin: AdminActor;

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  admin = await createAdmin(ctx.db);
});
afterAll(() => ctx.close());

async function publish(title: string, categoryIds: string[], draft = false) {
  const { id } = await createDocument(admin, { typeId: await typeId(ctx.db, "article"), title });
  await saveDocument(admin, id, { body: { content: docOf(paragraph(`${title} body`)) } });
  await setDocumentTaxonomy(admin, id, { categoryIds });
  if (!draft) await runDocumentAction(admin, id, { action: "publish" });
  return id;
}

describe("topic counts", () => {
  it("count each listed piece once per topic, however it is filed beneath it", async () => {
    const all = await listCategories();
    const tech = all.find((c) => c.slug === "technology")!;
    const children = all.filter((c) => c.parentId === tech.id);
    expect(children.length).toBeGreaterThanOrEqual(2);
    const [a, b] = children as [typeof tech, typeof tech];

    await publish("Filed under the topic and a sub-topic", [tech.id, a.id]);
    await publish("Filed under two sub-topics", [a.id, b.id]);
    await publish("Filed under one sub-topic", [b.id]);
    await publish("A draft never counts", [tech.id, a.id], true);

    const counts = new Map((await visibleCategories()).map((c) => [c.slug, c.count]));
    expect(counts.get("technology")).toBe(3);
    expect(counts.get(a.slug)).toBe(2);
    expect(counts.get(b.slug)).toBe(2);
  });

  it("describe a topic by itself when it has no description, never with the home page's", async () => {
    const generic = (await loadAllSettings()).seo.defaultDescription;
    const own = await topicDescription({ name: "Health", description: "Looking after yourself.", seoDescription: null }, 8);
    expect(own).toBe("Looking after yourself.");
    const fallback = await topicDescription({ name: "Health", description: "", seoDescription: null }, 8);
    expect(fallback).not.toBe(generic);
    expect(fallback).toContain("Health");
    expect(fallback).toContain("8 pieces");
    expect(await topicDescription({ name: "Travel", description: "" }, 1)).toContain("1 piece in");
  });
});
