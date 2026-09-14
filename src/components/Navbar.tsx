"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useUser, useMember, useRole } from "@/lib/auth";

type MenuLink = { href: string; label: string; hint: string };

/** Learner-facing EEG destinations. A dropdown on desktop, rows in the mobile drawer. */
const labLinks: MenuLink[] = [
  { href: "/courses", label: "Courses", hint: "Your classes and the EEGs assigned to you" },
  { href: "/education/question-bank", label: "Question bank", hint: "Practice qEEG questions" },
  { href: "/admin/eeg-lab/library", label: "EEG Library", hint: "Find a teaching recording" },
  { href: "/admin/eeg-lab/viewer", label: "EEG Viewer", hint: "Open a recording in the browser" },
];

/** Editor-only destinations. A menu on desktop, rows in the mobile drawer. */
const editorLinks: MenuLink[] = [
  { href: "/admin/qbank", label: "Question bank review", hint: "Review queue and drafts" },
  { href: "/admin/eeg-lab/review", label: "EEG review queue", hint: "Recordings awaiting peer review" },
  { href: "/admin/eeg-lab", label: "EEG Lab console", hint: "Build and queue recordings" },
  { href: "/admin", label: "Admin dashboard", hint: "Members, publications, events" },
];

function menuLinkActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  if (href === "/admin/eeg-lab") return pathname === "/admin/eeg-lab";
  return pathname.startsWith(href);
}

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/members", label: "Members" },
  { href: "/publications", label: "Publications" },
  { href: "/education", label: "Education" },
  { href: "/events", label: "Events" },
];

/** The EEG Library dropdown sits after this link in the desktop list. */
const LAB_MENU_AFTER = "/education";

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

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Desktop dropdown. `variant="nav"` styles the trigger like the other top links
 * (the EEG Library menu); `variant="pill"` is the bordered Editor button.
 * Closes on an outside click, Escape, or navigation.
 */
