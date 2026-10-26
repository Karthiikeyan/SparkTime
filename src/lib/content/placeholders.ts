import type { BlockNode, Doc } from "./blocks";
import { extractPlainText, hasPlaceholderText } from "./derive";

/** A block that is only a bracketed prompt: "[TODO] Add …", "[SparkTribe dashboard screenshot]". */
const BRACKETED = /^\s*\[[^[\]]{3,}\]\.?\s*$/;

function isPlaceholderBlock(node: BlockNode): boolean {
  if (!["paragraph", "callout", "blockquote"].includes(node.type)) return false;
  const text = extractPlainText({ type: "doc", content: [node] } as Doc).trim();
  return text.length > 0 && (hasPlaceholderText(text) || BRACKETED.test(text));
}

/**
 * The page as visitors should read it: the owner's unfilled prompts left out,
 * and any heading that would then stand over nothing. Nothing is changed in the
 * stored document; this only decides what is shown. The studio flags the same
 * blocks as "to do" so they get filled in.
 */
export function stripPlaceholders(doc: Doc): Doc {
  const rank = (node: BlockNode) => Number(node.attrs?.level ?? 2);
  const keep = doc.content.map((node) => !isPlaceholderBlock(node));
  // Back to front, so a section whose only content was an emptied sub-section goes too.
  for (let i = doc.content.length - 1; i >= 0; i--) {
    const node = doc.content[i]!;
    if (node.type !== "heading") continue;
    let hasContent = false;
    for (let j = i + 1; j < doc.content.length; j++) {
      const next = doc.content[j]!;
      if (next.type === "heading" && rank(next) <= rank(node)) break;
      if (keep[j]) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) keep[i] = false;
  }
  return keep.every(Boolean) ? doc : { ...doc, content: doc.content.filter((_, i) => keep[i]) };
}
