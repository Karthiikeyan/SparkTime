import type { Metadata, Viewport } from "next";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { siteUrl } from "@/server/env";
import { getBrand, loadAllSettings } from "@/server/services/settings";
import { mono, sans, serif } from "./fonts";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const [settings, brand] = await Promise.all([loadAllSettings(), getBrand()]);
  // The product is SparkTime; the person who writes it stays its author, creator and publisher.
  const name = brand.author;
  return {
    metadataBase: new URL(siteUrl()),
    applicationName: brand.name,
    authors: [{ name, url: `${siteUrl()}/about` }],
    creator: name,
    publisher: name,
    formatDetection: { telephone: false, address: false, email: false },
    // Advertise the feed only while it exists (Settings → Features); /feed.xml 404s otherwise.
    alternates: settings.features.rss ? { types: { "application/rss+xml": [{ url: "/feed.xml", title: `${brand.name} — RSS` }] } } : undefined,
    verification: {
      google: settings.seo.googleSiteVerification || undefined,
      other: settings.seo.bingSiteVerification ? { "msvalidate.01": settings.seo.bingSiteVerification } : undefined,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f0" },
    { media: "(prefers-color-scheme: dark)", color: "#100f0e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning data-theme="light">
      <head>
        {/*
          Static, audited inline script (no user data) that applies the saved
          theme before first paint. Allowed by SHA-256 hash in the admin CSP
          (proxy.ts). suppressHydrationWarning: browsers hide nonce attributes
          from the DOM, which React would otherwise report as a mismatch.
        */}
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} suppressHydrationWarning />
      </head>
      <body className="bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
