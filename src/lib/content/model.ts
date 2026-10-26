/**
 * The allowlists that make "dynamic" safe. Content types, fields, roles and
 * relation kinds are created in the CMS, but they can only *choose* from the
 * options defined here — the database never supplies code or markup.
 */

// ---------------------------------------------------------------------------
// Presentation templates
// ---------------------------------------------------------------------------

export const TEMPLATES = ["editorial", "project", "media", "resource", "story", "collection", "minimal", "interview"] as const;
export type Template = (typeof TEMPLATES)[number];

export const TEMPLATE_INFO: Record<Template, { label: string; description: string }> = {
  editorial: { label: "Editorial", description: "Long-form reading: serif body, table of contents, takeaways, references." },
  project: { label: "Project", description: "Case-study layout with a facts panel, links and a build narrative." },
  media: { label: "Media", description: "Video-first: a click-to-load player, transcript and related material." },
  resource: { label: "Resource", description: "A useful thing to go and use: prominent link, who it's for, notes." },
  story: { label: "Story", description: "Narrative chapter with a period, turning points and lessons." },
  collection: { label: "Collection", description: "A curated, ordered set of documents with notes and groups." },
  minimal: { label: "Minimal", description: "Just the words. For notes and standalone pages." },
  interview: { label: "Interview experiences", description: "A company, or one of its roles: the reported process, rounds and questions, with search and Copy for AI." },
};

