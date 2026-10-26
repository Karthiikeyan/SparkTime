import { objectPosition, srcSetFor, type MediaAsset } from "@/lib/media";
import { cn } from "@/lib/cn";

/**
 * Responsive image from pre-generated WebP variants. Width/height are always
 * set (no layout shift); a 16px blurred placeholder paints instantly.
 */
export function MediaImage({
  asset,
  alt,
  sizes = "(min-width: 1024px) 720px, 100vw",
  className,
  priority = false,
  fill = false,
}: {
  asset: Pick<MediaAsset, "url" | "width" | "height" | "variants" | "alt" | "placeholder" | "dominantColor" | "focalX" | "focalY">;
  alt?: string;
  sizes?: string;
  className?: string;
  priority?: boolean;
  fill?: boolean;
}) {
  const style: React.CSSProperties = {
    backgroundColor: asset.dominantColor ?? undefined,
    backgroundImage: asset.placeholder ? `url("${asset.placeholder.replace(/"/g, "")}")` : undefined,
    backgroundSize: "cover",
    backgroundPosition: "center",
    objectPosition: objectPosition(asset),
  };
  return (
    // eslint-disable-next-line @next/next/no-img-element -- variants are generated at upload; next/image would re-optimise (and bill) them
    <img
      src={asset.url}
      srcSet={srcSetFor(asset)}
      sizes={sizes}
      width={asset.width ?? undefined}
      height={asset.height ?? undefined}
      alt={alt ?? asset.alt ?? ""}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={cn(fill ? "absolute inset-0 size-full object-cover" : "h-auto w-full", className)}
      style={style}
    />
  );
}
