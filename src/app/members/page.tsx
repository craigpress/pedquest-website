"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { members, institutions } from "@/data/members";
import MemberAvatar from "@/components/MemberAvatar";

const MemberMap = dynamic(() => import("@/components/MemberMap"), {
  ssr: false,
  loading: () => (
    <div className="skeleton" style={{ height: "450px", width: "100%", borderRadius: "16px" }} />
  ),
});

export default function MembersPage() {
  const [search, setSearch] = useState("");
  const [filterInstitution, setFilterInstitution] = useState("");
  const [filterCountry, setFilterCountry] = useState("");

  const uniqueInstitutions = useMemo(
    () => [...new Set(members.map((m) => m.institution))].sort(),
    []
  );
  const uniqueCountries = useMemo(
    () => [...new Set(members.map((m) => m.country))].sort(),
    []
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return members
      .filter((m) => {
        if (q && !m.name.toLowerCase().includes(q) && !m.institution.toLowerCase().includes(q) && !m.interests.some((i) => i.toLowerCase().includes(q))) return false;
        if (filterInstitution && m.institution !== filterInstitution) return false;
        if (filterCountry && m.country !== filterCountry) return false;
        return true;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [search, filterInstitution, filterCountry]);

  return (
    <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "3rem 1.5rem" }}>
      {/* Header */}
      <header style={{ marginBottom: "2.5rem" }}>
        <h1 className="section-heading">Our Members</h1>
        <p className="section-subheading">
          PedQuEST spans <strong>{institutions.length} institutions</strong> across{" "}
          <strong>{uniqueCountries.length} countries</strong>, uniting researchers and clinicians in
          advancing pediatric quantitative EEG science.
        </p>
      </header>

      {/* Search / Filter Bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "2rem",
        }}
      >
        <input
          type="text"
          placeholder="Search members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: "1 1 240px",
            padding: "0.6rem 1rem",
            borderRadius: "8px",
            border: "1px solid var(--border-strong)",
            background: "var(--bg-card)",
            color: "var(--text)",
            fontFamily: "var(--body-font)",
            fontSize: "0.9rem",
            outline: "none",
          }}
        />
        <select
          value={filterInstitution}
          onChange={(e) => setFilterInstitution(e.target.value)}
          style={{
            flex: "0 1 260px",
            padding: "0.6rem 1rem",
            borderRadius: "8px",
            border: "1px solid var(--border-strong)",
            background: "var(--bg-card)",
            color: "var(--text)",
            fontFamily: "var(--body-font)",
            fontSize: "0.9rem",
          }}
        >
          <option value="">All Institutions</option>
          {uniqueInstitutions.map((inst) => (
            <option key={inst} value={inst}>{inst}</option>
          ))}
        </select>
        <select
          value={filterCountry}
          onChange={(e) => setFilterCountry(e.target.value)}
          style={{
            flex: "0 1 160px",
            padding: "0.6rem 1rem",
            borderRadius: "8px",
            border: "1px solid var(--border-strong)",
            background: "var(--bg-card)",
            color: "var(--text)",
            fontFamily: "var(--body-font)",
            fontSize: "0.9rem",
          }}
        >
          <option value="">All Countries</option>
          {uniqueCountries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Map */}
      <section style={{ marginBottom: "3rem" }}>
        <MemberMap />
      </section>

      {/* Member Grid */}
      <section>
        <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.5rem", marginBottom: "1.25rem" }}>
          Members ({filtered.length})
        </h2>
        {filtered.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "3rem 0" }}>
            No members match your search or filters.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "1.25rem",
            }}
          >
            {filtered.map((member) => (
              <Link
                key={member.id}
                href={`/members/${member.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="card" style={{ padding: "1.5rem", height: "100%", cursor: "pointer" }}>
                  <div style={{ marginBottom: "1rem" }}>
                    <MemberAvatar
                      name={member.name}
                      size="lg"
                      photoUrl={member.photoUrl}
                    />
                  </div>
                  <h3 style={{ fontSize: "1.05rem", fontFamily: "var(--heading-font)", marginBottom: "0.25rem" }}>
                    {member.name}, {member.title}
                  </h3>
                  {member.role && (
                    <p style={{ fontSize: "0.8rem", color: "var(--accent-primary)", fontWeight: 600, marginBottom: "0.25rem" }}>
                      {member.role}
                    </p>
                  )}
                  <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
                    {member.institution}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                    {member.interests.slice(0, 3).map((interest) => (
                      <span key={interest} className="badge badge-member">
                        {interest}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
