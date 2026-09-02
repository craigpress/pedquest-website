import { Metadata } from "next";
import Link from "next/link";
import RevealMain from "@/components/RevealMain";

export const metadata: Metadata = {
  title: "Privacy Notice — PedQuEST",
  description:
    "What PedQuEST collects, why, how long we keep it, and how to have it removed. We use no advertising or tracking cookies and do not sell personal information.",
  alternates: { canonical: "/privacy" },
};

const LAST_UPDATED = "2 September 2026";

export default function PrivacyPage() {
  return (
    <RevealMain>
      <section className="pv-hero">
        <div className="home-container">
          <span className="section-eyebrow">Legal</span>
          <h1 className="pv-h1">Privacy Notice</h1>
          <p className="pv-sub">
            PedQuEST is a research and education consortium, not a commercial
            service. We collect the minimum needed to run this site, we do not
            sell or share personal information, and we set no advertising or
            tracking cookies.
          </p>
          <p className="pv-updated">Last updated {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="home-section reveal">
        <div className="home-container">
          <div className="pv-prose">
            <h2>Who is responsible</h2>
            <p>
              The Pediatric Quantitative EEG Strategic Taskforce (PedQuEST) is the
              controller of the personal data described here. For any privacy
              question or request, use our{" "}
              <Link href="/contact">contact form</Link> and choose
              &ldquo;General Inquiry&rdquo; — it reaches the consortium
              administrators directly.
            </p>

            <h2>What we collect, and why</h2>
            <p>
              We only collect information you type into a form. There is no
              profiling, no advertising, and no data broker anywhere in this site.
            </p>

            <div className="pv-table-wrap">
              <table className="pv-table">
                <thead>
                  <tr>
                    <th>Where</th>
                    <th>What</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Event registration</td>
                    <td>Email; name and institution if you choose to give them</td>
                    <td>
                      To send you the join link and to know who attended a
                      consortium event
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Link href="/join/individual">Individual signup</Link>
                    </td>
                    <td>
                      Name, email, and optionally institution, country, role and
                      research interests
                    </td>
                    <td>
                      To send you meeting invitations and consortium news, which
                      you opt into and can leave at any time
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Link href="/join/site">Member site application</Link>
                    </td>
                    <td>
                      Name, email, phone, hospital, university, role, research
                      interests, statement of interest
                    </td>
                    <td>To review your application to join the consortium</td>
                  </tr>
                  <tr>
                    <td>
                      <Link href="/contact">Contact form</Link>
                    </td>
                    <td>Name, email, subject, message</td>
                    <td>To answer you</td>
                  </tr>
                  <tr>
                    <td>
                      <Link href="/sponsor">Sponsor enquiry</Link>
                    </td>
                    <td>Name, email, organisation, message</td>
                    <td>To respond to a funding or partnership enquiry</td>
                  </tr>
                  <tr>
                    <td>Member login</td>
                    <td>
                      Email address, and the profile details you enter yourself
                    </td>
                    <td>To authenticate you and show your member profile</td>
                  </tr>
                  <tr>
                    <td>EEG Case of the Day</td>
                    <td>
                      Your answer, plus a random browser session ID. Your email is
                      attached only if you are signed in.
                    </td>
                    <td>
                      To show you the correct answer, stop double-counting, and
                      report aggregate response statistics
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="pv-callout">
              <strong>We do not store your IP address.</strong> Your IP is held in
              memory for a few minutes purely to rate-limit form spam, and is never
              written to our database.
            </p>

            <h2>Cookies and browser storage</h2>
            <p>
              Every item below is strictly necessary to operate the site. None of it
              tracks you across websites,
              and none of it profiles you — which is why this site does not ask you
              to accept cookies.
            </p>

            <div className="pv-table-wrap">
              <table className="pv-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>auth_state</code>, <code>auth_nonce</code>
                    </td>
                    <td>Cookie, deleted at the end of login</td>
                    <td>
                      Protects the sign-in exchange against cross-site request
                      forgery
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>auth_token_hash</code>
                    </td>
                    <td>Cookie</td>
                    <td>Keeps you signed in</td>
                  </tr>
                  <tr>
                    <td>
                      <code>pedquest_user_email</code>
                    </td>
                    <td>Local storage</td>
                    <td>Keeps you signed in when the session service is offline</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h2>Analytics</h2>
            <p>
              We use Vercel Web Analytics to count page views. It is cookieless: it
              sets nothing on your device, assigns you no persistent identifier,
              and cannot follow you to other sites. We see aggregate page and
              country totals, never individual visitors.
            </p>

            <h2>Who else sees this data</h2>
            <p>
              We share nothing for marketing and we never sell personal
              information. Data is processed on our behalf only by the services
              that run the site: Vercel (hosting), Supabase (database), Resend
              (sending you email), and our own single-sign-on service for member
              login. Form submissions also raise an internal notification to the
              PedQuEST administrators.
            </p>

            <h2>How long we keep it</h2>
            <p>
              Membership applications and member profiles are kept for as long as
              you are involved with the consortium. Contact and sponsor messages
              are kept for up to two years. Event registrations are kept for up to
              two years so we can report attendance. Ask us and we will delete any
              of it sooner.
            </p>

            <h2>Your rights</h2>
            <p>
              Wherever you live, you can ask us for a copy of what we hold about
              you, ask us to correct it, or ask us to delete it — send the
              request through our <Link href="/contact">contact form</Link> and
              we will respond within 30 days. If you are in the UK, EEA, or Switzerland,
              you also have the right to object to or restrict our processing, to
              receive your data in a portable format, and to complain to your
              national data protection authority. If you are a California resident,
              note that we do not sell or share personal information and we do not
              use it for cross-context behavioural advertising, so there is nothing
              to opt out of.
            </p>
            <p>
              Our lawful basis is your consent when you submit a form, and our
              legitimate interest in running a research consortium and keeping the
              site free of spam.
            </p>

            <h2>No patient data on this site</h2>
            <p>
              PedQuEST is a research, education, and collaboration platform, not a
              source of medical advice, and this website is not a clinical system.
              Do not send us patient-identifiable information through any form
              here. EEG material shown in our educational cases is de-identified.
            </p>

            <h2>Children</h2>
            <p>
              This site is intended for clinicians and researchers. We do not
              knowingly collect personal data from anyone under 16.
            </p>

            <h2>Changes</h2>
            <p>
              If we change what we collect, we will update this page and move the
              date at the top. Material changes will be announced to members.
            </p>
          </div>
        </div>
      </section>

      <style>{`
        /* ── Privacy notice (page-specific; shared classes in globals.css) ── */
        .pv-hero {
          padding: clamp(5rem, 10vw, 8rem) 2rem clamp(2rem, 4vw, 3rem);
          background: var(--bg);
        }
        .pv-h1 {
          font-family: var(--heading-font);
          font-size: clamp(2.2rem, 4.6vw, 3.5rem);
          font-weight: 700;
          line-height: 1.08;
          letter-spacing: -0.02em;
          color: var(--ink);
          margin: 0.9rem 0 0;
        }
        .pv-sub {
          margin-top: 1.25rem;
          font-size: 1.1rem;
          line-height: 1.65;
          color: var(--ink-2);
          max-width: 62ch;
        }
        .pv-updated {
          margin-top: 1.25rem;
          font-size: 0.82rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .pv-prose { max-width: 74ch; }
        .pv-prose h2 {
          font-family: var(--heading-font);
          font-size: 1.5rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--ink);
          margin: 2.75rem 0 0.85rem;
        }
        .pv-prose h2:first-child { margin-top: 0; }
        .pv-prose p {
          font-size: 1rem;
          line-height: 1.75;
          color: var(--ink-2);
          margin: 0 0 1.1rem;
        }
        .pv-prose a { color: var(--accent); }
        .pv-prose code {
          font-family: var(--mono-font);
          font-size: 0.85em;
          color: var(--ink);
        }

        .pv-callout {
          border-left: 3px solid var(--accent);
          background: var(--bg-card);
          padding: 1rem 1.25rem;
          border-radius: 0 8px 8px 0;
        }
        .pv-callout strong { color: var(--ink); }

        .pv-table-wrap {
          overflow-x: auto;
          margin: 0 0 1.5rem;
          border: 1px solid var(--line);
          border-radius: 10px;
        }
        .pv-table {
          width: 100%;
          min-width: 34rem;
          border-collapse: collapse;
          font-size: 0.92rem;
        }
        .pv-table th {
          text-align: left;
          font-family: var(--body-font);
          font-size: 0.72rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          font-weight: 600;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--line);
          background: var(--bg-card);
        }
        .pv-table td {
          padding: 0.85rem 1rem;
          vertical-align: top;
          line-height: 1.55;
          color: var(--ink-2);
          border-bottom: 1px solid var(--line);
        }
        .pv-table tr:last-child td { border-bottom: 0; }
        .pv-table td:first-child { color: var(--ink); font-weight: 500; }
        .pv-table a { color: var(--accent); }
      `}</style>
    </RevealMain>
  );
}
