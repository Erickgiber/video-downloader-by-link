import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteName = "Descargador de Videos por URL";
const siteDescription =
  "Descarga y comparte videos desde YouTube, Facebook, Twitch, X (Twitter) y enlaces directos. Vista previa rápida, tema claro/oscuro y descarga cuando sea compatible.";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: siteName,
  title: {
    default: `${siteName} — Baja videos de YouTube, Facebook, Twitch y X` ,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  keywords: [
    "descargar videos",
    "descargador de videos",
    "youtube downloader",
    "bajar videos facebook",
    "descargar videos twitch",
    "descargar videos x twitter",
    "descargar por url",
    "video downloader",
  ],
  authors: [{ name: "Video Downloader" }],
  creator: "Video Downloader",
  publisher: "Video Downloader",
  category: "tools",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    title: siteName,
    siteName,
    description: siteDescription,
    locale: "es_ES",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: siteName,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@",
    creator: "@",
    title: siteName,
    description: siteDescription,
    images: ["/og-image.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <script
          type="application/ld+json"
          // JSON-LD para SEO (WebSite + WebApplication)
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: siteName,
              url: siteUrl,
              description: siteDescription,
              inLanguage: "es-ES",
              potentialAction: {
                "@type": "SearchAction",
                target: `${siteUrl}/?q={query}`,
                "query-input": "required name=query",
              },
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: siteName,
              applicationCategory: "UtilitiesApplication",
              operatingSystem: "Any",
              url: siteUrl,
              description: siteDescription,
              offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
            }),
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
