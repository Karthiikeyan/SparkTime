/**
 * What a reader is told about a piece's form. Most writing needs no label —
 * an essay, a guide and a note are all simply something to read — so only
 * forms that change what the reader will get are named.
 */
export function intentLabel(type: { template: string; slug: string; name: string }): string | null {
  switch (type.template) {
    case "project":
      return "Project";
    case "collection":
      return type.slug === "collection" ? "Series" : type.name;
    case "media":
    case "story":
    case "resource":
      return type.name;
    default:
      return null;
  }
}
