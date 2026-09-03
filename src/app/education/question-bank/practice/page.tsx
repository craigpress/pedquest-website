"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import CaseQuiz from "@/components/CaseQuiz";
import SignedInGate from "@/components/SignedInGate";
import { getSupabase } from "@/lib/supabase";
import {
  DIFFICULTIES, QBANK_DOMAINS, QBANK_DOMAIN_LABELS,
  type PublicCase, type QbankDomain,
} from "@/lib/cases";

const wrap: React.CSSProperties = { maxWidth: 860, margin: "0 auto", padding: "3rem 1.5rem 5rem" };

export default function PracticePage() {
  return (
    <div style={wrap}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: "var(--mono-font)", fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--accent-primary)", fontWeight: 600 }}>
          qEEG question bank · practice
        </div>
        <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: "56ch", lineHeight: 1.6 }}>
          One unanswered question at a time, drawn at random from the published bank.
        </p>
      </div>
      <SignedInGate
        title="Sign in to practise"
        message="Practice mode serves questions you have not answered yet, so it needs to know who you are."
      >
        <PracticeRunner />
      </SignedInGate>
      <div style={{ marginTop: 30, fontFamily: "var(--mono-font)", fontSize: 13 }}>
        <Link href="/education/question-bank">← Browse all questions</Link>
      </div>
    </div>
  );
}

function PracticeRunner() {
  const [item, setItem] = useState<PublicCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [domain, setDomain] = useState("");
  const [difficulty, setDifficulty] = useState("");

  const next = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExhausted(false);
    try {
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
      const p = new URLSearchParams();
      if (domain) p.set("domain", domain);
      if (difficulty) p.set("difficulty", difficulty);
      const res = await fetch(`/api/qbank/practice?${p.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Could not load a question."); setItem(null); return; }
      if (json.exhausted || !json.item) { setExhausted(true); setItem(null); return; }
      setItem(json.item as PublicCase);
    } catch {
      setError("Network error loading a question.");
    } finally {
      setLoading(false);
    }
  }, [domain, difficulty]);

  useEffect(() => { void next(); }, [next]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
        <select
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          aria-label="Domain"
          style={{ padding: "0.5rem 0.7rem", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", font: "inherit", fontSize: "0.87rem" }}
        >
          <option value="">All domains</option>
          {QBANK_DOMAINS.map((d) => (
            <option key={d} value={d}>{QBANK_DOMAIN_LABELS[d as QbankDomain]}</option>
          ))}
        </select>
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          aria-label="Difficulty"
          style={{ padding: "0.5rem 0.7rem", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", font: "inherit", fontSize: "0.87rem" }}
        >
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {answeredCount > 0 && (
          <span style={{ fontFamily: "var(--mono-font)", fontSize: 12, color: "var(--text-muted)" }}>
            {answeredCount} answered this session
          </span>
        )}
      </div>

      {error && <p role="alert" style={{ color: "var(--accent-secondary)", fontSize: 14 }}>{error}</p>}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Picking a question…</p>
      ) : exhausted ? (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: "2rem", textAlign: "center" }}>
          <p style={{ color: "var(--text)", margin: 0, fontSize: "1.05rem" }}>
            You have answered every published item that matches these filters.
          </p>
          <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
            Widen the filters, or <Link href="/education/question-bank">browse the bank</Link> to revisit
            an item and re-read its explanation.
          </p>
        </div>
      ) : item ? (
        <article key={item.id}>
          <h1 style={{ fontFamily: "var(--heading-font)", fontSize: "clamp(1.5rem,3.6vw,2rem)", lineHeight: 1.15, color: "var(--text)", margin: "0 0 20px" }}>
            {item.title}
          </h1>
          <CaseQuiz
            caseData={item}
            onNext={() => { setAnsweredCount((n) => n + 1); void next(); }}
          />
        </article>
      ) : null}
    </div>
  );
}
