/**
 * Dynamic custom properties. A content type declares fields; documents store
 * values in a JSONB map keyed by field key. Validation is built from the field
 * definitions at runtime and shared by the admin form and the server.
 */
import { isUuid } from "./blocks";
import {
  FIELD_KEY_PATTERN,
  FIELD_ROLES,
  isFieldRole,
  isFieldType,
  isRelationKind,
  roleAcceptsType,
  type FieldDefinition,
  type FieldOptions,
  type SelectOption,
} from "./model";
import { safeHref } from "../url";
import { coerceGuide, guideSearchText, type InterviewGuide } from "../interviews/guide";

export type PropertyValue = string | number | boolean | string[] | InterviewGuide | null;
export type Properties = Record<string, PropertyValue>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export type PropertyValidation = { values: Properties; errors: Record<string, string> };

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function coerce(field: FieldDefinition, raw: unknown, mode: "draft" | "publish"): { value: PropertyValue } | { error: string } {
  const { type, options } = field;
  switch (type) {
    case "text":
    case "long_text": {
      if (typeof raw !== "string") return { error: "Must be text." };
      const max = type === "text" ? 500 : 20000;
      const value = raw.trim();
      if (value.length > max) return { error: `Must be at most ${max} characters.` };
      return { value };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
      if (!Number.isFinite(n)) return { error: "Must be a number." };
      if (options.min !== undefined && n < options.min) return { error: `Must be at least ${options.min}.` };
      if (options.max !== undefined && n > options.max) return { error: `Must be at most ${options.max}.` };
      return { value: n };
    }
    case "boolean":
      if (typeof raw !== "boolean") return { error: "Must be true or false." };
      return { value: raw };
    case "url": {
      const href = safeHref(raw, { allowHash: false });
      return href ? { value: href } : { error: "Must be a valid http(s) URL or a site path." };
    }
    case "email":
      return typeof raw === "string" && EMAIL.test(raw.trim()) && raw.length <= 254 ? { value: raw.trim().toLowerCase() } : { error: "Must be a valid email address." };
    case "date": {
      if (typeof raw !== "string" || !DATE_ONLY.test(raw)) return { error: "Must be a date (YYYY-MM-DD)." };
      const d = new Date(`${raw}T00:00:00Z`);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? { error: "Not a real date." } : { value: raw };
    }
    case "datetime": {
      if (typeof raw !== "string") return { error: "Must be a date and time." };
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? { error: "Not a valid date and time." } : { value: d.toISOString() };
    }
    case "select": {
      const choices = (options.choices ?? []).map((c) => c.value);
      return typeof raw === "string" && choices.includes(raw) ? { value: raw } : { error: "Choose one of the listed options." };
    }
    case "multi_select": {
      if (!Array.isArray(raw)) return { error: "Must be a list." };
      const choices = new Set((options.choices ?? []).map((c) => c.value));
      const values = [...new Set(raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
      if (values.length > 40) return { error: "Too many values (max 40)." };
      if (values.some((v) => v.length > 80)) return { error: "Values must be at most 80 characters." };
      if (!options.allowCustom && values.some((v) => !choices.has(v))) return { error: "Choose from the listed options." };
      return { value: values };
    }
    case "image":
    case "file":
      return isUuid(raw) ? { value: raw } : { error: "Choose a file from the media library." };
    case "relation": {
      if (options.multiple) {
        if (!Array.isArray(raw) || !raw.every(isUuid)) return { error: "Choose documents." };
        const ids = [...new Set(raw)];
        return ids.length > 30 ? { error: "Too many documents (max 30)." } : { value: ids };
      }
      return isUuid(raw) ? { value: raw } : { error: "Choose a document." };
    }
    case "interview_guide":
      return coerceGuide(raw, options.choices, mode);
    default:
      return { error: "Unsupported field type." };
  }
}

/**
 * Validates a property map. Unknown keys are dropped. In "draft" mode missing
 * required values are allowed (drafts are works in progress); "publish" mode
 * enforces them.
 */
export function validateProperties(fields: FieldDefinition[], input: unknown, mode: "draft" | "publish"): PropertyValidation {
  const source = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const values: Properties = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = source[field.key];
    if (isBlank(raw)) {
      if (mode === "publish" && field.required) errors[field.key] = `${field.label} is required to publish.`;
      continue;
    }
    const result = coerce(field, raw, mode);
    if ("error" in result) errors[field.key] = result.error;
    else if (!isBlank(result.value)) values[field.key] = result.value;
  }
  return { values, errors };
}

/** Text that should make a document findable by its properties. */
export function propertySearchText(fields: FieldDefinition[], values: Properties): string {
  const parts: string[] = [];
  for (const field of fields) {
    const value = values[field.key];
    if (value === null || value === undefined) continue;
    if (field.type === "text" || field.type === "long_text") parts.push(String(value).slice(0, 2000));
    else if (field.type === "select") parts.push(labelFor(field.options.choices, String(value)));
    else if (field.type === "multi_select" && Array.isArray(value)) parts.push(value.map((v) => labelFor(field.options.choices, String(v))).join(" "));
    else if (field.type === "interview_guide") parts.push(guideSearchText(value));
  }
  return parts.join(" ");
}

export function labelFor(choices: SelectOption[] | undefined, value: string): string {
  return choices?.find((c) => c.value === value)?.label ?? value;
}

export function fieldByRole(fields: FieldDefinition[], role: string): FieldDefinition | undefined {
  return fields.find((f) => f.role === role);
}

export function valueByRole(fields: FieldDefinition[], values: Properties, role: string): PropertyValue | undefined {
  const field = fieldByRole(fields, role);
  return field ? values[field.key] : undefined;
}

// ---------------------------------------------------------------------------
// Field definition validation (content type builder)
// ---------------------------------------------------------------------------

export type FieldDefinitionInput = Partial<Omit<FieldDefinition, "options">> & { options?: Partial<FieldOptions> | null };

function normalizeChoices(raw: unknown): SelectOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const c of raw.slice(0, 100)) {
    const value = typeof c === "string" ? c : c && typeof c === "object" ? (c as SelectOption).value : "";
    const label = typeof c === "string" ? c : c && typeof c === "object" ? (c as SelectOption).label : "";
    const v = String(value ?? "").trim().slice(0, 80);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push({ value: v, label: String(label || v).trim().slice(0, 80) });
  }
  return out;
}

