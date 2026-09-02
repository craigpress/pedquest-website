import type { Metadata } from "next";
import {
  Fraunces,
  Plus_Jakarta_Sans,
  Outfit,
  DM_Sans,
} from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const SITE_URL = "https://pedquest.org";
const SITE_TITLE = "PedQuEST — Pediatric Quantitative EEG Strategic Taskforce";
const SITE_DESCRIPTION =
  "PedQuEST is an international research consortium of pediatric neurologists, neurophysiologists, and researchers advancing quantitative EEG (qEEG) for brain monitoring in pediatric critical care. A research and collaboration platform — not medical advice.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  keywords: [
    "PedQuEST",
    "pediatric EEG",
    "quantitative EEG",
    "qEEG",
    "pediatric neurology",
    "neurocritical care",
    "EEG monitoring",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "PedQuEST",
    url: SITE_URL,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: "/images/pedquest-wordmark-flame-2026.png", alt: "PedQuEST" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/images/pedquest-wordmark-flame-2026.png"],
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${plusJakarta.variable} ${outfit.variable} ${dmSans.variable}`}
    >
      <body className="min-h-screen flex flex-col antialiased">
        <a href="#main-content" className="skip-to-content">
          Skip to main content
        </a>
        <Navbar />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
