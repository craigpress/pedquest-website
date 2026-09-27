"use client";

// EEG Lab authoring guide. Gated like the Lab console it documents: useRole(),
// editors and admins only. Content lives in src/lib/lab/guide-content.ts.

import { useState } from "react";
import Link from "next/link";
import { useRole } from "@/lib/auth";
import { adminShellWide, h1 } from "@/lib/admin-ui";
import {
  AGE_DEFAULTS_NOTE, AGE_DEFAULTS_TABLE, GUIDE_INTRO, GUIDE_LIMITS, GUIDE_READING_NOTES, GUIDE_RENDERER_VERSION,
  GUIDE_SECTIONS, GUIDE_UPDATED, GUIDE_WALKTHROUGHS, type GuideControl,
} from "@/lib/lab/guide-content";
import { SYNTHETIC_STAMP } from "@/lib/lab/types";
import styles from "./guide.module.css";

const NAV = [
  { id: "about", title: "About this guide" },
  ...GUIDE_SECTIONS.map((s) => ({ id: s.id, title: s.title })),
  { id: "walkthroughs", title: "Building a teaching case" },
  { id: "defaults", title: "Age defaults" },
  { id: "limits", title: "Limits" },
];

function expertName(name: string): string {
  const [kind, field] = name.split(":");
  if (kind === "bg") return `background.${field}`;
  if (kind === "event") return `events[].type: ${field}`;
  if (kind === "field") return `events[].${field}`;
  return field;
}

function Control({ c, showNames }: { c: GuideControl; showNames: boolean }) {
  return (
    <article className={styles.control} id={`c-${c.id}`}>
      <header className={styles.controlHead}>
        <h3>{c.name}</h3>
        <span className={c.where === "form" ? styles.badgeForm : styles.badgeExpert}>
          {c.where === "form" ? (c.formLabel ? `Form: ${c.formLabel}` : "In the Guided form") : "Expert mode"}
        </span>
      </header>
      <p className={styles.what}>{c.what}</p>
      <dl className={styles.facts}>
        {(c.options?.length || c.range) && (
          <div className={styles.factWide}>
            <dt>{c.options?.length ? "Options" : "Range"}</dt>
            <dd>
              {c.range && <p>{c.range}</p>}
              {c.options?.length ? (
                <ul className={styles.options}>
                  {c.options.map((x) => (
                    <li key={x.value || "blank"}><strong>{x.label}</strong> — {x.text}</li>
                  ))}
                </ul>
              ) : null}
            </dd>
          </div>
        )}
        <div><dt>Default if left blank</dt><dd>{c.defaultText}</dd></div>
        <div><dt>On the page</dt><dd>{c.onPage}</dd></div>
        {c.onTrends && <div><dt>On the trends</dt><dd>{c.onTrends}</dd></div>}
      </dl>
      {showNames && c.names.length > 0 && (
        <p className={styles.names}>{c.names.map(expertName).join(" · ")}</p>
      )}
    </article>
  );
}

export default function GuideView() {
  const { isEditor, loading } = useRole();

  if (loading) {
    return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  }
  if (!isEditor) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Editor access required</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          The EEG Lab authoring guide is for PedQuEST editors and admins who build and review teaching recordings.{" "}
          <Link href="/login">Sign in</Link>, or ask an admin to grant you the editor role.
        </p>
      </div>
    );
  }

  return <GuideBody />;
}