function NavMenu(props: {
  id: string;
  label: string;
  links: MenuLink[];
  pathname: string;
  variant: "nav" | "pill";
  align: "left" | "right";
}) {
  const { id, label, links, pathname, variant, align } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = links.some((l) => menuLinkActive(l.href, pathname));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  useEffect(() => { setOpen(false); }, [pathname]);

  const triggerStyle: React.CSSProperties = variant === "nav"
    ? {
        fontSize: "1.05rem",
        fontWeight: active ? 700 : 500,
        fontFamily: "var(--body-font)",
        color: active ? "var(--accent-primary)" : open ? "var(--text)" : "var(--text-secondary)",
        background: active || open ? "var(--bg-card-hover)" : "transparent",
        letterSpacing: "0.02em",
        padding: "0.75rem 1.25rem",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        position: "relative",
        whiteSpace: "nowrap",
      }
    : {
        fontSize: "0.85rem",
        fontWeight: 600,
        fontFamily: "var(--body-font)",
        color: open || active ? "var(--text)" : "var(--text-secondary)",
        padding: "0.45rem 0.85rem",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: open ? "var(--bg-card-hover)" : "transparent",
        cursor: "pointer",
      };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        className="flex items-center gap-1.5 transition-all duration-200"
        style={triggerStyle}
        onMouseEnter={(e) => {
          if (variant === "nav" && !active && !open) {
            e.currentTarget.style.color = "var(--text)";
            e.currentTarget.style.background = "var(--bg-card-hover)";
          }
        }}
        onMouseLeave={(e) => {
          if (variant === "nav" && !active && !open) {
            e.currentTarget.style.color = "var(--text-secondary)";
            e.currentTarget.style.background = "transparent";
          }
        }}
      >
        {label}
        <Chevron open={open} />
        {variant === "nav" && active && (
          <span style={{
            position: "absolute",
            bottom: 0,
            left: 8,
            right: 8,
            height: 3,
            borderRadius: 99,
            background: "linear-gradient(90deg, var(--accent-primary), var(--accent-secondary, var(--accent-primary)))",
          }} />
        )}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          style={{
            position: "absolute", [align]: 0, top: "calc(100% + 8px)", minWidth: 260,
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12,
            boxShadow: "0 12px 40px rgba(0,0,0,0.25)", padding: 6, display: "grid", gap: 2, zIndex: 60,
          }}
        >
          {links.map((l) => {
            const linkActive = menuLinkActive(l.href, pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                role="menuitem"
                className="no-underline"
                style={{
                  display: "grid", gap: 1, padding: "8px 10px", borderRadius: 8,
                  background: linkActive ? "var(--bg-card-hover)" : "transparent",
                  color: "var(--text)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = linkActive ? "var(--bg-card-hover)" : "transparent"; }}
              >
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: linkActive ? "var(--accent-primary)" : "var(--text)" }}>{l.label}</span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{l.hint}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A titled group of rows in the mobile drawer. */
function DrawerSection(props: { title: string; links: MenuLink[]; pathname: string; onNavigate: () => void }) {
  return (
    <li className="mt-3">
      <div style={{ fontFamily: "var(--mono-font)", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text-muted)", padding: "0 0.25rem 0.5rem" }}>
        {props.title}
      </div>
      <ul className="flex flex-col gap-1 list-none m-0 p-0">
        {props.links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              onClick={props.onNavigate}
              className="flex items-center justify-between gap-3 px-5 py-3 rounded-xl no-underline"
              style={{
                fontSize: "1rem",
                fontWeight: 600,
                color: menuLinkActive(l.href, props.pathname) ? "var(--accent-primary)" : "var(--text-secondary)",
                border: "1px solid var(--border)",
                background: "transparent",
              }}
            >
              <span>{l.label}</span>
              <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--text-muted)" }}>{l.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user, loading: userLoading } = useUser();
  const { member } = useMember();
  const { isEditor } = useRole();

  const userInitials = member
    ? member.name
        .split(" ")
        .filter(Boolean)
        .map((p) => p[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : null;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // /education stays a plain link; its question-bank child belongs to the EEG menu.
    if (href === "/education") return pathname === "/education" || (pathname.startsWith("/education/") && !pathname.startsWith("/education/question-bank"));
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
          className="mx-auto flex items-center justify-between px-5 lg:px-10"
          // globals.css has an unlayered `* { margin: 0 }` that beats Tailwind's mx-auto, so centre explicitly
          style={{ maxWidth: 1320, height: 88, margin: "0 auto" }}
        >
          {/* Logo / Brand */}
          <Link
            href="/"
            className="flex items-center gap-2.5 no-underline shrink-0 group"
            onClick={() => setMobileOpen(false)}
          >
            {/* PedQuEST brand — qEEG-brain symbol + flame wordmark (2026) */}
            <Image
              src="/images/pedquest-symbol-brain-2026.png"
              alt=""
              aria-hidden="true"
              width={1254}
              height={1254}
              priority
              style={{ height: 44, width: 44, flex: "none" }}
            />
            <Image
              src="/images/pedquest-wordmark-flame-darknav-2026.png"
              alt="PedQuEST"
              width={2113}
              height={744}
              priority
              className="transition-opacity duration-300 group-hover:opacity-85"
              style={{ height: 48, width: "auto" }}
            />
          </Link>

          {/* Desktop nav links */}
          <ul className="hidden lg:flex items-center gap-1.5 list-none m-0 p-0">
            {navLinks.map((link) => {
              const active = isActive(link.href);
              return (
                <li key={link.href} className="flex items-center gap-1.5">
                  <Link
                    href={link.href}
                    className="relative px-5 py-3 rounded-lg no-underline transition-all duration-200"
                    aria-current={active ? "page" : undefined}
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
                        bottom: 0,
                        left: 8,
                        right: 8,
                        height: 3,
                        borderRadius: 99,
                        background: "linear-gradient(90deg, var(--accent-primary), var(--accent-secondary, var(--accent-primary)))",
                      }} />
                    )}
                  </Link>
                  {link.href === LAB_MENU_AFTER && (
                    <NavMenu id="lab-menu" label="EEG Library" links={labLinks} pathname={pathname} variant="nav" align="left" />
                  )}
                </li>
              );
            })}
          </ul>

          {/* Right side: CTA + hamburger */}
          <div className="flex items-center gap-3">
            {/* Editor console — editors and admins */}
            {!userLoading && user && isEditor && (
              <div className="hidden lg:block">
                <NavMenu id="editor-menu" label="Editor" links={editorLinks} pathname={pathname} variant="pill" align="right" />
              </div>
            )}
            {/* Profile button — shown when logged in */}
            {!userLoading && user && (
              <Link
                href="/profile"
                className="hidden lg:flex items-center gap-2 no-underline transition-all duration-200"
                title="My Profile"
                style={{
                  padding: member?.photoUrl ? "0" : "0.45rem 0.85rem",
                  borderRadius: member?.photoUrl ? "50%" : 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-card-hover)",
                  color: "var(--accent-primary)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  fontFamily: "var(--body-font)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                {member?.photoUrl ? (
                  <img
                    src={member.photoUrl}
                    alt={member.name}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      objectFit: "cover",
                    }}
                  />
                ) : userInitials ? (
                  <span>{userInitials}</span>
                ) : (
                  <UserIcon />
                )}
              </Link>
            )}

            {/* Log in — desktop only, hidden when logged in */}
            {!userLoading && !user && (
              <Link
                href="/login"
                className="hidden lg:flex items-center no-underline transition-all duration-200"
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  fontFamily: "var(--body-font)",
                  color: "var(--text-secondary)",
                  padding: "0.45rem 0.85rem",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                Log in
              </Link>
            )}
            {/* Join CTA - desktop only, hidden when logged in */}
            {!user && (
              <Link
                href="/join"
                className="hidden lg:flex items-center no-underline transition-all duration-200"
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  fontFamily: "var(--body-font)",
                  color: "#05201d",
                  padding: "0.55rem 1.2rem",
                  borderRadius: 999,
                  border: "none",
                  background: "var(--accent-primary)",
                  letterSpacing: "0.01em",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent-primary-hover)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--accent-primary)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                Join the consortium
              </Link>
            )}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-menu"
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
            style={{ background: "rgba(0,0,0,0.65)" }}
            onClick={() => setMobileOpen(false)}
          />
          {/* Menu panel — solid so page content can't bleed through */}
          <div
            className="relative"
            style={{
              background: "var(--bg)",
              borderBottom: "1px solid var(--border)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.45)",
              maxHeight: "calc(100vh - 92px)",
              overflowY: "auto",
            }}
          >
            <ul id="mobile-nav-menu" className="flex flex-col gap-1 list-none m-0 px-6 py-5" role="navigation" aria-label="Mobile navigation">
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
              {/* EEG Library — everyone */}
              <DrawerSection title="EEG Library" links={labLinks} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
              {/* Mobile editor console — editors and admins */}
              {!userLoading && user && isEditor && (
                <DrawerSection title="Editor" links={editorLinks} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
              )}
              {/* Mobile profile link — when logged in */}
              {!userLoading && user && (
                <li className="mt-3">
                  <Link
                    href="/profile"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-center gap-2 px-5 py-4 rounded-xl no-underline"
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      color: "var(--accent-primary)",
                      border: "1px solid var(--accent-primary)",
                      background: "transparent",
                    }}
                  >
                    <UserIcon /> My Profile
                  </Link>
                </li>
              )}
              {/* Mobile log in — hidden when logged in */}
              {!userLoading && !user && (
                <li className="mt-3">
                  <Link
                    href="/login"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-center gap-2 px-5 py-4 rounded-xl no-underline"
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border)",
                      background: "transparent",
                    }}
                  >
                    Log in
                  </Link>
                </li>
              )}
              {/* Mobile Join CTA — hidden when logged in */}
              {!user && (
                <li className="mt-3">
                  <Link
                    href="/join"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-center gap-2 px-5 py-4 rounded-xl no-underline"
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      color: "white",
                      background: "var(--accent-primary)",
                    }}
                  >
                    Join the consortium
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="7" y1="17" x2="17" y2="7" />
                      <polyline points="7 7 17 7 17 17" />
                    </svg>
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Spacer to push content below the fixed navbar */}
      <div style={{ height: 92 }} />
    </>
  );
}
