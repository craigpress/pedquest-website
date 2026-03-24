"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/lib/theme";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/members", label: "Members" },
  { href: "/publications", label: "Publications" },
  { href: "/education", label: "Education" },
  { href: "/contact", label: "Contact" },
];

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}


export default function Navbar() {
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300`}
        style={{
          background: "var(--bg-nav)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
          boxShadow: scrolled ? "0 4px 30px rgba(0,0,0,0.08)" : "none",
        }}
      >
        {/* Top accent bar */}
        <div style={{
          height: 4,
          background: "linear-gradient(90deg, var(--accent-primary), var(--accent-secondary), var(--accent-tertiary, var(--accent-primary)))",
        }} />

        <nav
          className="mx-auto flex items-center justify-between"
          style={{ maxWidth: 1320, padding: "0 2.5rem", height: 88 }}
        >
          {/* Logo / Brand */}
          <Link
            href="/"
            className="flex items-center no-underline shrink-0 group"
            onClick={() => setMobileOpen(false)}
          >
            <Image
              src="/images/pedquest-logo-navbar.png"
              alt="PedQuEST — Pediatric qEEG Strategic Taskforce"
              width={182}
              height={52}
              priority
              className="transition-transform duration-300 group-hover:scale-105"
              style={{ objectFit: "contain" }}
            />
          </Link>

          {/* Desktop nav links */}
          <ul className="hidden lg:flex items-center gap-1.5 list-none m-0 p-0">
            {navLinks.map((link) => {
              const active = isActive(link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="relative px-5 py-3 rounded-lg no-underline transition-all duration-200"
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: active ? 700 : 500,
                      fontFamily: "var(--body-font)",
                      color: active ? "var(--accent-primary)" : "var(--text-secondary)",
                      background: active ? "var(--bg-card-hover)" : "transparent",
                      letterSpacing: "0.02em",
                    }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        e.currentTarget.style.color = "var(--text)";
                        e.currentTarget.style.background = "var(--bg-card-hover)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        e.currentTarget.style.color = "var(--text-secondary)";
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    {link.label}
                    {active && (
                      <span style={{
                        position: "absolute",
                        bottom: 4,
                        left: "20%",
                        right: "20%",
                        height: 3,
                        borderRadius: 3,
                        background: "var(--accent-primary)",
                      }} />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Right side: CTA + theme toggle + hamburger */}
          <div className="flex items-center gap-3">
            {/* Join CTA - desktop only */}
            <Link
              href="https://forms.office.com/r/0SdngdpiPt"
              target="_blank"
              className="hidden lg:flex items-center gap-2 px-6 py-3 rounded-full no-underline transition-all duration-200"
              style={{
                fontSize: "0.95rem",
                fontWeight: 600,
                fontFamily: "var(--body-font)",
                color: "white",
                background: "var(--accent-primary)",
                letterSpacing: "0.02em",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.9";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Join PedQuEST
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </Link>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              className="flex items-center justify-center w-10 h-10 rounded-full cursor-pointer transition-all duration-200"
              style={{
                background: "var(--bg-card-hover)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--accent-primary)";
                e.currentTarget.style.borderColor = "var(--accent-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-secondary)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              {theme === "light" ? <MoonIcon /> : <SunIcon />}
            </button>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle navigation menu"
              className="flex lg:hidden items-center justify-center w-10 h-10 rounded-full cursor-pointer transition-all duration-200"
              style={{
                background: mobileOpen ? "var(--accent-primary)" : "var(--bg-card-hover)",
                color: mobileOpen ? "white" : "var(--text-secondary)",
                border: mobileOpen ? "1px solid var(--accent-primary)" : "1px solid var(--border)",
              }}
            >
              {mobileOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile slide-down menu */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ top: 92 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setMobileOpen(false)}
          />
          {/* Menu panel */}
          <div
            className="relative"
            style={{
              background: "var(--bg-nav)",
              backdropFilter: "blur(20px)",
              borderBottom: "1px solid var(--border)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
            }}
          >
            <ul className="flex flex-col gap-1 list-none m-0 px-6 py-5">
              {navLinks.map((link) => {
                const active = isActive(link.href);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="block px-5 py-4 rounded-xl no-underline transition-all duration-200"
                      style={{
                        fontSize: "1.05rem",
                        fontWeight: active ? 700 : 500,
                        color: active ? "var(--accent-primary)" : "var(--text)",
                        fontFamily: "var(--body-font)",
                        background: active ? "var(--bg-card-hover)" : "transparent",
                        borderLeft: active ? "4px solid var(--accent-primary)" : "4px solid transparent",
                      }}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
              {/* Mobile Join CTA */}
              <li className="mt-3">
                <Link
                  href="https://forms.office.com/r/0SdngdpiPt"
                  target="_blank"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center gap-2 px-5 py-4 rounded-xl no-underline"
                  style={{
                    fontSize: "1rem",
                    fontWeight: 600,
                    color: "white",
                    background: "var(--accent-primary)",
                  }}
                >
                  Join PedQuEST
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="7" y1="17" x2="17" y2="7" />
                    <polyline points="7 7 17 7 17 17" />
                  </svg>
                </Link>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Spacer to push content below the fixed navbar */}
      <div style={{ height: 92 }} />
    </>
  );
}
