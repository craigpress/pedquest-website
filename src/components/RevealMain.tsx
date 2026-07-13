"use client";

import { useScrollReveal } from "@/lib/useScrollReveal";

// Client boundary so server pages (which keep their metadata export) can use
// the .reveal scroll animation driven by useScrollReveal.
export default function RevealMain({ children }: { children: React.ReactNode }) {
  const ref = useScrollReveal();
  return <main ref={ref as React.RefObject<HTMLElement>}>{children}</main>;
}
