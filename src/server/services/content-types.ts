import "server-only";
import { cache } from "react";
import { asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { isIconName, isSchemaType, isTemplate, type FieldDefinition, type FieldOptions, type IconName, type SchemaType, type Template } from "@/lib/content/model";
import { normalizeFieldDefinitions } from "@/lib/content/properties";
import { isUuid } from "@/lib/content/blocks";
import { assertAdmin, type Actor } from "../auth/actor";
import { getDb, type Db } from "../db/client";
import { contentTypeFields, contentTypes, documents, type ContentTypeFieldRow, type ContentTypeRow } from "../db/schema";
import { conflict, invalid, notFound, ServiceError } from "../errors";
import { recordAudit } from "./audit";
import { assertRootSlugAvailable } from "./namespace";
import { upsertRedirect } from "./redirects";

export type ContentType = Omit<ContentTypeRow, "template" | "schemaType" | "icon" | "routing"> & {
  template: Template;
  schemaType: SchemaType;
  icon: IconName;
  routing: "type" | "root";
  fields: FieldDefinition[];
};

function toField(row: ContentTypeFieldRow): FieldDefinition {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type as FieldDefinition["type"],
    role: (row.role as FieldDefinition["role"]) ?? null,
    required: row.required,
    helpText: row.helpText,
    options: (row.options ?? {}) as FieldOptions,
    showInFacts: row.showInFacts,
    position: row.position,
  };
}

function toContentType(row: ContentTypeRow, fields: ContentTypeFieldRow[]): ContentType {
  return {
    ...row,
    template: isTemplate(row.template) ? row.template : "minimal",
    schemaType: isSchemaType(row.schemaType) ? row.schemaType : "CreativeWork",
    icon: isIconName(row.icon) ? row.icon : "file",
    routing: row.routing === "root" ? "root" : "type",
    fields: fields
      .filter((f) => f.contentTypeId === row.id)
      .sort((a, b) => a.position - b.position)
      .map(toField),
  };
}

/**
 * Uncached load through a specific executor. Code running inside a
 * transaction must use this (not listContentTypes) so it reads through the
 * transaction's connection.
 */
export async function loadContentTypes(db: Db): Promise<ContentType[]> {
  return loadTypes(db);
}

async function loadTypes(db: Db): Promise<ContentType[]> {
  const [rows, fieldRows] = await Promise.all([
    db.select().from(contentTypes).orderBy(asc(contentTypes.position), asc(contentTypes.name)),
    db.select().from(contentTypeFields).orderBy(asc(contentTypeFields.position)),
  ]);
  return rows.map((row) => toContentType(row, fieldRows));
}

/** Content types are public metadata (names, templates, field labels). Memoised per request. */
export const listContentTypes = cache(async (): Promise<ContentType[]> => loadTypes(getDb()));

export async function getContentTypeBySlug(slug: string): Promise<ContentType | null> {
  return (await listContentTypes()).find((t) => t.slug === slug) ?? null;
}

export async function getContentTypeById(id: string): Promise<ContentType | null> {
  if (!isUuid(id)) return null;
  return (await listContentTypes()).find((t) => t.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Admin mutations
// ---------------------------------------------------------------------------

const typeInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(60),
  pluralName: z.string().trim().max(60).optional(),
  slug: z.string().trim().max(96),
  description: z.string().trim().max(500).default(""),
  template: z.string().refine(isTemplate, "Choose one of the available templates."),
  schemaType: z.string().refine(isSchemaType, "Choose a structured-data type.").default("CreativeWork"),
  icon: z.string().refine(isIconName, "Choose an icon.").default("file"),
  indexable: z.boolean().default(true),
  inFeeds: z.boolean().default(true),
  showInQuickCreate: z.boolean().default(true),
  position: z.number().int().min(0).max(1000).optional(),
  fields: z.array(z.unknown()).default([]),
});

export type ContentTypeInput = z.input<typeof typeInputSchema>;

function parseTypeInput(input: unknown) {
  const parsed = typeInputSchema.safeParse(input);
  if (!parsed.success) {
    const details: Record<string, string> = {};
    for (const issue of parsed.error.issues) details[issue.path.join(".")] = issue.message;
    throw invalid("Please fix the highlighted fields.", details);
  }
  const { fields, errors } = normalizeFieldDefinitions(parsed.data.fields);
  if (errors.length) throw invalid(errors[0]!, { fields: errors.join("\n") });
  return { ...parsed.data, fields };
}

async function writeFields(db: Db, typeId: string, fields: FieldDefinition[], existing: FieldDefinition[]): Promise<void> {
  const existingById = new Map(existing.filter((f) => f.id).map((f) => [f.id!, f]));
  const keep = new Set<string>();

  for (const field of fields) {
    const previous = field.id ? existingById.get(field.id) : undefined;
    const values = {
      key: field.key,
      label: field.label,
      type: field.type,
      role: field.role,
      required: field.required,
      helpText: field.helpText,
      options: field.options,
      showInFacts: field.showInFacts,
      position: field.position,
    };
    if (previous?.id) {
      keep.add(previous.id);
      if (previous.key !== field.key) {
        // Renaming a key migrates stored values so nothing is silently lost.
        await db.execute(sql`
          update studio.documents
          set properties = (properties - ${previous.key}::text) || jsonb_build_object(${field.key}::text, properties -> ${previous.key}::text)
          where type_id = ${typeId} and properties ? ${previous.key}::text`);
      }
      await db.update(contentTypeFields).set(values).where(eq(contentTypeFields.id, previous.id));
    } else {
      const [row] = await db.insert(contentTypeFields).values({ ...values, contentTypeId: typeId }).returning({ id: contentTypeFields.id });
      if (row) keep.add(row.id);
    }
  }
  // Removed fields: the definition goes, stored values stay in JSON (non-destructive).
  for (const old of existing) {
    if (old.id && !keep.has(old.id)) await db.delete(contentTypeFields).where(eq(contentTypeFields.id, old.id));
  }
}