export function GuideBody() {
  const [showNames, setShowNames] = useState(false);
  return (
    <div className={styles.guide}>
      <Link className={styles.back} href="/admin/eeg-lab">← EEG Lab console</Link>
      <header className={styles.header}>
        <span className={styles.eyebrow}>EEG teaching lab</span>
        <h1>Authoring guide</h1>
        <p>How each setting in the EEG Lab shapes the synthetic recording: what it is, what you can choose, the default if you leave it blank, and what a reader will see on the page and trends.</p>
        <p className={styles.meta}>Renderer {GUIDE_RENDERER_VERSION} · updated {GUIDE_UPDATED}</p>
      </header>
      <div role="note" className={styles.stamp}>{SYNTHETIC_STAMP}</div>

      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Guide sections">
          {NAV.map((n) => <a key={n.id} href={`#${n.id}`}>{n.title}</a>)}
        </nav>
        <select
          className={styles.mobileNav} aria-label="Jump to section" defaultValue=""
          onChange={(e) => { if (e.target.value) window.location.hash = e.target.value; }}
        >
          <option value="" disabled>Jump to section…</option>
          {NAV.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
        </select>

        <div className={styles.content}>
          <section id="about" className={styles.section}>
            <h2>About this guide</h2>
            {GUIDE_INTRO.map((p) => <p key={p}>{p}</p>)}
            <ul className={styles.notes}>{GUIDE_READING_NOTES.map((p) => <li key={p}>{p}</li>)}</ul>
            <label className={styles.toggle}>
              <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
              Show Expert-mode names
            </label>
          </section>

          {GUIDE_SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className={styles.section}>
              <h2>{s.title}</h2>
              <p className={styles.summary}>{s.summary}</p>
              {s.intro.map((p) => <p key={p}>{p}</p>)}
              {s.controls.map((c) => <Control key={c.id} c={c} showNames={showNames} />)}
              {s.notes?.map((p) => <p key={p} className={styles.note}>{p}</p>)}
            </section>
          ))}

          <section id="walkthroughs" className={styles.section}>
            <h2>Building a teaching case</h2>
            <p className={styles.summary}>Worked examples using the Guided form. Adjust timing and voltages to taste; change the variation number for a different example of the same case.</p>
            {GUIDE_WALKTHROUGHS.map((w) => (
              <article key={w.id} id={`w-${w.id}`} className={styles.control}>
                <header className={styles.controlHead}><h3>{w.title}</h3></header>
                <p className={styles.what}>{w.teaches}</p>
                <ol className={styles.steps}>
                  {w.steps.map((st) => <li key={st.label}><strong>{st.label}.</strong> {st.detail}</li>)}
                </ol>
                <h4 className={styles.subhead}>What the reader will see</h4>
                <ul className={styles.options}>{w.expect.map((x) => <li key={x}>{x}</li>)}</ul>
              </article>
            ))}
          </section>

          <section id="defaults" className={styles.section}>
            <h2>Age defaults</h2>
            <p className={styles.summary}>What an age band starts from when the background is left blank.</p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Age band</th><th>Dominant rhythm</th><th>Amplitude</th><th>Slow fraction</th><th>Background</th><th>Blinks</th></tr>
                </thead>
                <tbody>
                  {AGE_DEFAULTS_TABLE.map((r) => (
                    <tr key={r.age}>
                      <th scope="row">{r.age}</th><td>{r.dominantHz}</td><td>{r.amplitude}</td>
                      <td>{r.slowFraction}</td><td>{r.background}</td><td>{r.blinks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.ageCards}>
              {AGE_DEFAULTS_TABLE.map((r) => (
                <div key={r.age} className={styles.ageCard}>
                  <h3>{r.age}</h3>
                  <dl>
                    <dt>Dominant rhythm</dt><dd>{r.dominantHz}</dd>
                    <dt>Amplitude</dt><dd>{r.amplitude}</dd>
                    <dt>Slow fraction</dt><dd>{r.slowFraction}</dd>
                    <dt>Background</dt><dd>{r.background}</dd>
                    <dt>Blinks</dt><dd>{r.blinks}</dd>
                  </dl>
                </div>
              ))}
            </div>
            <p className={styles.note}>{AGE_DEFAULTS_NOTE}</p>
          </section>

          <section id="limits" className={styles.section}>
            <h2>Limits</h2>
            <ul className={styles.notes}>{GUIDE_LIMITS.map((p) => <li key={p}>{p}</li>)}</ul>
          </section>
        </div>
      </div>
    </div>
  );
}
