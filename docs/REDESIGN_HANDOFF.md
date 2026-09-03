---
tags:
  - domain/infrastructure
  - type/project
  - project/pedquest
  - domain/eeg-monitoring
  - domain/seizures-and-epilepsy
  - domain/research-methods
  - type/handoff
---
# PedQuEST Site Redesign — Handoff

**Purpose:** continue the dark-teal "instrument panel" redesign across the
remaining pages. The **homepage is done and live in production**; About →
Publications → Education → Members → Admin remain. This doc is self-contained —
a fresh session should be able to pick up from here.

_Written 2026-07-13. Author: prior Opus session._

---

## 1. Project facts

- **Repo:** `craigpress/pedquest-website` (GitHub, public). Working dir:
  `C:\Users\Craig\claude\PedQuest_website\pedquest-site`.
- **Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind
  v4 (CSS-var theming, no config file), Supabase (Postgres/Auth/Storage/RLS),
  Vercel (Git-connected — every push to a branch auto-builds a **preview**;
  merges to `main` auto-deploy **production**).
- **Vercel:** project/team IDs available via the authenticated `vercel` CLI
  (`vercel project ls`) or the dashboard — not repeated here (public repo).
  Preview URL pattern: `pedquest-site-git-<branch-with-dashes>-craigpress.vercel.app`.
  Production/main alias: `pedquest-site-git-main-craigpress.vercel.app`.
- **Supabase:** project id available via the Supabase MCP (`list_projects`) or
  dashboard — not repeated here.
- **Local build (Windows, avoids OOM):**
  `NODE_OPTIONS="--max-old-space-size=6144" node node_modules/next/dist/bin/next build`
  Typecheck: `node_modules/.bin/tsc --noEmit`.
- **Bash tool is Git Bash (POSIX).** Do NOT use PowerShell here-string syntax
  (`@'...'@`) — use real heredocs or `git commit -F file`.

## 2. What the current session shipped (already in production on `main`)

