import type { Metadata } from "next";
import {
  Fraunces,
  Plus_Jakarta_Sans,
  Outfit,
  DM_Sans,
} from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme";
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

export const metadata: Metadata = {
  title: "PedQuEST — Pediatric Quantitative EEG Strategic Taskforce",
  description:
    "PedQuEST is an international consortium of pediatric neurologists, neurophysiologists, and researchers advancing quantitative EEG (qEEG) for brain monitoring in pediatric critical care.",
  keywords: [
    "PedQuEST",
    "pediatric EEG",
    "quantitative EEG",
    "qEEG",
    "pediatric neurology",
    "neurocritical care",
    "EEG monitoring",
  ],
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
        <ThemeProvider>
          <Navbar />
          <main className="flex-1">
            {children}
          </main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