export function normalizeFieldDefinitions(input: unknown): { fields: FieldDefinition[]; errors: string[] } {
  const errors: string[] = [];
  const fields: FieldDefinition[] = [];
  if (!Array.isArray(input)) return { fields, errors: ["Fields must be a list."] };
  if (input.length > 60) errors.push("A content type can have at most 60 fields.");
  const keys = new Set<string>();
  const roles = new Set<string>();
  let guides = 0;

  input.slice(0, 60).forEach((raw: FieldDefinitionInput, index) => {
    const label = String(raw?.label ?? "").trim().slice(0, 80);
    const key = String(raw?.key ?? "").trim();
    const type = raw?.type;
    if (!label) errors.push(`Field ${index + 1}: label is required.`);
    if (!FIELD_KEY_PATTERN.test(key)) errors.push(`Field "${label || index + 1}": key must start with a letter and use letters/numbers only (camelCase).`);
    if (keys.has(key)) errors.push(`Field key "${key}" is used twice.`);
    keys.add(key);
    if (type === "interview_guide") {
      if (guides > 0) errors.push("A content type can have only one interview guide.");
      guides++;
    }
    if (!isFieldType(type)) {
      errors.push(`Field "${label}": unknown type.`);
      return;
    }
    let role = raw?.role ?? null;
    if (role !== null && !isFieldRole(role)) {
      errors.push(`Field "${label}": unknown role.`);
      role = null;
    }
    if (role && !roleAcceptsType(role, type)) {
      errors.push(`Field "${label}": role "${FIELD_ROLES[role].label}" needs a ${FIELD_ROLES[role].types.join(" or ")} field.`);
    }
    if (role && roles.has(role)) errors.push(`Role "${role}" is assigned to more than one field.`);
    if (role) roles.add(role);

    const rawOptions = raw?.options ?? {};
    const options: FieldOptions = {};
    if (type === "select" || type === "multi_select" || type === "interview_guide") {
      options.choices = normalizeChoices(rawOptions.choices);
      if ((type === "select" || type === "interview_guide") && options.choices.length === 0) errors.push(`Field "${label}": add at least one ${type === "interview_guide" ? "category" : "option"}.`);
      if (type === "multi_select") options.allowCustom = rawOptions.allowCustom === true;
    }
    if (type === "number") {
      if (typeof rawOptions.min === "number" && Number.isFinite(rawOptions.min)) options.min = rawOptions.min;
      if (typeof rawOptions.max === "number" && Number.isFinite(rawOptions.max)) options.max = rawOptions.max;
    }
    if (type === "relation") {
      options.multiple = rawOptions.multiple === true;
      options.targetTypeIds = Array.isArray(rawOptions.targetTypeIds) ? rawOptions.targetTypeIds.filter(isUuid).slice(0, 20) : [];
      options.relationKind = isRelationKind(rawOptions.relationKind) ? rawOptions.relationKind : "related";
    }
    if (typeof rawOptions.placeholder === "string") options.placeholder = rawOptions.placeholder.slice(0, 120);

    fields.push({
      id: isUuid(raw?.id) ? raw.id : undefined,
      key,
      label,
      type,
      role: role as FieldDefinition["role"],
      required: raw?.required === true,
      helpText: String(raw?.helpText ?? "").slice(0, 300),
      options,
      showInFacts: raw?.showInFacts !== false,
      position: index,
    });
  });

  return { fields, errors };
}
