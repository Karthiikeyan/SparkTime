/** Shared admin class names — a plain module so server and client components can both import it. */

/**
 * Look only — no width, padding or font size. Tailwind resolves conflicting
 * utilities by stylesheet order, not class order, so appending `w-auto` to a
 * class list that already has `w-full` silently loses. Compose sizes onto
 * this base instead of overriding `inputClass`.
 */
export const inputBase =
  "rounded-sm border border-line bg-surface outline-none transition-colors placeholder:text-subtle focus:border-accent aria-[invalid=true]:border-danger disabled:opacity-60";

/** The standard full-width field. */
export const inputClass = `${inputBase} w-full px-3 py-2 text-sm`;
