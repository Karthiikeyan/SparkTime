/** Media shape shared by the renderer, admin and API. URLs are pre-resolved server-side. */
export type MediaVariant = { width: number; height: number; url: string };

export type MediaAsset = {
  id: string;
  kind: "image" | "file" | "audio";
  url: string;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  alt: string;
  caption: string;
  placeholder: string | null;
  dominantColor: string | null;
  focalX: number | null;
  focalY: number | null;
  variants: MediaVariant[];
  createdAt: string;
};

/** srcset including the primary rendition. */
export function srcSetFor(asset: Pick<MediaAsset, "url" | "width" | "variants">): string | undefined {
  const entries = [...asset.variants.map((v) => `${v.url} ${v.width}w`)];
  if (asset.width) entries.push(`${asset.url} ${asset.width}w`);
  return entries.length > 1 ? entries.join(", ") : undefined;
}

export function objectPosition(asset: Pick<MediaAsset, "focalX" | "focalY">): string | undefined {
  if (asset.focalX === null || asset.focalY === null) return undefined;
  return `${Math.round(asset.focalX * 100)}% ${Math.round(asset.focalY * 100)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