- **Homepage redesign** (PR #5, commit `b599445`): living-EEG hero, all 6
  sections, real data. **This is the reference implementation — copy its
  patterns.** File: `src/app/page.tsx`.
- **Site-wide token migration** to the dark-teal design system in
  `src/app/globals.css` (see §3). The whole site is now dark; every page
  inherits the palette, so un-redesigned pages already render dark (just with
  their old layouts).
- Earlier in the session (already merged): qEEG "Case of the Day" feature
  (`/education/case-of-the-day`, admin CMS at `/admin/cases`), RLS lockdown on
  publications/abstracts (`public.is_pedquest_admin()`), security headers +
  robots + sitemap + OG (`next.config.ts`, `src/app/{robots,sitemap}.ts`),
  65 MB image cleanup, `next/image` for two logos.
- **OpenWebUI env vars set in Vercel Production** (for the EEG AI-draft feature):
  `OPENWEBUI_BASE_URL`, `OPENWEBUI_MODEL` (=`claude`), `OPENWEBUI_API_KEY`. The
  base URL must be the **public** OpenWebUI endpoint (a LAN address is NOT
  reachable from Vercel); the URL + key live in the homelab secrets store — see
  the `homelab` skill / Obsidian vault, never commit them. Preview env vars were
  NOT set (Vercel scopes preview vars per-branch) — set them if a preview needs
  AI generation.

## 3. Design system (canonical — from the "Design system & token spec" mockup)

Dark, teal, "instrument panel," WCAG 2.2 AA. These are already live in
`src/app/globals.css` `:root` (dark is the only theme; `[data-theme]` maps to
the same values). Use the **semantic** names in new work:

```
--bg #080f1c   --surface #0f1c2e   --surface-2 #152539
--ink #e9f1f9  --ink-2 #aabfd3     --muted #7d93a9    --line #213344
--accent #2ed6c6  --accent-strong #54e2d4  --accent-soft #0e2f34
--warm #f0a94a (alerts/partial)   --good #3ecb8e (ok)
```
Legacy aliases still point at the same palette (`--text`=`--ink`,
`--accent-primary`=`--accent`, `--bg-card`=`--surface`, `--border`=`--line`,
etc.) so old components adopted the look automatically.

**Typography:** serif display (`--heading-font` = Fraunces) for headlines — the
mockups the user liked use serif; keep it. `--mono-font` for eyebrows, stat
labels, tags/chips, data readouts, footers. `--body-font` (Plus Jakarta) for
body. (The spec doc *also* floats a system-sans/mono option with no web fonts —
NOT chosen; user preferred the serif look.)

**Shared section pattern (every page):**
- `.section-eyebrow` — mono, uppercase, letter-spaced, `--accent`.
- `.section-h2` — serif, 2 lines, `text-wrap: balance`, `--ink`.
- `.section-sub` — `--ink-2`, ~52ch.
- Cards: `--surface` bg, `1px solid --line`, ~16px radius. **Exactly one
  mint-highlighted card per group** (`background: linear-gradient(150deg,
  var(--accent), #1aa596)` with dark text `#05201d`) — the primary CTA/explore.
- Mono for all labels/tags/data.
- Nav wordmark = waveform icon in an `--accent-soft` chip + "Ped" (ink) +
  "QuEST" (accent). Nav CTA = solid `--accent` "Join the consortium", dark text.

**IMPORTANT — reusable CSS location:** the homepage section styles
(`.home-section`, `.home-container`, `.section-head/-eyebrow/-h2/-sub`,
`.section-cta`, `.work-card`, `.network-card`, `.involve-card`, `.pub-row`,
`.stat-card`, etc.) currently live in an inline `<style>` block **inside
`page.tsx`**, so they are only injected on the homepage. **Before building other
pages, MOVE these shared classes into `globals.css`** (or a shared CSS import)
so About/Publications/etc. can reuse them. Keep page-specific bits local.

## 4. Reference implementation to copy

`src/app/page.tsx` is the pattern source:
- Section shell: `<section className="home-section"><div className="home-container"><div className="section-head">…`.
- `PubYearChart` component (inline SVG line+area chart from `publications` by
  year) — reusable for About's timeline and Publications' by-year chart.
- Real-data wiring: `members`, `institutions` (`@/data/members`),
  `publications` (`@/data/publications`). Stats are computed, e.g.
  `memberCount`, `institutionCount`, `countryCount`, `publicationCount`,
  `journalCount`, `since2021Count`, `pubsByYear`, regional split
  (`naMemberCount`/`intlMemberCount`). **Always wire real data, not the mockups'
  placeholder numbers** (mockups say 128 members/39 institutions; real registry
  differs — 69/59 currently).
- Hero living-EEG waves: `HERO_WAVE_LANES` (distinct `k`=frequency per lane,
  **uniform `HERO_WAVE_DUR` scroll** so lanes share one time axis — do not give
  lanes different durations, that produced an unrealistic "travelling ripple"
  the user rejected), `heroWavePath()` seamless-loop generator, honors
  `prefers-reduced-motion`.

## 5. Remaining pages — captured mockup structure

All mockups are the user's Claude artifacts (private; only viewable in the
user's authenticated browser). To view: use Claude-in-Chrome on the user's
browser, open the artifact URL, and **scroll manually / have the user scroll**
while you screenshot — the sandboxed iframe blocks source extraction and
synthetic scroll is unreliable (real trackpad scroll works). Build to match
visually; the pages are React rewrites, not literal HTML ports.

### About — artifact `092378fa-7d8b-4bb0-9c1c-255b031a2015`
1. Hero: eyebrow "About the consortium"; H1 "A shared answer to a question no
   single center can answer alone."; sub "Quantitative EEG can reveal the
   injured pediatric brain in real time — but only if it's measured, validated,
   and taught the same way everywhere. PedQuEST exists to make that happen."
2. Intro: bold lede "PedQuEST — the Pediatric Quantitative EEG Strategic
   Taskforce — is an international collaborative advancing EEG-based brain
   monitoring for critically ill children." + 2 body paragraphs, and a right
   **stats panel** (rows): Founded 2021 · Member investigators · Institutions ·
   Countries·continents · Peer-reviewed papers · Governance "2 Co-Directors" ·
   Scientific committee "5 members". Wire to real data + confirmed founding 2021.
3. "How we got here / A field reaching critical mass": publication-output
   timeline chart (reuse `PubYearChart`, full year range 1992→now).
4. **Leadership section** (not fully captured): build from real leadership
   members — `members` with `is_leadership` / `leadership_role`
   (`co_director`, `scientific_committee`, `senior_advisor`, `education_lead`).
   Cards with photo/name/title/institution, grouped by role. User approved
   using real leadership data over the mockup placeholders.

### Publications — artifact `9fd64a72-0361-4b17-9d3b-d4971fbb9e39`
- Hero: eyebrow "Research library"; H1 "The PedQuEST publication record"; sub
  about auto-refresh from PubMed + export; stat row (publications · journals ·
  1992–2026 span · since 2021).
- **Left sidebar:** BY YEAR bar chart + TOPIC filter list with counts (from
  `publications[].categories`). **Main:** search box + "Newest first" sort +
  "Export" button; "N of N shown"; publication cards (mono year · journal chip ·
  ORIGINAL badge · bold title · authors · topic pills · Cite / BibTeX / DOI↗).
- This page is functional (search/filter/sort) — check the existing
  `/publications` page for current data/logic to preserve.

### Education — artifact `cff95c69-7a80-4aa5-b181-f1bd5c127b4e`
- Hero: eyebrow "Education & training"; H1 "Learn to read the pediatric brain —
  the same way, everywhere."; subtitle.
- 4-step row: STEP 01 Fundamentals / 02 Case-based practice / 03 Bedside
  application / 04 Contribute data.
- "Resource library / What's available" section. **Tie in the existing qEEG
  Case of the Day** feature (already live at `/education/case-of-the-day`).

### Members
- No standalone Members mockup was made; the homepage "network" section covers
  the treatment (regional cards + member-map card). The existing `/members`
  page has a Leaflet map + member grid — restyle it to the dark palette (it
  already renders dark via tokens); apply section-head pattern and card styling.

### Admin — artifact `3bd05020-8f0d-4e69-a398-35dca3aaa631`
- Left sidebar "CONTENT ADMIN": Dashboard / Members / Publications / Education /
  Submissions(badge) + user footer. Dashboard: green "Access & safety" banner
  (server-side gated, RLS, audit-logged — matches the real requireAdmin/RLS
  work already shipped); 4 stat cards (Members +N this month / Publications
  auto-synced / Education resources / Pending submissions[warm]); PubMed scanner
  card ("Run scan now" → existing scan route); Recent-activity table.
- The existing admin is `src/app/admin/page.tsx` (~1700 lines, client-only,
  `ADMIN_EMAILS` hardcoded). Big; restyle carefully, don't break its logic.

Other mockups: `43c17727` = homepage v2 (BUILT); `e03fee22` = homepage v1
(superseded); `5a46096a` = design-system spec (§3).

## 6. Per-page workflow

1. `git checkout main && git pull` then `git checkout -b feat/<page>-redesign`.
2. Move shared section CSS to `globals.css` first (one-time, see §3).
3. Rebuild the page's `src/app/<page>/page.tsx` to the mockup using the shared
   patterns + real data.
4. `tsc --noEmit` then the heap-bumped `next build`. Fix unused-import/var lint
   (Next fails the build on them) — e.g. remove now-dead helpers.
5. Commit (`git commit -F msg.txt`, trailer: `Co-Authored-By: Claude …` +
   `Claude-Session: …`), push → Vercel builds the preview.
6. Send the user the preview URL; on approval, `gh pr create` + `gh pr merge
   <n> --squash --delete-branch`. **Only merge to `main` when the user
   explicitly authorizes it** (the agent merge-gate blocks self-merging
   otherwise; the user saying "merge" satisfies it).

## 7. Known nits / follow-ups (not blocking)

- **Theme toggle is now a no-op** (site is dark-only). Consider removing the
  sun/moon button from `Navbar.tsx` (and the mobile one), or leave it.
- Mobile nav CTA still says "Join PedQuEST" (desktop is "Join the consortium").
- `Navbar.tsx` line ~207 mobile avatar + line ~121 still use gradient
  backgrounds referencing old accents — harmless (tokens remapped) but could be
  cleaned to solid `--accent`.
- Admin/profile photo `<img>` tags are raw (blob:/DB URLs — `next/image` can't
  optimize; leave).
- `tsconfig.tsbuildinfo` is a tracked build artifact that should be gitignored.
- Pre-existing `next lint` script is broken (Next 16 removed `next lint`); rely
  on `tsc --noEmit` + `next build`.

## 8. Key decisions already made (do not re-litigate)

- **Dark teal, all pages** (not theme-aware) — user chose this.
- **Serif display** (Fraunces) kept for headlines; mono for labels/data.
- **Real data** everywhere, not mockup placeholder numbers.
- **Founded 2021** confirmed by user.
- Homepage v2 (living-EEG hero) was the chosen homepage direction.
- Preview-then-merge, one page at a time (user may switch to batching).

## 9. Scratch reference

A terser capture of the same specs is at (this session's scratchpad, may not
persist): `…/scratchpad/REDESIGN_SPEC.md`. This handoff supersedes it.
