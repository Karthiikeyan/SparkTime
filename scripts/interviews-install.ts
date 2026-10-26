/**
 * Install or upgrade the "Interview Experiences" content type on an existing site.
 *
 *   npm run interviews:install              # check only, change nothing
 *   npm run interviews:install -- --apply   # create or upgrade it
 *
 * New databases get the type from the seed. A live site needs this once,
 * after the deploy that ships the `interview` template and `interview_guide`
 * field:
 *
 *  - no type yet: creates it through the studio's own createContentType(), so
 *    the shared URL namespace check (/interviews must not already be a topic,
 *    a content type or a page) and the audit entry are the same as in the studio;
 *  - a type from the earlier one-page-per-round format: replaces its fields
 *    (Company, Role, Interview guide), turns each company × role's round pages
 *    into one draft, moves the round pages to the Trash (restorable)
 *    and redirects a published round's address to its role's page.
 *
 * It never publishes and never touches other types, topics, navigation or settings.
 */
import { loadEnvFiles } from "./load-env";

const APPLY = process.argv.includes("--apply");

async function main() {
  loadEnvFiles();
  const { eq, or } = await import("drizzle-orm");
  const { getDb } = await import("../src/server/db/client");
  const { contentTypes, users } = await import("../src/server/db/schema");
  const { assertRootSlugAvailable } = await import("../src/server/services/namespace");
  const { createContentType } = await import("../src/server/services/content-types");
  const { applyInterviewUpgrade, planInterviewUpgrade } = await import("../src/server/services/interview-upgrade");
  const { INTERVIEW_TYPE } = await import("../src/server/seed/data");
  const db = getDb();

  const admin = async () => {
    const [user] = await db.select().from(users).limit(1);
    if (!user) throw new Error("No user in this database. Sign in to /admin once, then run this again.");
    return { kind: "admin" as const, userId: user.id, login: user.githubLogin };
  };

  const [existing] = await db
    .select({ name: contentTypes.name, slug: contentTypes.slug, template: contentTypes.template })
    .from(contentTypes)
    .where(or(eq(contentTypes.slug, INTERVIEW_TYPE.slug), eq(contentTypes.template, INTERVIEW_TYPE.template)))
    .limit(1);

  if (existing) {
    const plan = await planInterviewUpgrade(db);
    if (!plan.type) {
      console.log(`"${existing.name}" (/${existing.slug}) exists but is archived or not an interview type. Nothing to do.`);
      return;
    }
    if (!plan.needsFields && plan.groups.length === 0) {
      console.log(`Up to date: "${plan.type.name}" (/${plan.type.slug}). Nothing to do.`);
      return;
    }
    console.log(`Upgrade "${plan.type.pluralName}" (/${plan.type.slug}) to one page per company and role:`);
    if (plan.needsFields) console.log(`  - fields become Company, Role (empty on a company's page) and Interview guide; categories kept: ${plan.categories.map((c) => c.label).join(", ")}`);
    for (const g of plan.groups) {
      console.log(`  - new draft "${g.title}" (/${plan.type.slug}/${g.slug}) from ${g.rounds.length} round pages, ${g.questions} questions:`);
      for (const r of g.rounds) console.log(`      ${r.round} — "${r.title}" (${r.status}) → Trash${r.status === "published" || r.status === "archived" ? `, ${r.path} redirects to the new page` : ""}`);
    }
    for (const u of plan.unplaced) console.log(`  - left alone (no company or role): "${u.title}"`);
    if (plan.groups.length) console.log("  Then import the company's research (Studio → Import) to fill candidate counts, round summaries and official sources.");
    if (!APPLY) {
      console.log("Nothing changed. Re-run with --apply to upgrade.");
      return;
    }
    const result = await applyInterviewUpgrade(await admin(), db);
    console.log(`Done: ${result.fieldsUpdated ? "fields updated, " : ""}${result.created.length} role pages created as drafts, ${result.trashed} round pages moved to the Trash, ${result.redirected} redirects. Nothing was published.`);
    return;
  }

  // Throws (with the reason) if /interviews is already taken.
  await assertRootSlugAvailable(db, INTERVIEW_TYPE.slug, { kind: "type" });
  console.log(`Will create the content type "${INTERVIEW_TYPE.name}" (${INTERVIEW_TYPE.pluralName}) at /${INTERVIEW_TYPE.slug} with fields: ${INTERVIEW_TYPE.fields.map((f) => f.label).join(", ")}.`);
  if (!APPLY) {
    console.log("Nothing changed. Re-run with --apply to create it.");
    return;
  }
  const type = await createContentType(await admin(), { ...INTERVIEW_TYPE, fields: INTERVIEW_TYPE.fields.map((f) => ({ ...f, options: f.options ?? {} })) });
  console.log(`Created "${type.pluralName}" (/${type.slug}). Import a company's research in Studio → Import.`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
