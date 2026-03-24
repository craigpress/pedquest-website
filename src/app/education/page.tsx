"use client";

import { useState } from "react";
import { educationResources, type EducationResource } from "@/data/education";

const audienceFilters = ["All", "Trainees", "Technicians", "Intensivists", "Neurology"];

function statusColor(status: EducationResource["status"]): string {
  switch (status) {
    case "active":
      return "var(--accent-tertiary)";
    case "in_progress":
      return "var(--accent-secondary)";
    case "planned":
    case "archived":
    default:
      return "var(--text-muted)";
  }
}

function statusLabel(status: EducationResource["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "in_progress":
      return "In Progress";
    case "planned":
      return "Planned";
    case "archived":
      return "Archived";
  }
}

export default function EducationPage() {
  const [activeFilter, setActiveFilter] = useState("All");

  const filtered =
    activeFilter === "All"
      ? educationResources
      : educationResources.filter((r) =>
          r.audience.includes(activeFilter.toLowerCase())
        );

  const pennsieve = educationResources.find((r) => r.id === "edu-4");

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "3rem 1.5rem 4rem",
      }}
    >
      {/* Page Header */}
      <section style={{ marginBottom: "3rem" }}>
        <h1
          className="section-heading"
          style={{
            fontFamily: "var(--heading-font)",
            fontSize: "2.75rem",
            marginBottom: "0.75rem",
          }}
        >
          Education
        </h1>
        <p
          className="section-subheading"
          style={{ maxWidth: 720, lineHeight: 1.7 }}
        >
          PedQuEST's education initiative is developing a standardized qEEG
          curriculum to ensure consistent, high-quality training across all
          consortium centers. Our resources span from bedside decision-support
          tools to comprehensive case-based training modules.
        </p>
      </section>

      {/* Audience Filter */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          {audienceFilters.map((filter) => {
            const isActive = activeFilter === filter;
            return (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: 9999,
                  border: isActive
                    ? "1.5px solid var(--accent-primary)"
                    : "1.5px solid var(--border-strong)",
                  background: isActive
                    ? "var(--accent-primary)"
                    : "var(--bg-card)",
                  color: isActive ? "#fff" : "var(--text-secondary)",
                  fontFamily: "var(--body-font)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {filter}
              </button>
            );
          })}
        </div>
      </section>

      {/* Project Showcase */}
      <section style={{ marginBottom: "4rem" }}>
        <h2
          style={{
            fontFamily: "var(--heading-font)",
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "var(--text)",
            marginBottom: "1.5rem",
          }}
        >
          Projects &amp; Resources
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: "1.5rem",
          }}
        >
          {filtered
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((resource) => (
              <article
                key={resource.id}
                className="card"
                style={{ padding: "1.75rem", display: "flex", flexDirection: "column", gap: "1rem" }}
              >
                {/* Title + Status */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "0.75rem",
                  }}
                >
                  <h3
                    style={{
                      fontFamily: "var(--heading-font)",
                      fontSize: "1.15rem",
                      fontWeight: 700,
                      color: "var(--text)",
                      lineHeight: 1.3,
                      flex: 1,
                    }}
                  >
                    {resource.title}
                  </h3>
                  <span
                    className="badge"
                    style={{
                      background: `${statusColor(resource.status)}18`,
                      color: statusColor(resource.status),
                      flexShrink: 0,
                    }}
                  >
                    {statusLabel(resource.status)}
                  </span>
                </div>

                {/* Description */}
                <p
                  style={{
                    fontSize: "0.9rem",
                    lineHeight: 1.65,
                    color: "var(--text-secondary)",
                    flex: 1,
                  }}
                >
                  {resource.description}
                </p>

                {/* Leadership */}
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  <strong style={{ color: "var(--text-secondary)" }}>Led by:</strong>{" "}
                  {resource.leadership}
                </div>

                {/* Tags */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                  {resource.audience.map((a) => (
                    <span
                      key={a}
                      className="badge"
                      style={{
                        background: "var(--member-badge-bg)",
                        color: "var(--member-badge-text)",
                        fontSize: "0.7rem",
                        textTransform: "capitalize",
                      }}
                    >
                      {a}
                    </span>
                  ))}
                  {resource.topics.map((t) => (
                    <span
                      key={t}
                      className="badge"
                      style={{
                        background: "var(--bg-card-hover)",
                        color: "var(--text-secondary)",
                        fontSize: "0.7rem",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>

                {/* External link */}
                {resource.url && (
                  <a
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary"
                    style={{
                      alignSelf: "flex-start",
                      padding: "0.5rem 1.25rem",
                      fontSize: "0.8rem",
                      marginTop: "0.25rem",
                    }}
                  >
                    Visit Platform &rarr;
                  </a>
                )}
              </article>
            ))}
        </div>

        {filtered.length === 0 && (
          <p
            style={{
              textAlign: "center",
              color: "var(--text-muted)",
              padding: "3rem 0",
              fontSize: "0.95rem",
            }}
          >
            No resources match the selected audience filter.
          </p>
        )}
      </section>

      {/* Pennsieve Highlight */}
      {pennsieve && (
        <section
          className="card"
          style={{
            padding: "2.5rem",
            background: "var(--bg-card)",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "var(--accent-tertiary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: "1.1rem",
                fontWeight: 700,
                fontFamily: "var(--heading-font)",
                flexShrink: 0,
              }}
            >
              P
            </div>
            <h2
              style={{
                fontFamily: "var(--heading-font)",
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              Pennsieve Data Platform
            </h2>
          </div>
          <p
            style={{
              fontSize: "1rem",
              lineHeight: 1.7,
              color: "var(--text-secondary)",
              maxWidth: 720,
            }}
          >
            Our consortium uses the Pennsieve platform for secure, cloud-based EEG
            waveform data sharing aligned with clinical data. Built in collaboration
            with the Wagenaar Lab at the University of Pennsylvania, Pennsieve
            provides the research infrastructure underpinning our multi-center
            studies.
          </p>
          <a
            href="https://pennsieve.io"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            style={{ alignSelf: "flex-start" }}
          >
            Explore Pennsieve &rarr;
          </a>
        </section>
      )}
    </main>
  );
}
