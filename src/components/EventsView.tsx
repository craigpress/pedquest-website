"use client";

import Image from "next/image";
import Link from "next/link";
import {
  FORMAT_LABELS,
  fmtEventDate,
  fmtEventTimeRange,
  isPastEvent,
  lectureSeries,
  type PublicEvent,
} from "@/lib/events";
import EventRegisterForm from "@/components/EventRegisterForm";
import { useScrollReveal } from "@/lib/useScrollReveal";

function EventCard({ ev, featured }: { ev: PublicEvent; featured?: boolean }) {
  const past = isPastEvent(ev);
  const startDate = fmtEventDate(ev.startsAt, ev.timezone);
  const endDate = ev.endsAt ? fmtEventDate(ev.endsAt, ev.timezone) : null;
  const multiDay = Boolean(endDate && endDate !== startDate);

  return (
    <article className={`ev-card ${featured ? "featured" : ""} ${past ? "past" : ""}`}>
      <div className="ev-card-head">
        <div className="ev-card-keys">
          {ev.series && <span className="ev-series">{ev.series}</span>}
          <span className={`ev-state ${past ? "past" : ""}`}>
            <span className="d" />
            {past ? "Past" : "Upcoming"}
          </span>
        </div>
        {ev.hostLogo && (
          <Image
            className="ev-host-logo"
            src={ev.hostLogo}
            alt={ev.host}
            width={440}
            height={220}
          />
        )}
      </div>

      <h2 className={featured ? "ev-title-lg" : "ev-title"}>{ev.title}</h2>
      {ev.summary && <p className="ev-summary">{ev.summary}</p>}

      <dl className="ev-facts">
        <div>
          <dt>Date</dt>
          <dd>{multiDay ? `${startDate} – ${endDate}` : startDate}</dd>
        </div>
        {!multiDay && (
          <div>
            <dt>Time</dt>
            <dd>{fmtEventTimeRange(ev)}</dd>
          </div>
        )}
        <div>
          <dt>Format</dt>
          <dd>
            {FORMAT_LABELS[ev.format]}
            {ev.location ? ` · ${ev.location}` : ""}
          </dd>
        </div>
        <div>
          <dt>Hosted by</dt>
          <dd>
            {ev.hostUrl ? (
              <a href={ev.hostUrl} target="_blank" rel="noopener noreferrer">
                {ev.host}
              </a>
            ) : (
              ev.host
            )}
          </dd>
        </div>
      </dl>

      {ev.talks.length > 0 && (
        <div className="ev-agenda">
          <h3 className="ev-agenda-h">Featured presentations</h3>
          <ol className="ev-talks">
            {ev.talks.map((t, i) => (
              <li key={t.presenter + i}>
                <span className="ev-talk-n">{i + 1}</span>
                <div>
                  <p className="ev-talk-title">{t.title}</p>
                  <p className="ev-talk-by">
                    {t.presenter}
                    {t.institution ? ` · ${t.institution}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!past && ev.registration === "email" && (
        <div className="ev-cta">
          <EventRegisterForm slug={ev.slug} note={ev.registrationNote} />
        </div>
      )}

      {!past && ev.registration === "external" && ev.registrationUrl && (
        <div className="ev-cta ev-cta-row">
          <a
            className="btn-primary"
            href={ev.registrationUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Registration &amp; membership
          </a>
          {ev.registrationNote && <p className="ev-cta-note">{ev.registrationNote}</p>}
        </div>
      )}

      {!past && ev.registration === "none" && (
        <p className="ev-cta ev-cta-note">
          {ev.registrationNote ??
            "The join link is announced by email to the MNM mailing list — register for the next lecture above and you'll get this one too."}
        </p>
      )}
    </article>
  );
}

export default function EventsView({ events }: { events: PublicEvent[] }) {
  const mainRef = useScrollReveal();

  const sorted = [...events].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );
  const upcoming = sorted.filter((e) => !isPastEvent(e));
  const past = sorted.filter(isPastEvent).reverse();
  const [featured, ...restUpcoming] = upcoming;

  return (
    <main ref={mainRef}>
      {/* ── Series hero ── */}
      <section className="ev-hero">
        <div className="home-container">
          <div className="ev-hero-grid">
            <div>
              <span className="section-eyebrow">{lectureSeries.name}</span>
              <h1 className="ev-hero-h1">{lectureSeries.title}</h1>
              <p className="ev-hero-sub">{lectureSeries.description}</p>
              <p className="ev-hero-chairs">
                Co-chaired by{" "}
                {lectureSeries.chairs.map((c, i) => (
                  <span key={c.name}>
                    {i > 0 && " and "}
                    <strong>{c.name}</strong> ({c.institution})
                  </span>
                ))}{" "}
                on behalf of the PNCRG Multimodal Neuromonitoring Subgroup.
              </p>
              <a
                className="ev-hero-host"
                href={lectureSeries.hostUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn more about PNCRG
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3h8v8M13 3L3 13" />
                </svg>
              </a>
            </div>
            <a
              className="ev-hero-logo"
              href={lectureSeries.hostUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Pediatric Neurocritical Care Research Group"
            >
              <Image
                src={lectureSeries.logo}
                alt="Pediatric Neurocritical Care Research Group"
                width={720}
                height={284}
                priority
              />
            </a>
          </div>
        </div>
      </section>

      {/* ── Next up ── */}
      {featured && (
        <section className="home-section reveal" style={{ paddingBottom: 0 }}>
          <div className="home-container">
            <div className="section-head">
              <span className="section-eyebrow">Next up</span>
              <h2 className="section-h2">Register for the next lecture.</h2>
            </div>
            <EventCard ev={featured} featured />
          </div>
        </section>
      )}

      {/* ── Also coming up ── */}
      {restUpcoming.length > 0 && (
        <section className="home-section reveal">
          <div className="home-container">
            <div className="section-head">
              <span className="section-eyebrow">Also coming up</span>
              <h2 className="section-h2">Save the dates.</h2>
            </div>
            <div className="ev-grid">
              {restUpcoming.map((ev) => (
                <EventCard key={ev.id} ev={ev} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Past lectures ── */}
      {past.length > 0 && (
        <section className="home-section reveal" style={{ paddingTop: 0 }}>
          <div className="home-container">
            <div className="section-head">
              <span className="section-eyebrow">Archive</span>
              <h2 className="section-h2">Earlier in the series.</h2>
              <p className="section-sub">
                Recordings are shared with the MNM working group as they become
                available.
              </p>
            </div>
            <div className="ev-grid">
              {past.map((ev) => (
                <EventCard key={ev.id} ev={ev} />
              ))}
            </div>
          </div>
        </section>
      )}

      {events.length === 0 && (
        <section className="home-section">
          <div className="home-container">
            <p className="ev-empty">
              No events are posted right now — check back soon.
            </p>
          </div>
        </section>
      )}

      {/* ── Get involved ── */}
      <section className="home-section reveal" style={{ paddingTop: 0 }}>
        <div className="home-container">
          <div className="ev-involve">
            <h3>Want to help shape the consensus?</h3>
            <p>
              The series feeds a hybrid workshop at the Fall 2026 PNCRG meeting
              and a peer-reviewed consensus paper on practical EEG
              implementation. Member centers can join the working group.
            </p>
            <div className="section-cta">
              <Link href="/join" className="btn-primary">
                Join the consortium
              </Link>
              <Link href="/contact" className="btn-secondary">
                Contact the co-chairs
              </Link>
            </div>
          </div>
        </div>
      </section>

      <style>{`
        /* ── Events page (page-specific; shared classes in globals.css) ── */
        .ev-hero {
          padding: clamp(5rem, 10vw, 7.5rem) 2rem clamp(2rem, 4vw, 3rem);
          background: var(--bg);
        }
        .ev-hero-grid {
          display: grid; grid-template-columns: minmax(0, 1fr) 400px;
          gap: 2.5rem; align-items: start;
          max-width: 1200px; margin: 0 auto;
        }
        .ev-hero-h1 {
          font-family: var(--heading-font);
          font-size: clamp(1.9rem, 4.2vw, 3rem);
          font-weight: 700; line-height: 1.08; letter-spacing: -0.02em;
          color: var(--ink); margin: 0.9rem 0 0; max-width: 24ch; text-wrap: balance;
        }
        .ev-hero-sub {
          margin-top: 1.1rem; font-size: clamp(1rem, 1.9vw, 1.15rem); line-height: 1.65;
          color: var(--ink-2); max-width: 62ch;
        }
        .ev-hero-chairs {
          margin-top: 1.1rem; font-size: 0.92rem; line-height: 1.6; color: var(--muted);
          max-width: 62ch;
        }
        .ev-hero-chairs strong { color: var(--ink-2); font-weight: 600; }
        .ev-hero-host {
          display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 1.25rem;
          font-size: 0.88rem; font-weight: 600; color: var(--accent);
        }
        .ev-hero-logo {
          display: block; background: #fff; border-radius: 16px;
          padding: 1.75rem 1.5rem; border: 1px solid var(--line);
        }
        .ev-hero-logo img { width: 100%; height: auto; }

        /* Event cards */
        .ev-grid { display: grid; gap: 1.15rem; }
        .ev-card {
          background: var(--surface); border: 1px solid var(--line);
          border-radius: 18px; padding: clamp(1.35rem, 3vw, 2rem);
        }
        .ev-card.featured { border-color: var(--accent); }
        .ev-card.past { opacity: 0.86; }
        .ev-card-head {
          display: flex; justify-content: space-between; align-items: flex-start;
          gap: 1.25rem; margin-bottom: 1rem;
        }
        .ev-card-keys { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
        .ev-series {
          font-family: var(--mono-font); font-size: 0.68rem; font-weight: 600;
          letter-spacing: 0.1em; text-transform: uppercase;
          padding: 4px 10px; border-radius: 6px;
          background: var(--accent-soft); color: var(--accent);
        }
        .ev-state {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--mono-font); font-size: 0.7rem; color: var(--good);
        }
        .ev-state .d { width: 7px; height: 7px; border-radius: 50%; background: var(--good); }
        .ev-state.past { color: var(--muted); }
        .ev-state.past .d { background: var(--muted); }
        .ev-host-logo {
          /* max-height + contain keeps the wide PNCRG wordmark and the square
             Seattle seal at comparable visual weight. */
          width: 210px; height: auto; max-height: 116px; object-fit: contain;
          flex-shrink: 0;
          background: #fff; border-radius: 12px; padding: 0.6rem 0.75rem;
        }
        .ev-title-lg {
          font-family: var(--heading-font); font-size: clamp(1.5rem, 3.2vw, 2.1rem);
          font-weight: 700; line-height: 1.15; letter-spacing: -0.01em;
          color: var(--ink); max-width: 30ch; text-wrap: balance;
        }
        .ev-title {
          font-family: var(--heading-font); font-size: 1.3rem; font-weight: 600;
          line-height: 1.25; color: var(--ink); max-width: 34ch;
        }
        .ev-summary {
          margin-top: 0.8rem; font-size: 0.97rem; line-height: 1.65;
          color: var(--ink-2); max-width: 68ch;
        }

        /* Fact strip */
        .ev-facts {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1rem 1.5rem; margin: 1.5rem 0;
          padding: 1.15rem 1.25rem; border: 1px solid var(--line);
          border-radius: 14px; background: var(--surface-2);
        }
        .ev-facts dt {
          font-family: var(--mono-font); font-size: 0.66rem; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--muted);
        }
        .ev-facts dd {
          margin-top: 0.3rem; font-size: 0.94rem; font-weight: 600; color: var(--ink);
          line-height: 1.45;
        }
        .ev-facts dd a { color: var(--accent); font-weight: 600; }

        /* Agenda */
        .ev-agenda-h {
          font-family: var(--mono-font); font-size: 0.7rem; font-weight: 600;
          letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent);
          margin-bottom: 0.9rem;
        }
        .ev-talks { list-style: none; display: grid; gap: 0.85rem; }
        .ev-talks li { display: flex; gap: 0.85rem; align-items: flex-start; }
        .ev-talk-n {
          flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          font-family: var(--mono-font); font-size: 0.72rem; font-weight: 600;
          background: var(--accent-soft); color: var(--accent);
        }
        .ev-talk-title {
          font-size: 0.95rem; font-weight: 600; line-height: 1.45; color: var(--ink);
        }
        .ev-talk-by { margin-top: 0.2rem; font-size: 0.85rem; color: var(--muted); }

        /* CTA area */
        .ev-cta { margin-top: 1.75rem; }
        .ev-cta-row { display: flex; align-items: center; gap: 1.1rem; flex-wrap: wrap; }
        .ev-cta-note { font-size: 0.88rem; line-height: 1.55; color: var(--muted); max-width: 56ch; }
        .ev-empty {
          text-align: center; color: var(--muted); padding: 3rem 0;
          font-family: var(--mono-font); font-size: 0.88rem;
        }

        /* Get involved */
        .ev-involve {
          border: 1px solid var(--line); border-radius: 16px;
          padding: clamp(1.5rem, 3vw, 2.25rem); background: var(--surface);
        }
        .ev-involve h3 {
          font-family: var(--heading-font); font-size: 1.35rem; font-weight: 700;
          color: var(--ink); margin-bottom: 0.6rem;
        }
        .ev-involve p {
          font-size: 0.97rem; line-height: 1.65; color: var(--ink-2); max-width: 64ch;
        }

        @media (max-width: 900px) {
          .ev-hero-grid { grid-template-columns: 1fr; }
          .ev-hero-logo { max-width: 400px; }
        }
        @media (max-width: 600px) {
          .ev-card-head { flex-direction: column-reverse; align-items: flex-start; }
        }
      `}</style>
    </main>
  );
}
