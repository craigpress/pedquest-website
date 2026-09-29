"use client";

// EEG feature gallery: every feature the synthetic renderer draws, for editors to review and to show colleagues.
// UX spec research/eeg-atlas/gallery-20260929/UX_SPEC.md, visual spec VISUAL_SPEC.md. Gated like the Lab guide
// (useRole, editors and admins); the data routes re-check the editor role. All view state lives in the URL
// (?c= category, q= search, status=, age=, acns=, view=grid|one, item=<id>, present=1, queue=1).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  CATEGORY_GROUPS, CATEGORY_LABEL, CATEGORY_ORDER, STATUS_LABEL, altText, effectiveStatus, isTrend, montageLabel,
  paramChips, searchText,
  type GalleryItem, type GalleryManifest, type GalleryNote, type GalleryState, type GalleryStatus,
} from "@/lib/eeg-gallery";
import styles from "./gallery.module.css";

type Urls = Record<string, { thumb: string | null; full: string | null }>;
type Data = {
  manifest: GalleryManifest; state: Record<string, GalleryState>; noteCount: Record<string, number>; urls: Urls;
  expiresAt: number;
};
type View = "grid" | "one";
type Params = {
  c: string; q: string; status: string; age: string; acns: string; view: View; item: string | null; present: boolean;
  queue: boolean;
};

const STATUSES: GalleryStatus[] = ["new", "needs_review", "accepted"];

function readParams(): Params {
  const p = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  return {
    c: p.get("c") || "all", q: p.get("q") || "", status: p.get("status") || "", age: p.get("age") || "",
    acns: p.get("acns") || "", view: p.get("view") === "one" ? "one" : "grid", item: p.get("item"),
    present: p.get("present") === "1", queue: p.get("queue") === "1",
  };
}

function writeParams(p: Params, push = false) {
  const u = new URLSearchParams();
  if (p.c && p.c !== "all") u.set("c", p.c);
  if (p.q) u.set("q", p.q);
  if (p.status) u.set("status", p.status);
  if (p.age) u.set("age", p.age);
  if (p.acns) u.set("acns", p.acns);
  if (p.view !== "grid") u.set("view", p.view);
  if (p.item) u.set("item", p.item);
  if (p.present) u.set("present", "1");
  if (p.queue) u.set("queue", "1");
  const url = `${window.location.pathname}${u.toString() ? `?${u}` : ""}`;
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

function acnsMain(tag?: string): string {
  return (tag || "").split(/[+\s,]/)[0].trim();
}

function Chip({ status }: { status: GalleryStatus }) {
  return <span className={`${styles.chip} ${styles[`chip_${status}`]}`}>{STATUS_LABEL[status]}</span>;
}

function Icon({ d, label }: { d: string; label?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} aria-label={label}>
      <path d={d} />
    </svg>
  );
}
const IC = { close: "M18 6 6 18M6 6l12 12", left: "M15 18l-6-6 6-6", right: "M9 18l6-6-6-6" };

