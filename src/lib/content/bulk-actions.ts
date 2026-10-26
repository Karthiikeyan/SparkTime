/**
 * The bulk actions the Studio offers, shared by the browser (labels,
 * confirmation copy) and the server (which validates the action itself; see
 * services/content-ops.ts). Pure data — no server imports.
 */

export const BULK_ACTIONS = [
  "draft",
  "publish",
  "archive",
  "trash",
  "restore",
  "delete",
  "duplicate",
  "featured",
  "visibility",
  "indexing",
  "addTopic",
  "removeTopic",
  "addTag",
  "removeTag",
  "addToCollection",
  "removeFromCollection",
] as const;
export type BulkActionName = (typeof BULK_ACTIONS)[number];

export function isBulkActionName(value: unknown): value is BulkActionName {
  return typeof value === "string" && (BULK_ACTIONS as readonly string[]).includes(value);
}

/** Verb for buttons and confirmations, and the past tense for result messages. */
export const BULK_ACTION_TEXT: Record<BulkActionName, { verb: string; done: string }> = {
  draft: { verb: "Move to Draft", done: "moved to Draft" },
  publish: { verb: "Publish", done: "published" },
  archive: { verb: "Archive", done: "archived" },
  trash: { verb: "Move to Trash", done: "moved to Trash" },
  restore: { verb: "Restore", done: "restored as drafts" },
  delete: { verb: "Delete permanently", done: "permanently deleted" },
  duplicate: { verb: "Duplicate", done: "duplicated as drafts" },
  featured: { verb: "Change featured", done: "updated" },
  visibility: { verb: "Change visibility", done: "updated" },
  indexing: { verb: "Change search engine indexing", done: "updated" },
  addTopic: { verb: "Add topic", done: "added to the topic" },
  removeTopic: { verb: "Remove topic", done: "removed from the topic" },
  addTag: { verb: "Add tag", done: "tagged" },
  removeTag: { verb: "Remove tag", done: "untagged" },
  addToCollection: { verb: "Add to collection", done: "added to the collection" },
  removeFromCollection: { verb: "Remove from collection", done: "removed from the collection" },
};

/** Actions the server can revert (POST …/bulk/undo). Permanent deletion is the only irreversible one. */
export const REVERSIBLE_ACTIONS: ReadonlySet<BulkActionName> = new Set(BULK_ACTIONS.filter((a) => a !== "delete"));

/** Ids per run request. The browser sends an operation as a sequence of chunks this size or smaller. */
export const BULK_CHUNK_SIZE = 50;
/** Hard server cap per run request. */
export const MAX_BULK_CHUNK = 100;
/** Most documents one operation (one selection) may touch. */
export const MAX_BULK_SELECTION = 5000;
/** How long an operation stays undoable. */
export const UNDO_WINDOW_MINUTES = 30;
/** What the server requires alongside `delete`, so a stray request can never delete. */
export const PERMANENT_DELETE_TOKEN = "permanently-delete";
