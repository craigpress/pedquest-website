import { notFound } from "next/navigation";
import Link from "next/link";
import { members } from "@/data/members";
import { publications } from "@/data/publications";
import { conferenceAbstracts } from "@/data/abstracts";
import MemberAvatar from "@/components/MemberAvatar";

export function generateStaticParams() {
  return members.map((m) => ({ id: m.id }));
}

export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = members.find((m) => m.id === id);
  if (!member) notFound();

  const memberPubs = publications.filter((p) => p.memberAuthorIds.includes(id));
  const memberAbstracts = conferenceAbstracts.filter((a) => a.memberAuthorIds.includes(id));

  return (
    <main style={{ maxWidth: "800px", margin: "0 auto", padding: "3rem 1.5rem" }}>
      {/* Back link */}
      <Link
        href="/members"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          fontSize: "0.9rem",
          color: "var(--accent-primary)",
          marginBottom: "2rem",
        }}
      >
        &larr; Back to Members
      </Link>

      {/* Profile header */}
      <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start", marginBottom: "2rem", flexWrap: "wrap" }}>
        <MemberAvatar
          name={member.name}
          size="xl"
          photoUrl={member.photoUrl}
        />
        <div>
          <h1 style={{ fontFamily: "var(--heading-font)", fontSize: "2rem", marginBottom: "0.25rem" }}>
            {member.name}, {member.title}
          </h1>
          {member.role && (
            <p style={{ fontSize: "0.95rem", color: "var(--accent-primary)", fontWeight: 600, marginBottom: "0.35rem" }}>
              {member.role}
            </p>
          )}
          <p style={{ color: "var(--text-secondary)", fontSize: "1rem", marginBottom: "0.25rem" }}>
            {member.department ? `${member.department}, ` : ""}
            {member.institution}
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
            {member.city}, {member.country}
          </p>
        </div>
      </div>

      {/* Bio */}
      <section className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.2rem", marginBottom: "0.75rem" }}>About</h2>
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>{member.bio}</p>
      </section>

      {/* Interests */}
      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.2rem", marginBottom: "0.75rem" }}>
          Research Interests
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {member.interests.map((interest) => (
            <span key={interest} className="badge badge-member">
              {interest}
            </span>
          ))}
        </div>
      </section>

      {/* ORCID */}
      {member.orcidId && (
        <section style={{ marginBottom: "1.5rem" }}>
          <a
            href={`https://orcid.org/${member.orcidId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.9rem",
              color: "var(--accent-primary)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor">
              <path d="M128 0C57.3 0 0 57.3 0 128s57.3 128 128 128 128-57.3 128-128S198.7 0 128 0zM86.3 186.2H70.2V79.5h16.1v106.7zM78.2 70.6c-5.7 0-10.3-4.6-10.3-10.3s4.6-10.3 10.3-10.3 10.3 4.6 10.3 10.3-4.6 10.3-10.3 10.3zM185.5 186.2h-16.1v-55.8c0-15.8-5.6-23.7-18.3-23.7-14 0-21.2 9.5-21.2 23.3v56.2h-16.1V79.5h15.5v14.4c5.3-9.2 15.2-17.1 30.1-17.1 22.3 0 26.1 15.2 26.1 35.1v74.3z" />
            </svg>
            ORCID: {member.orcidId}
          </a>
        </section>
      )}

      {/* Contact links */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "2.5rem" }}>
        {member.email && (
          <a href={`mailto:${member.email}`} className="btn-secondary" style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}>
            Email
          </a>
        )}
        {member.websiteUrl && (
          <a href={member.websiteUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}>
            Website
          </a>
        )}
      </div>

      {/* Publications by this member */}
      {memberPubs.length > 0 && (
        <section>
          <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.2rem", marginBottom: "1rem" }}>
            Publications
            <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "var(--text-muted)", marginLeft: "0.5rem" }}>
              ({memberPubs.length})
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {memberPubs.map((pub) => (
              <article key={pub.id} className="card" style={{ padding: "1.5rem" }}>
                <h3 style={{ fontSize: "1rem", fontFamily: "var(--heading-font)", lineHeight: 1.4, marginBottom: "0.5rem" }}>
                  {pub.title}
                </h3>
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.5rem", lineHeight: 1.5 }}>
                  {pub.authors.join(", ")}
                </p>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  <em>{pub.journal}</em> ({pub.year})
                  {pub.doi && (
                    <>
                      {" "}&middot;{" "}
                      <a href={`https://doi.org/${pub.doi}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-primary)" }}>
                        DOI &rarr;
                      </a>
                    </>
                  )}
                  {pub.pmid && (
                    <>
                      {" "}&middot;{" "}
                      <a href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-primary)" }}>
                        PubMed
                      </a>
                    </>
                  )}
                </p>
                {pub.categories.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                    {pub.categories.map((cat) => (
                      <span key={cat} className="badge" style={{ background: "var(--border)", color: "var(--text-secondary)", fontSize: "0.7rem" }}>
                        {cat}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Conference Abstracts */}
      {memberAbstracts.length > 0 && (
        <section style={{ marginTop: "2.5rem" }}>
          <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.2rem", marginBottom: "1rem" }}>
            Conference Abstracts
            <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "var(--text-muted)", marginLeft: "0.5rem" }}>
              ({memberAbstracts.length})
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {memberAbstracts.map((abs) => (
              <article key={abs.id} className="card" style={{ padding: "1.5rem" }}>
                <h3 style={{ fontFamily: "var(--heading-font)", fontWeight: 600, fontSize: "0.95rem", lineHeight: 1.4, marginBottom: "0.5rem" }}>
                  {abs.title}
                </h3>
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.5rem", lineHeight: 1.5 }}>
                  {abs.authors.join(", ")}
                </p>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  <em>{abs.conference}</em> ({abs.year}) &middot; {abs.presentationType}
                </p>
                {abs.categories.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                    {abs.categories.map((cat) => (
                      <span key={cat} className="badge" style={{ background: "var(--border)", color: "var(--text-secondary)", fontSize: "0.7rem" }}>
                        {cat}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
