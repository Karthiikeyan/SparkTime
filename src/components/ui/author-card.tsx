import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { siteConfig } from "@/lib/site-config";

/** The author's portrait, cropped on the face. `size` is in pixels. */
export function AuthorAvatar({ size, alt = "", className, priority = false }: { size: number; alt?: string; className?: string; priority?: boolean }) {
  return (
    <Image
      src={siteConfig.authorPhoto.src}
      width={siteConfig.authorPhoto.width}
      height={siteConfig.authorPhoto.height}
      alt={alt}
      priority={priority}
      sizes={`${size}px`}
      style={{ width: size, height: size }}
      className={cn("shrink-0 rounded-full bg-line object-cover object-[52%_35%]", className)}
    />
  );
}

/**
 * Who wrote it. "compact" closes an article: portrait, name, one line and a
 * link to About. "full" gives the portrait room (Start here).
 */
export function AuthorCard({ name, headline, label = "Written by", variant = "compact", className }: { name: string; headline?: string; label?: string; variant?: "compact" | "full"; className?: string }) {
  const full = variant === "full";
  return (
    <aside aria-label="About the author" className={cn("flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-line bg-surface", full ? "gap-x-6 p-6 sm:p-8" : "p-4 sm:p-6", className)}>
      <AuthorAvatar size={full ? 96 : 64} alt={name} className={full ? "size-20 sm:size-24" : "size-14 sm:size-16"} />
      <div className="min-w-[12rem] flex-1">
        <p className="caps text-xs text-muted">{label}</p>
        <p className={cn("mt-0.5 font-serif font-medium leading-tight", full ? "text-[1.625rem]" : "text-[1.375rem]")}>{name}</p>
        {headline && <p className="mt-1.5 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">{headline}</p>}
        {full && (
          <Link href="/about" className="mt-1 inline-flex min-h-11 items-center font-semibold text-accent-ink hover:underline hover:underline-offset-4">
            About me →
          </Link>
        )}
      </div>
      {!full && (
        <Link href="/about" className="inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-accent-ink hover:underline hover:underline-offset-4">
          About me →
        </Link>
      )}
    </aside>
  );
}
