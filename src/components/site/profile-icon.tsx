import { AtSign, GitFork, Globe, Newspaper, PenLine } from "lucide-react";
import type { ProfilePlatform } from "@/lib/settings";

/**
 * Minimal monochrome platform glyphs built from simple shapes (the icon
 * library no longer ships brand marks). Links always carry a text label too.
 */
function Glyph({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function ProfileIcon({ platform, size = 18 }: { platform: ProfilePlatform; size?: number }) {
  switch (platform) {
    case "youtube":
      return (
        <Glyph size={size}>
          <rect x="2.5" y="5" width="19" height="14" rx="4" />
          <path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "linkedin":
      return (
        <Glyph size={size}>
          <rect x="3" y="3" width="18" height="18" rx="3.5" />
          <path d="M8 10.5v6M12 16.5v-6M12 13.2a2.7 2.7 0 0 1 5 0v3.3" />
          <circle cx="8" cy="7.6" r="0.9" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "x":
      return (
        <Glyph size={size}>
          <path d="M4.5 4.5l15 15M19.5 4.5l-15 15" />
        </Glyph>
      );
    case "instagram":
      return (
        <Glyph size={size}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="3.8" />
          <circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "github":
      return <GitFork size={size} strokeWidth={1.6} aria-hidden="true" />;
    case "medium":
      return <PenLine size={size} strokeWidth={1.6} aria-hidden="true" />;
    case "substack":
      return <Newspaper size={size} strokeWidth={1.6} aria-hidden="true" />;
    case "website":
      return <Globe size={size} strokeWidth={1.6} aria-hidden="true" />;
    default:
      return <AtSign size={size} strokeWidth={1.6} aria-hidden="true" />;
  }
}
