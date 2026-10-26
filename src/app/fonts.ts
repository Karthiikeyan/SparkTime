import { JetBrains_Mono, Newsreader, Schibsted_Grotesk } from "next/font/google";

/**
 * Self-hosted at build time by next/font: no runtime request to Google, no
 * layout shift, CSP-friendly.
 *  - Newsreader: optical-size serif for long-form reading and display.
 *  - Schibsted Grotesk: an editorial grotesk (drawn for a news publisher) for UI.
 *  - JetBrains Mono: metadata, labels, code.
 */
export const serif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-newsreader",
});

export const sans = Schibsted_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-schibsted",
});

export const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
  preload: false,
});