export function isTemplate(value: unknown): value is Template {
  return typeof value === "string" && (TEMPLATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// schema.org types for JSON-LD
// ---------------------------------------------------------------------------

export const SCHEMA_TYPES = [
  "Article",
  "BlogPosting",
  "TechArticle",
  "VideoObject",
  "Course",
  "Event",
  "Review",
  "SoftwareSourceCode",
  "CollectionPage",
  "CreativeWork",
  "WebPage",
] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

export function isSchemaType(value: unknown): value is SchemaType {
  return typeof value === "string" && (SCHEMA_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Icons (rendered from a fixed SVG set, never from stored markup)
// ---------------------------------------------------------------------------

export const ICONS = [
  "file",
  "pen",
  "note",
  "code",
  "video",
  "mic",
  "book",
  "graduation",
  "flask",
  "compass",
  "layers",
  "sparkle",
  "link",
  "map",
  "star",
  "briefcase",
] as const;
export type IconName = (typeof ICONS)[number];

export function isIconName(value: unknown): value is IconName {
  return typeof value === "string" && (ICONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Custom property fields
// ---------------------------------------------------------------------------

export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "boolean",
  "url",
  "email",
  "date",
  "datetime",
  "select",
  "multi_select",
  "image",
  "file",
  "relation",
  "interview_guide",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  boolean: "Checkbox",
  url: "URL",
  email: "Email",
  date: "Date",
  datetime: "Date & time",
  select: "Select",
  multi_select: "Multi-select",
  image: "Image",
  file: "File",
  relation: "Relation",
  interview_guide: "Interview guide",
};

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * Semantic roles let templates and structured data find a field without
 * hardcoding its key. A "Project" type might call its field "Live site" or
 * "Demo" — whichever field holds the `primaryUrl` role becomes the main link.
 */
export const FIELD_ROLES = {
  primaryUrl: { label: "Primary link", types: ["url"], description: "Main call-to-action (live site, purchase page, resource)." },
  repositoryUrl: { label: "Source code", types: ["url"], description: "Repository link." },
  videoUrl: { label: "YouTube video", types: ["url"], description: "Rendered as a click-to-load player; powers VideoObject." },
  slidesUrl: { label: "Slides", types: ["url", "file"], description: "Slide deck link or PDF." },
  eventName: { label: "Event name", types: ["text"], description: "Where a talk was given." },
  eventDate: { label: "Event date", types: ["date", "datetime"], description: "Powers Event structured data." },
  location: { label: "Location", types: ["text"], description: "City, venue or 'Online'." },
  startDate: { label: "Start date", types: ["date", "datetime"], description: "Beginning of a project or period." },
  endDate: { label: "End date", types: ["date", "datetime"], description: "End of a project or period." },
  period: { label: "Period label", types: ["text"], description: "Human label such as '2019 – 2021'." },
  projectStatus: { label: "Status", types: ["select", "text"], description: "Shown as a status chip." },
  techStack: { label: "Tech stack", types: ["multi_select", "text"], description: "Rendered as chips." },
  rating: { label: "Rating", types: ["number"], description: "Out of 5. Powers Review structured data." },
  itemName: { label: "Reviewed item", types: ["text"], description: "The book/product/course being reviewed." },
  itemAuthor: { label: "Item author", types: ["text"], description: "Author of the reviewed item." },
  isbn: { label: "ISBN", types: ["text"], description: "Book identifier." },
  coverImage: { label: "Cover image", types: ["image"], description: "Book or item cover." },
  duration: { label: "Duration", types: ["text", "number"], description: "Length of a video, talk or course." },
  transcript: { label: "Transcript", types: ["long_text"], description: "Full transcript for media." },
  takeaways: { label: "Key takeaways", types: ["long_text"], description: "One per line; shown as a summary box." },
  audience: { label: "Who this is for", types: ["text", "long_text"], description: "Shown near the top." },
  difficulty: { label: "Difficulty", types: ["select", "text"], description: "Beginner / Intermediate / Advanced." },
  prerequisites: { label: "Prerequisites", types: ["long_text"], description: "One per line." },
  sources: { label: "Sources", types: ["long_text"], description: "One reference per line; URLs become links." },
  interviewCompany: { label: "Interview company", types: ["text"], description: "Company of an interview page (e.g. Amazon)." },
  interviewRole: { label: "Interview role", types: ["text"], description: "Role interviewed for (e.g. SDE 1). Empty on the company's own page." },
} as const satisfies Record<string, { label: string; types: readonly FieldType[]; description: string }>;

export type FieldRole = keyof typeof FIELD_ROLES;

export function isFieldRole(value: unknown): value is FieldRole {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FIELD_ROLES, value);
}

export function roleAcceptsType(role: FieldRole, type: FieldType): boolean {
  return (FIELD_ROLES[role].types as readonly FieldType[]).includes(type);
}

export const FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,39}$/;

export type SelectOption = { value: string; label: string };

export type FieldOptions = {
  /** select / multi_select; interview_guide: its question categories, in display order */
  choices?: SelectOption[];
  /** multi_select: allow free-form values (e.g. tech stack). */
  allowCustom?: boolean;
  /** number */
  min?: number;
  max?: number;
  /** relation */
  targetTypeIds?: string[];
  multiple?: boolean;
  relationKind?: RelationKind;
  /** text-like placeholder in the admin form */
  placeholder?: string;
};

export type FieldDefinition = {
  id?: string;
  key: string;
  label: string;
  type: FieldType;
  role: FieldRole | null;
  required: boolean;
  helpText: string;
  options: FieldOptions;
  showInFacts: boolean;
  position: number;
};

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export const RELATION_KINDS = {
  related: { label: "Related to", inverse: "Related to", symmetric: true },
  references: { label: "References", inverse: "Referenced by", symmetric: false },
  expands_on: { label: "Expands on", inverse: "Expanded in", symmetric: false },
  part_of: { label: "Part of", inverse: "Includes", symmetric: false },
  derived_from: { label: "Created from", inverse: "Led to", symmetric: false },
  inspired_by: { label: "Inspired by", inverse: "Inspired", symmetric: false },
} as const;

export type RelationKind = keyof typeof RELATION_KINDS;

export function isRelationKind(value: unknown): value is RelationKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RELATION_KINDS, value);
}

// ---------------------------------------------------------------------------
// Document lifecycle
// ---------------------------------------------------------------------------

export const DOCUMENT_STATUSES = ["idea", "draft", "scheduled", "published", "archived"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  idea: "Idea",
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

/**
 * Not an editorial status: documents in the Trash. Kept out of
 * DOCUMENT_STATUSES so no status picker, import or `setStatus` action can
 * produce it — only the Trash operations can. Public reads allowlist
 * published/archived, so trashed documents are never served.
 */
export const TRASHED = "trashed" as const;
export type StoredStatus = DocumentStatus | typeof TRASHED;

export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: "Private",
  unlisted: "Unlisted",
  public: "Public",
};

export const ROBOTS_OPTIONS = ["default", "index", "noindex"] as const;
export type RobotsIndex = (typeof ROBOTS_OPTIONS)[number];

export const TAXONOMY_ROBOTS = ["auto", "index", "noindex"] as const;
export type TaxonomyRobots = (typeof TAXONOMY_ROBOTS)[number];

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === "string" && (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && (VISIBILITIES as readonly string[]).includes(value);
}

/** Category accent hues (mapped to design tokens), never raw CSS from the DB. */
export const ACCENTS = ["ember", "ocean", "moss", "plum", "sand", "slate"] as const;
export type Accent = (typeof ACCENTS)[number];
export function isAccent(value: unknown): value is Accent {
  return typeof value === "string" && (ACCENTS as readonly string[]).includes(value);
}