export async function createContentType(actor: Actor, input: unknown): Promise<ContentType> {
  assertAdmin(actor);
  const data = parseTypeInput(input);
  const db = getDb();
  const id = await db.transaction(async (tx) => {
    await assertRootSlugAvailable(tx, data.slug, { kind: "type" });
    const [{ maxPos } = { maxPos: 0 }] = await tx.select({ maxPos: sql<number>`coalesce(max(${contentTypes.position}), 0)` }).from(contentTypes);
    const [row] = await tx
      .insert(contentTypes)
      .values({
        name: data.name,
        pluralName: data.pluralName || `${data.name}s`,
        slug: data.slug,
        description: data.description,
        template: data.template,
        schemaType: data.schemaType,
        icon: data.icon,
        indexable: data.indexable,
        inFeeds: data.inFeeds,
        showInQuickCreate: data.showInQuickCreate,
        position: data.position ?? Number(maxPos) + 1,
      })
      .returning({ id: contentTypes.id });
    await writeFields(tx, row!.id, data.fields, []);
    return row!.id;
  });
  await recordAudit(actor, "content_type.create", "content_type", id, `Created type ${data.name}`);
  return (await loadTypes(db)).find((t) => t.id === id)!;
}

export async function updateContentType(actor: Actor, id: string, input: unknown): Promise<ContentType> {
  assertAdmin(actor);
  if (!isUuid(id)) throw notFound("Content type");
  const db = getDb();
  const current = (await loadTypes(db)).find((t) => t.id === id);
  if (!current) throw notFound("Content type");
  const data = parseTypeInput(input);
  if (current.isSystem && data.slug !== current.slug) throw invalid("System content types cannot change their URL.");

  await db.transaction(async (tx) => {
    if (data.slug !== current.slug) {
      await assertRootSlugAvailable(tx, data.slug, { kind: "type", id });
      if (current.routing === "type") {
        // Keep every old /{type}/{slug} URL working.
        await upsertRedirect(tx, { fromPath: `/${current.slug}`, toPath: `/${data.slug}`, matchType: "prefix", source: "type-change" });
      }
    }
    await tx
      .update(contentTypes)
      .set({
        name: data.name,
        pluralName: data.pluralName || `${data.name}s`,
        slug: data.slug,
        description: data.description,
        template: data.template,
        schemaType: data.schemaType,
        icon: data.icon,
        indexable: data.indexable,
        inFeeds: data.inFeeds,
        showInQuickCreate: data.showInQuickCreate,
        position: data.position ?? current.position,
        updatedAt: new Date(),
      })
      .where(eq(contentTypes.id, id));
    await writeFields(tx, id, data.fields, current.fields);
  });
  await recordAudit(actor, "content_type.update", "content_type", id, `Updated type ${data.name}`);
  return (await loadTypes(db)).find((t) => t.id === id)!;
}

export async function setContentTypeArchived(actor: Actor, id: string, archived: boolean): Promise<void> {
  assertAdmin(actor);
  const type = (await loadTypes(getDb())).find((t) => t.id === id);
  if (!type) throw notFound("Content type");
  if (type.isSystem) throw invalid("System content types cannot be archived.");
  await getDb().update(contentTypes).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(eq(contentTypes.id, id));
  await recordAudit(actor, archived ? "content_type.archive" : "content_type.restore", "content_type", id, type.name);
}

export async function deleteContentType(actor: Actor, id: string): Promise<void> {
  assertAdmin(actor);
  const db = getDb();
  const type = (await loadTypes(db)).find((t) => t.id === id);
  if (!type) throw notFound("Content type");
  if (type.isSystem) throw invalid("System content types cannot be deleted.");
  const [{ n, trashed } = { n: 0, trashed: 0 }] = await db
    .select({ n: count(), trashed: sql<number>`count(*) filter (where ${documents.status} = 'trashed')` })
    .from(documents)
    .where(eq(documents.typeId, id));
  if (Number(n) > 0) {
    const inTrash = Number(trashed) > 0 ? ` (${trashed} of them in the Trash — delete those permanently there)` : "";
    throw conflict(`This type still has ${n} document(s)${inTrash}. Convert or delete them first, or archive the type instead.`);
  }
  await db.delete(contentTypes).where(eq(contentTypes.id, id));
  await recordAudit(actor, "content_type.delete", "content_type", id, type.name);
}

export async function reorderContentTypes(actor: Actor, orderedIds: string[]): Promise<void> {
  assertAdmin(actor);
  if (!Array.isArray(orderedIds) || !orderedIds.every(isUuid)) throw new ServiceError("invalid", "Invalid order.");
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx.update(contentTypes).set({ position: index }).where(eq(contentTypes.id, id));
    }
  });
}
