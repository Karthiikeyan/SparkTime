import { afterEach, describe, expect, it } from "vitest";
import { INTERVIEW_TYPE } from "@/server/seed/data";
import { createContentType } from "@/server/services/content-types";
import { createCategory } from "@/server/services/taxonomy";
import { createAdmin, createTestDb } from "../helpers/db";

/** What scripts/interviews-install.ts does on a live site that predates the type. */

let ctx: Awaited<ReturnType<typeof createTestDb>> | null = null;
afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

const input = () => ({ ...INTERVIEW_TYPE, fields: INTERVIEW_TYPE.fields.map((f) => ({ ...f, options: f.options ?? {} })) });

describe("installing the interview type", () => {
  it("creates the type with its fields through the studio's own service", async () => {
    ctx = await createTestDb();
    const admin = await createAdmin(ctx.db);
    const type = await createContentType(admin, input());
    expect(type).toMatchObject({ slug: "interviews", template: "interview", schemaType: "Article", inFeeds: false, indexable: false });
    expect(type.fields.map((f) => [f.key, f.type, f.role, f.required])).toEqual([
      ["company", "text", "interviewCompany", true],
      ["jobRole", "text", "interviewRole", false],
      ["guide", "interview_guide", null, false],
    ]);
    expect(type.fields.at(-1)!.options.choices).toHaveLength(11);
  });

  it("refuses when /interviews already belongs to a topic", async () => {
    ctx = await createTestDb();
    const admin = await createAdmin(ctx.db);
    await createCategory(admin, { name: "Interviews", slug: "interviews" });
    await expect(createContentType(admin, input())).rejects.toMatchObject({ code: "conflict" });
  });
});
