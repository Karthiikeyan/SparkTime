/**
 * Allowlisted embed providers. Users paste a normal page URL; we extract a
 * validated identifier and build the iframe URL ourselves. A user-supplied
 * iframe src is never rendered.
 */

export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (YOUTUBE_ID_PATTERN.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v");
    else {
      const match = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
      candidate = match?.[1] ?? null;
    }
  }
  return candidate && YOUTUBE_ID_PATTERN.test(candidate) ? candidate : null;
}

/** Parses "90", "1m30s", "1h2m3s" into seconds. */
export function parseYouTubeStart(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) return Math.max(0, Math.floor(input));
  if (typeof input !== "string") return 0;
  let raw = input.trim();
  try {
    const url = new URL(raw);
    raw = url.searchParams.get("t") ?? url.searchParams.get("start") ?? "";
  } catch {
    // not a URL — treat as a bare time value
  }
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!match || !raw) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function youTubeEmbedUrl(id: string, start = 0): string {
  const params = new URLSearchParams({ autoplay: "1", rel: "0", modestbranding: "1" });
  if (start > 0) params.set("start", String(start));
  // youtube-nocookie avoids tracking cookies until the viewer actually plays.
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

export function youTubeThumbnail(id: string, quality: "hq" | "max" = "hq"): string {
  return `https://i.ytimg.com/vi/${id}/${quality === "max" ? "maxresdefault" : "hqdefault"}.jpg`;
}

export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export type EmbedProvider = "vimeo" | "codepen" | "spotify" | "loom";

export type ParsedEmbed = {
  provider: EmbedProvider;
  /** Provider-specific validated identifier (may contain "/" for spotify/codepen). */
  id: string;
};

export const EMBED_PROVIDER_LABELS: Record<EmbedProvider, string> = {
  vimeo: "Vimeo",
  codepen: "CodePen",
  spotify: "Spotify",
  loom: "Loom",
};

/** Hosts that must appear in CSP frame-src. Keep in sync with buildEmbedSrc. */
export const EMBED_FRAME_ORIGINS = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://codepen.io",
  "https://open.spotify.com",
  "https://www.loom.com",
] as const;

export function parseEmbedUrl(input: unknown): ParsedEmbed | null {
  if (typeof input !== "string") return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parts.find((p) => /^\d{6,12}$/.test(p));
    return id ? { provider: "vimeo", id } : null;
  }
  if (host === "codepen.io") {
    // codepen.io/{user}/pen/{hash}
    const user = parts[0];
    const hash = parts[2];
    if ((parts[1] === "pen" || parts[1] === "embed") && user && hash && /^[\w-]{1,40}$/.test(user) && /^[A-Za-z0-9]{4,12}$/.test(hash)) {
      return { provider: "codepen", id: `${user}/${hash}` };
    }
    return null;
  }
  if (host === "open.spotify.com") {
    const offset = parts[0] === "embed" ? 1 : 0;
    const kind = parts[offset];
    const id = parts[offset + 1];
    if (kind && id && ["track", "album", "playlist", "episode", "show"].includes(kind) && /^[A-Za-z0-9]{22}$/.test(id)) {
      return { provider: "spotify", id: `${kind}/${id}` };
    }
    return null;
  }
  if (host === "loom.com") {
    const id = parts[1];
    if ((parts[0] === "share" || parts[0] === "embed") && id && /^[a-f0-9]{32}$/.test(id)) return { provider: "loom", id };
    return null;
  }
  return null;
}

/** Builds the iframe src from a *validated* embed. Re-validates defensively. */
export function buildEmbedSrc(embed: ParsedEmbed): string | null {
  switch (embed.provider) {
    case "vimeo":
      return /^\d{6,12}$/.test(embed.id) ? `https://player.vimeo.com/video/${embed.id}?dnt=1` : null;
    case "codepen": {
      const [user, hash] = embed.id.split("/");
      if (!user || !hash || !/^[\w-]{1,40}$/.test(user) || !/^[A-Za-z0-9]{4,12}$/.test(hash)) return null;
      return `https://codepen.io/${user}/embed/${hash}?default-tab=result`;
    }
    case "spotify": {
      const [kind, id] = embed.id.split("/");
      if (!kind || !id || !["track", "album", "playlist", "episode", "show"].includes(kind) || !/^[A-Za-z0-9]{22}$/.test(id)) return null;
      return `https://open.spotify.com/embed/${kind}/${id}`;
    }
    case "loom":
      return /^[a-f0-9]{32}$/.test(embed.id) ? `https://www.loom.com/embed/${embed.id}` : null;
    default:
      return null;
  }
}
