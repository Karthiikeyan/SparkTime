import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Public pages are statically generated (ISR). Any change that could affect
 * what visitors see — a publish, a rename, a new relation, settings — marks
 * the whole public site stale. Content changes are infrequent and pages
 * interlink heavily (related content, counts, navigation), so a site-wide
 * invalidation is both correct and cheap: pages re-render lazily on their
 * next request.
 */
export function invalidatePublicSite(): void {
  try {
    revalidatePath("/", "layout");
  } catch (error) {
    // Outside a request context (scripts/tests) there is no cache to purge.
    if (process.env.NODE_ENV !== "test") console.warn("[revalidate] skipped:", error instanceof Error ? error.message : error);
  }
}
