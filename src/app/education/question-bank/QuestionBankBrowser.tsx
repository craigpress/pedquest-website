"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  DIFFICULTIES, QBANK_DOMAINS, QBANK_DOMAIN_LABELS, QBANK_POPULATIONS, QBANK_SETTINGS,
} from "@/lib/cases";

interface Item {
  id: string;
  qbankId: string | null;
  title: string;
  leadIn: string | null;
  domain: string | null;
  population: string | null;
  setting: string | null;
  difficulty: string;
  questionType: string;
  imageUrl: string;
  tags: string[];
}
interface Facets {
  total: number;
  byDomain: Record<string, number>;
  byDifficulty: Record<string, number>;
  byPopulation: Record<string, number>;
  bySetting: Record<string, number>;
}
interface DomainProgress { domain: string; total: number; answered: number; correct: number }
interface Progress { total: number; answered: number; correct: number; byDomain: DomainProgress[] }

export default function QuestionBankBrowser({ initialFacets }: { initialFacets: Facets }) {
  const { user, loading: userLoading } = useUser();
  const [items, setItems] = useState<Item[]>([]);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [facets, setFacets] = useState<Facets>(initialFacets);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [domain, setDomain] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [population, setPopulation] = useState("");
  const [setting, setSetting] = useState("");
  const [hideAnswered, setHideAnswered] = useState(false);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (domain) p.set("domain", domain);
      if (difficulty) p.set("difficulty", difficulty);
      if (population) p.set("population", population);
      if (setting) p.set("setting", setting);
      const headers = await authHeaders();
      const [itemsRes, progressRes] = await Promise.all([
        fetch(`/api/qbank/items?${p.toString()}`, { headers }),
        fetch("/api/qbank/progress", { headers }),
      ]);
      const itemsJson = await itemsRes.json();
      if (itemsRes.ok && itemsJson.success) {
        setItems(itemsJson.items ?? []);
        setAnswered(new Set<string>(itemsJson.answered ?? []));
        if (itemsJson.facets) setFacets(itemsJson.facets);
      } else {
        setError(itemsJson.error || "Could not load the question bank.");
      }
      if (progressRes.ok) {
        const pj = await progressRes.json();
        if (pj.success) setProgress(pj.progress);
      }
    } catch {
      setError("Network error loading the question bank.");
    } finally {
      setLoading(false);
    }
  }, [user, domain, difficulty, population, setting, authHeaders]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => (hideAnswered ? items.filter((i) => !answered.has(i.id)) : items),
    [items, answered, hideAnswered],
  );

  if (userLoading) {
    return <p style={{ color: "var(--text-muted)", fontFamily: "var(--mono-font)", fontSize: 13 }}>Checking your session…</p>;
  }

  // The landing state for anonymous visitors: what is in the bank, and a prompt.
  if (!user) {
    return (
      <div>
        <div className="qb-facets">
          {QBANK_DOMAINS.map((d) => (
            <div className="qb-facet" key={d}>
              <span className="qb-facet-n">{facets.byDomain[d] ?? 0}</span>
              <span className="qb-facet-k">{QBANK_DOMAIN_LABELS[d]}</span>
            </div>
          ))}
        </div>
        <div className="qb-signin">
          <h2 className="qb-signin-h">Sign in to start answering</h2>
          <p className="qb-signin-p">
            {facets.total} published item{facets.total === 1 ? "" : "s"}, each with a rendered qEEG
            figure, per-option rationales and the cited evidence. Your progress is tracked by domain.
          </p>
          <div className="qb-signin-cta">
            <Link href="/login" className="btn-primary">Sign in</Link>
            <Link href="/join" className="btn-secondary">Join PedQuEST</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {progress && progress.total > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <div className="qb-eyebrow">My progress</div>
          <div className="qb-prog-top">
            <strong>{progress.answered}</strong> of {progress.total} answered
            {progress.answered > 0 && (
              <> · <strong>{Math.round((progress.correct / progress.answered) * 100)}%</strong> correct</>
            )}
          </div>
          <div className="qb-prog-list">
            {progress.byDomain.map((d) => {
              const pct = d.total ? Math.round((d.answered / d.total) * 100) : 0;
              const label = QBANK_DOMAIN_LABELS[d.domain as keyof typeof QBANK_DOMAIN_LABELS] ?? d.domain;
              return (
                <div className="qb-prog-row" key={d.domain}>
                  <span className="qb-prog-name">{label}</span>
                  <span className="qb-prog-bar" aria-hidden>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="qb-prog-num">
                    {d.answered}/{d.total}
                    {d.answered > 0 && ` · ${Math.round((d.correct / d.answered) * 100)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="qb-controls">
        <select value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain">
          <option value="">All domains</option>
          {QBANK_DOMAINS.map((d) => (
            <option key={d} value={d}>{QBANK_DOMAIN_LABELS[d]} ({facets.byDomain[d] ?? 0})</option>
          ))}
        </select>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label="Difficulty">
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>{d} ({facets.byDifficulty[d] ?? 0})</option>
          ))}
        </select>
        <select value={population} onChange={(e) => setPopulation(e.target.value)} aria-label="Population">
          <option value="">Any age</option>
          {QBANK_POPULATIONS.map((p) => (
            <option key={p} value={p}>{p} ({facets.byPopulation[p] ?? 0})</option>
          ))}
        </select>
        <select value={setting} onChange={(e) => setSetting(e.target.value)} aria-label="Setting">
          <option value="">Any setting</option>
          {QBANK_SETTINGS.map((s) => (
            <option key={s} value={s}>{s} ({facets.bySetting[s] ?? 0})</option>
          ))}
        </select>
        <label className="qb-check">
          <input type="checkbox" checked={hideAnswered} onChange={(e) => setHideAnswered(e.target.checked)} />
          Unanswered only
        </label>
        <Link href="/education/question-bank/practice" className="btn-primary qb-practice">
          Practice mode
        </Link>
      </div>

      {error && <p role="alert" style={{ color: "var(--accent-secondary)", fontSize: 14 }}>{error}</p>}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading items…</p>
      ) : visible.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>
          {items.length === 0
            ? "No published items match these filters yet."
            : "You have answered everything that matches these filters."}
        </p>
      ) : (
        <div className="qb-grid">
          {visible.map((i) => (
            <Link className="qb-card" href={`/education/question-bank/${i.id}`} key={i.id}>
              {i.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="qb-card-img" src={i.imageUrl} alt="" loading="lazy" />
              ) : (
                <div className="qb-card-img qb-card-noimg">no figure</div>
              )}
              <div className="qb-card-body">
                <div className="qb-card-meta">
                  {i.domain && <span>{QBANK_DOMAIN_LABELS[i.domain as keyof typeof QBANK_DOMAIN_LABELS] ?? i.domain}</span>}
                  <span>{i.difficulty}</span>
                  {i.population && <span>{i.population}</span>}
                  {i.setting && <span>{i.setting}</span>}
                  {answered.has(i.id) && <span className="qb-done">answered</span>}
                </div>
                <h3 className="qb-card-title">{i.title}</h3>
                {i.leadIn && <p className="qb-card-lead">{i.leadIn}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