export default function GalleryView() {
  const { isEditor, loading: roleLoading } = useRole();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState<Params>(() => readParams());
  const loadingRef = useRef(false);

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const res = await fetch("/api/admin/eeg-gallery", { headers: await authHeaders(), cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body as Data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      loadingRef.current = false;
    }
  }, [authHeaders]);

  useEffect(() => { if (isEditor) void load(); }, [isEditor, load]);
  // re-sign before the URLs expire
  useEffect(() => {
    if (!data) return;
    const ms = Math.max(60_000, data.expiresAt - Date.now() - 10 * 60_000);
    const t = window.setTimeout(() => void load(), ms);
    return () => window.clearTimeout(t);
  }, [data, load]);

  const update = useCallback((patch: Partial<Params>, push = false) => {
    setP((cur) => {
      const next = { ...cur, ...patch };
      writeParams(next, push);
      return next;
    });
  }, []);
  useEffect(() => {
    const onPop = () => setP(readParams());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const items = useMemo(() => data?.manifest.items ?? [], [data]);
  const statusOf = useCallback(
    (it: GalleryItem) => effectiveStatus(it, data?.state[it.id]), [data],
  );

  // filters other than category, so the rail can show counts for every category
  const base = useMemo(() => {
    const q = p.q.trim().toLowerCase();
    return items.filter((it) =>
      (!q || searchText(it).includes(q))
      && (!p.status || statusOf(it) === p.status)
      && (!p.age || it.tags.age === p.age)
      && (!p.acns || acnsMain(it.tags.acns) === p.acns));
  }, [items, p.q, p.status, p.age, p.acns, statusOf]);
  const shown = useMemo(() => {
    const list = p.c === "all" ? base : base.filter((it) => it.category === p.c);
    return [...list].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  }, [base, p.c]);
  const ordered = useMemo(() => {
    // teaching order: category, then subcategory in first-appearance order, then catalog order
    const out: GalleryItem[] = [];
    for (const c of CATEGORY_ORDER) {
      const inCat = shown.filter((it) => it.category === c);
      const subs = [...new Set(inCat.map((it) => it.subcategory))];
      for (const s of subs) out.push(...inCat.filter((it) => it.subcategory === s));
    }
    return out;
  }, [shown]);

  const ages = useMemo(() => [...new Set(items.map((i) => i.tags.age).filter(Boolean))] as string[], [items]);
  const acnsTags = useMemo(() => [...new Set(items.map((i) => acnsMain(i.tags.acns)).filter(Boolean))].sort(), [items]);
  const totals = useMemo(() => {
    const t = { new: 0, needs_review: 0, accepted: 0 } as Record<GalleryStatus, number>;
    for (const it of items) t[statusOf(it)] += 1;
    return t;
  }, [items, statusOf]);

  const setStatus = useCallback(async (it: GalleryItem, status: GalleryStatus) => {
    setData((d) => d && ({ ...d, state: { ...d.state, [it.id]: { status, rendererVersion: it.rendererVersion,
      updatedByName: "you", updatedAt: new Date().toISOString() } } }));
    const res = await fetch("/api/admin/eeg-gallery/state", {
      method: "POST", headers: await authHeaders(), body: JSON.stringify({ itemId: it.id, status }),
    });
    if (!res.ok) { setError(`Could not save the status (${res.status}).`); void load(); }
  }, [authHeaders, load]);

  if (roleLoading) return <main className={styles.gallery}><p>Loading…</p></main>;
  if (!isEditor) {
    return (
      <main className={styles.gallery}>
        <span className={styles.eyebrow}>EEG Lab · editors</span>
        <h1>EEG feature gallery</h1>
        <div className={styles.empty}>
          Editors only. <Link href="/login">Sign in</Link> with an editor account.
        </div>
      </main>
    );
  }

  const current = p.item ? ordered.find((i) => i.id === p.item) ?? items.find((i) => i.id === p.item) ?? null : null;
  const unresolved = ordered.filter((i) => statusOf(i) !== "accepted");
  const nav = p.queue ? unresolved : ordered;

  if (p.present) {
    return <Presentation items={ordered} urls={data?.urls ?? {}} startId={p.item}
      onExit={(id) => update({ present: false, item: null }, false)}
      onMove={(id) => update({ item: id })} onError={() => void load()} />;
  }

  const sections = CATEGORY_ORDER.filter((c) => ordered.some((i) => i.category === c));
  const pct = (n: number) => (items.length ? `${(100 * n) / items.length}%` : "0");

  return (
    <main className={styles.gallery}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>EEG Lab · editors · renderer {data?.manifest.rendererVersion || "…"}</span>
          <h1>EEG feature gallery</h1>
          <p>
            One synthetic page per feature the renderer draws: normal backgrounds, variants, artifacts, epileptiform
            patterns, seizures, ACNS critical-care terminology, neonatal records and trends. Click a page to read it
            at full size, set its review status and leave notes.
          </p>
        </div>
        {data && (
          <div className={styles.progress} role="status">
            <b>{totals.accepted}</b> / {items.length} accepted · <span className={styles.rev}>{totals.needs_review} need
            review</span> · {totals.new} new
            <div className={styles.bar} aria-hidden>
              <i className={styles.ok} style={{ width: pct(totals.accepted) }} />
              <i className={styles.nr} style={{ width: pct(totals.needs_review) }} />
            </div>
          </div>
        )}
      </header>

      <div className={styles.toolbar}>
        <input className={styles.search} type="search" placeholder="Search titles, captions, ACNS terms…"
          aria-label="Search the gallery" value={p.q} onChange={(e) => update({ q: e.target.value })} />
        <select className={styles.select} aria-label="Status" value={p.status}
          onChange={(e) => update({ status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className={styles.select} aria-label="Age" value={p.age} onChange={(e) => update({ age: e.target.value })}>
          <option value="">All ages</option>
          {ages.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
        </select>
        {acnsTags.length > 0 && (
          <select className={styles.select} aria-label="ACNS term" value={p.acns}
            onChange={(e) => update({ acns: e.target.value })}>
            <option value="">All ACNS terms</option>
            {acnsTags.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <div className={styles.seg} role="group" aria-label="Layout">
          <button type="button" aria-pressed={p.view === "grid"} onClick={() => update({ view: "grid" })}>Grid</button>
          <button type="button" aria-pressed={p.view === "one"} onClick={() => update({ view: "one" })}>1-up</button>
        </div>
        <button type="button" className={styles.btn} disabled={!unresolved.length}
          onClick={() => update({ queue: true, item: unresolved[0]?.id ?? null }, true)}>
          Review queue ({unresolved.length})
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!ordered.length}
          onClick={() => update({ present: true, item: ordered[0]?.id ?? null }, true)}>
          ▶ Present
        </button>
      </div>

      {error && <div className={styles.empty} role="alert">{error} <button className={styles.btn} onClick={() => void load()}>Retry</button></div>}

      <div className={styles.layout}>
        <nav className={styles.rail} aria-label="Categories">
          <button type="button" className={styles.railBtn} aria-current={p.c === "all"} onClick={() => update({ c: "all" })}>
            All features <small>{base.length}</small>
          </button>
          {CATEGORY_GROUPS.map((g) => (
            <div key={g.label} style={{ display: "contents" }}>
              <div className={styles.railHead}>{g.label}</div>
              {g.categories.map((c) => {
                const inCat = base.filter((i) => i.category === c.id);
                const acc = inCat.filter((i) => statusOf(i) === "accepted").length;
                return (
                  <button key={c.id} type="button" className={styles.railBtn} aria-current={p.c === c.id}
                    onClick={() => update({ c: c.id })} disabled={!inCat.length && !items.some((i) => i.category === c.id)}>
                    {c.label} <small>{inCat.length ? `${acc}/${inCat.length}` : "—"}</small>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.content}>
          <div className={styles.mobileCat}>
            <select className={styles.select} aria-label="Category" value={p.c} onChange={(e) => update({ c: e.target.value })}>
              <option value="all">All features · {base.length}</option>
              {CATEGORY_ORDER.map((c) => {
                const n = base.filter((i) => i.category === c).length;
                return <option key={c} value={c} disabled={!n}>{CATEGORY_LABEL[c]} · {n}</option>;
              })}
            </select>
          </div>
          <p className={styles.count} role="status">
            {data ? `${ordered.length} of ${items.length}` : "—"}
            {p.c !== "all" ? ` · ${CATEGORY_LABEL[p.c as keyof typeof CATEGORY_LABEL] ?? p.c}` : ""}
            {p.status ? ` · ${STATUS_LABEL[p.status as GalleryStatus]}` : ""}
            {(p.q || p.status || p.age || p.acns) && (
              <button type="button" onClick={() => update({ q: "", status: "", age: "", acns: "" })}>Clear filters</button>
            )}
          </p>

          {!data && !error && (
            <div className={styles.grid}>{Array.from({ length: 6 }, (_, k) => <div key={k} className={styles.skeleton} />)}</div>
          )}
          {data && !ordered.length && (
            <div className={styles.empty}>
              {items.length ? "No items match these filters." : "The gallery has no renders yet."}
            </div>
          )}

          {sections.map((c) => {
            const inCat = ordered.filter((i) => i.category === c);
            const subs = [...new Set(inCat.map((i) => i.subcategory))];
            const rev = inCat.filter((i) => statusOf(i) === "needs_review").length;
            const group = CATEGORY_GROUPS.find((g) => g.categories.some((x) => x.id === c))?.label;
            return (
              <section key={c} id={`cat-${c}`} className={styles.section}>
                <div className={styles.secHead}>
                  <div>
                    <span className={styles.secEyebrow}>{group}</span>
                    <h2>{CATEGORY_LABEL[c]}</h2>
                  </div>
                  <span className={styles.secCount}>
                    {inCat.length} renders{rev ? <> · <span className={styles.rev}>{rev} need review</span></> : null}
                  </span>
                </div>
                {subs.map((s) => (
                  <div key={s}>
                    {subs.length > 1 && <h3 className={styles.sub}>{s}</h3>}
                    <div className={p.view === "one" ? styles.oneUp : styles.grid}>
                      {inCat.filter((i) => i.subcategory === s).map((it) => (
                        <Card key={it.id} it={it} status={statusOf(it)} thumb={data?.urls[it.id]?.thumb ?? null}
                          notes={data?.noteCount[it.id] ?? 0} onOpen={() => update({ item: it.id, queue: false }, true)}
                          onImgError={() => void load()} />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      {current && data && (
        <Viewer it={current} list={nav} urls={data.urls} status={statusOf(current)} queue={p.queue}
          authHeaders={authHeaders}
          onClose={() => { const id = current.id; update({ item: null, queue: false }); requestAnimationFrame(() =>
            document.getElementById(`item-${id}`)?.focus()); }}
          onMove={(id) => update({ item: id })}
          onStatus={(s) => void setStatus(current, s)}
          onPresent={() => update({ present: true })}
          onNoteAdded={() => setData((d) => d && ({ ...d, noteCount: { ...d.noteCount,
            [current.id]: (d.noteCount[current.id] ?? 0) + 1 } }))}
          onImgError={() => void load()} />
      )}
    </main>
  );
}

function Card({ it, status, thumb, notes, onOpen, onImgError }: {
  it: GalleryItem; status: GalleryStatus; thumb: string | null; notes: number; onOpen: () => void;
  onImgError: () => void;
}) {
  const chips = paramChips(it);
  return (
    <button type="button" id={`item-${it.id}`} className={styles.card} onClick={onOpen}
      aria-label={`${it.title}, ${STATUS_LABEL[status]}. Open the viewer.`}>
      <figure style={{ margin: 0 }}>
        <div className={styles.mat}>
          {thumb
            ? <img src={thumb} alt={altText(it)} width={1600} height={900} loading="lazy" decoding="async"
              onError={onImgError} />
            : <div className={styles.missing}>Image unavailable</div>}
        </div>
        <figcaption className={styles.cardBody}>
          <div className={styles.cardTop}>
            <span className={styles.cardEyebrow}>{it.subcategory}</span>
            <Chip status={status} />
          </div>
          <h4 className={styles.cardTitle}>{it.title}</h4>
          <p className={styles.cardCaption}>{it.caption}</p>
          <div className={styles.chips}>
            {chips.map((c) => <span key={c} className={styles.pill}>{c}</span>)}
            {it.tags.acns && <span className={`${styles.pill} ${styles.pillAcns}`}>{it.tags.acns}</span>}
            {notes > 0 && <span className={styles.noteCount}>{notes} note{notes > 1 ? "s" : ""}</span>}
          </div>
        </figcaption>
      </figure>
    </button>
  );
}

function Viewer({ it, list, urls, status, queue, authHeaders, onClose, onMove, onStatus, onPresent, onNoteAdded,
  onImgError }: {
  it: GalleryItem; list: GalleryItem[]; urls: Urls; status: GalleryStatus; queue: boolean;
  authHeaders: () => Promise<Record<string, string>>; onClose: () => void; onMove: (id: string) => void;
  onStatus: (s: GalleryStatus) => void; onPresent: () => void; onNoteAdded: () => void; onImgError: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(false);
  const [notes, setNotes] = useState<GalleryNote[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const idx = list.findIndex((i) => i.id === it.id);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);
  useEffect(() => { setZoom(false); }, [it.id]);
  useEffect(() => {
    let live = true;
    setNotes(null);
    (async () => {
      const res = await fetch(`/api/admin/eeg-gallery/notes?item=${encodeURIComponent(it.id)}`,
        { headers: await authHeaders(), cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (live) setNotes(res.ok ? body.notes : []);
    })();
    return () => { live = false; };
  }, [it.id, authHeaders]);
  // neighbours' full images, so stepping through is instant
  useEffect(() => {
    for (const n of [prev, next]) if (n && urls[n.id]?.full) { const im = new Image(); im.src = urls[n.id].full!; }
  }, [prev, next, urls]);

  const mark = useCallback((s: GalleryStatus) => {
    onStatus(s);
    if (queue && s === "accepted" && next) onMove(next.id);
  }, [onStatus, queue, next, onMove]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if ((k === "arrowleft" || k === "j") && prev) { e.preventDefault(); onMove(prev.id); }
      else if ((k === "arrowright" || k === "k") && next) { e.preventDefault(); onMove(next.id); }
      else if (k === "z" || k === "f") setZoom((z) => !z);
      else if (k === "a") mark("accepted");
      else if (k === "n") mark("needs_review");
      else if (k === "u") mark("new");
      else if (k === "p") onPresent();
      else if (k === "c") { e.preventDefault(); document.getElementById("gallery-note")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onMove, mark, onPresent]);

  // touch swipe between items
  const touch = useRef<number | null>(null);

  async function addNote() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const res = await fetch("/api/admin/eeg-gallery/notes", {
      method: "POST", headers: await authHeaders(), body: JSON.stringify({ itemId: it.id, body }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) { setNotes((n) => [...(n ?? []), out.note]); setDraft(""); onNoteAdded(); }
  }

  const full = urls[it.id]?.full;
  const t = it.tags;
  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby="gallery-viewer-title"
      onCancel={(e) => { e.preventDefault(); if (zoom) setZoom(false); else onClose(); }}>
      <div className={styles.viewer}>
        <div className={`${styles.stage} ${zoom ? styles.zoomed : ""}`}
          onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            if (touch.current === null || zoom) return;
            const dx = e.changedTouches[0].clientX - touch.current;
            touch.current = null;
            if (dx > 60 && prev) onMove(prev.id);
            else if (dx < -60 && next) onMove(next.id);
          }}>
          <div className={styles.stageMat}>
            {full
              ? <img src={full} alt={altText(it)} onClick={() => setZoom((z) => !z)} onError={onImgError}
                style={{ cursor: zoom ? "zoom-out" : "zoom-in" }} />
              : <div className={styles.missing} style={{ width: "min(80vw, 900px)" }}>Image unavailable</div>}
          </div>
        </div>
        <aside className={styles.panel}>
          <span className={styles.eyebrow}>{CATEGORY_LABEL[it.category]} · {it.subcategory}</span>
          <h2 id="gallery-viewer-title">{it.title}</h2>
          <Chip status={status} /> <span className={styles.pos}>{idx + 1} / {list.length}{queue ? " in queue" : ""}</span>
          <p className={styles.panelCaption}>{it.caption}</p>
          <dl className={styles.facts}>
            {t.age && <><dt>Age</dt><dd>{t.age.replace(/_/g, " ")}</dd></>}
            {t.state && t.state !== "unknown" && <><dt>State</dt><dd>{t.state}</dd></>}
            {!isTrend(it) && t.montage && <><dt>Montage</dt><dd>{montageLabel(t.montage)}</dd></>}
            {!isTrend(it) && t.sensitivity_uv_mm && <><dt>Sensitivity</dt><dd>{t.sensitivity_uv_mm} µV/mm</dd></>}
            {t.acns && <><dt>ACNS 2021</dt><dd>{t.acns}</dd></>}
            <dt>Image</dt><dd>{it.kind.replace(/_/g, " ")}</dd>
            <dt>Renderer</dt><dd>{it.rendererVersion}</dd>
            <dt>Item</dt><dd>{it.id}</dd>
          </dl>
          <div className={`${styles.seg} ${styles.statusSeg}`} role="group" aria-label="Review status">
            {STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => mark(s)}>{STATUS_LABEL[s]}</button>
            ))}
          </div>
          <div className={styles.notes}>
            <h3>Notes</h3>
            {notes === null && <p className={styles.noteMeta}>Loading…</p>}
            {notes?.length === 0 && <p className={styles.noteMeta}>No notes yet.</p>}
            {notes?.map((n) => (
              <div key={n.id} className={styles.note}>
                <span className={styles.noteMeta}>
                  {n.authorName || "editor"} · {n.createdAt.slice(0, 10)} ·{" "}
                  <span className={n.rendererVersion !== it.rendererVersion ? styles.stale : undefined}>
                    renderer {n.rendererVersion}
                  </span>
                </span>
                <p>{n.body}</p>
              </div>
            ))}
            <div className={styles.noteForm}>
              <textarea id="gallery-note" value={draft} placeholder="What should change? (Ctrl/Cmd+Enter to save)"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addNote(); } }} />
              <button type="button" className={styles.btn} disabled={busy || !draft.trim()} onClick={() => void addNote()}>
                Save note
              </button>
            </div>
          </div>
          <p className={styles.kbd}>
            <kbd>←</kbd>/<kbd>→</kbd> previous / next · <kbd>Z</kbd> 1:1 · <kbd>A</kbd> accept · <kbd>N</kbd> needs
            review · <kbd>U</kbd> new · <kbd>C</kbd> note · <kbd>P</kbd> present · <kbd>Esc</kbd> close
          </p>
        </aside>
      </div>
      <button type="button" className={`${styles.iconBtn} ${styles.close}`} onClick={onClose} aria-label="Close viewer">
        <Icon d={IC.close} />
      </button>
      {prev && (
        <button type="button" className={`${styles.iconBtn} ${styles.prev}`} onClick={() => onMove(prev.id)}
          aria-label={`Previous: ${prev.title}`}><Icon d={IC.left} /></button>
      )}
      {next && (
        <button type="button" className={`${styles.iconBtn} ${styles.next}`} onClick={() => onMove(next.id)}
          aria-label={`Next: ${next.title}`}><Icon d={IC.right} /></button>
      )}
    </dialog>
  );
}

type Slide = { kind: "title"; category: string; sub: string; n: number } | { kind: "item"; it: GalleryItem };

function Presentation({ items, urls, startId, onExit, onMove, onError }: {
  items: GalleryItem[]; urls: Urls; startId: string | null; onExit: (id: string | null) => void;
  onMove: (id: string) => void; onError: () => void;
}) {
  const slides = useMemo(() => {
    const out: Slide[] = [];
    let key = "";
    for (const it of items) {
      const k = `${it.category}|${it.subcategory}`;
      if (k !== key) {
        key = k;
        out.push({ kind: "title", category: CATEGORY_LABEL[it.category], sub: it.subcategory,
          n: items.filter((x) => x.category === it.category && x.subcategory === it.subcategory).length });
      }
      out.push({ kind: "item", it });
    }
    return out;
  }, [items]);
  const [k, setK] = useState(() => {
    const i = slides.findIndex((s) => s.kind === "item" && s.it.id === startId);
    return i > 0 && slides[i - 1].kind === "title" ? i - 1 : Math.max(0, i);
  });
  const [hideCaption, setHideCaption] = useState(false);
  const [projector, setProjector] = useState(false);
  const [idle, setIdle] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const s = slides[k];

  useEffect(() => { if (s?.kind === "item") onMove(s.it.id); }, [s, onMove]);
  useEffect(() => {
    const el = rootRef.current;
    if (el?.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => undefined);
    return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined); };
  }, []);
  useEffect(() => {
    let t = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), 2500); };
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", wake);
    return () => { window.clearTimeout(t); window.removeEventListener("mousemove", wake); window.removeEventListener("keydown", wake); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "arrowright" || key === " " || key === "k" || key === "pagedown") { e.preventDefault(); setK((x) => Math.min(slides.length - 1, x + 1)); }
      else if (key === "arrowleft" || key === "j" || key === "pageup") { e.preventDefault(); setK((x) => Math.max(0, x - 1)); }
      else if (key === "h") setHideCaption((h) => !h);
      else if (key === "escape") onExit(s?.kind === "item" ? s.it.id : null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, onExit, s]);
  const touch = useRef<number | null>(null);

  if (!s) return <div className={styles.present}><p style={{ margin: "auto" }}>Nothing to present.</p></div>;
  return (
    <div ref={rootRef} className={`${styles.present} ${idle ? styles.idle : ""} ${projector ? styles.projector : ""}`}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (dx < -60) setK((x) => Math.min(slides.length - 1, x + 1));
        else if (dx > 60) setK((x) => Math.max(0, x - 1));
      }}>
      {s.kind === "title" ? (
        <div className={`${styles.presentStage} ${styles.titleCard}`} style={{ gridRow: "1 / -1" }}>
          <p>{s.category}</p>
          <h2>{s.sub}</h2>
          <p>{s.n} example{s.n > 1 ? "s" : ""} · synthetic EEG · PedQuEST</p>
        </div>
      ) : (
        <>
          <div className={styles.presentStage}>
            <div className={styles.stageMat}>
              {urls[s.it.id]?.full
                ? <img src={urls[s.it.id].full!} alt={altText(s.it)} onError={onError} />
                : <div className={styles.missing} style={{ width: "60vw" }}>Image unavailable</div>}
            </div>
          </div>
          <div className={styles.strip}>
            <div>
              <h2>{s.it.title}</h2>
              {!hideCaption && <p>{s.it.caption}</p>}
            </div>
            <span className={styles.stripMeta}>
              {paramChips(s.it).join(" · ")} · synthetic EEG · {k + 1}/{slides.length}
            </span>
          </div>
        </>
      )}
      <div className={styles.ctl}>
        <button type="button" onClick={() => setHideCaption((h) => !h)}>{hideCaption ? "Show" : "Hide"} caption (H)</button>
        <button type="button" onClick={() => setProjector((x) => !x)}>{projector ? "Dark" : "Projector"}</button>
        <button type="button" onClick={() => onExit(s.kind === "item" ? s.it.id : null)}>Exit (Esc)</button>
      </div>
    </div>
  );
}
