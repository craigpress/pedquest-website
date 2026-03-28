"use client";

import { useEffect, useRef } from "react";

export function useScrollReveal() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );

    el.querySelectorAll(".reveal").forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, []);

  return ref;
}
