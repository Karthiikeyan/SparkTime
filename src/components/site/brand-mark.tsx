import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * The logo: the pen-nib mark from public/images (built from Logo.png by
 * scripts/make-brand-assets.mjs). The dark theme gets the same mark in the
 * accent colour, because the original dark green disappears on a dark page.
 * Decorative: the name beside it is what names the link.
 */
export function BrandMark({ className }: { className?: string }) {
  const size = { width: 175, height: 240 };
  return (
    <>
      <Image src="/images/logo-mark.png" alt="" aria-hidden="true" {...size} className={cn("w-auto dark:hidden", className)} />
      <Image src="/images/logo-mark-dark.png" alt="" aria-hidden="true" {...size} className={cn("hidden w-auto dark:block", className)} />
    </>
  );
}
