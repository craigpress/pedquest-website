"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { imageCreditLine, type CaseReference, type PublicCase, type RevealResult, type Region } from "@/lib/cases";

const SESSION_KEY = "pedquest_eeg_session";
function getSessionId(): string {
  try {
    let s = localStorage.getItem(SESSION_KEY);
    if (!s) {
      s = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(SESSION_KEY, s);
    }
    return s;
  } catch { return `s-${Date.now()}`; }
}
async function getAccessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try { const { data } = await sb.auth.getSession(); return data.session?.access_token ?? null; } catch { return null; }
}

export default function CaseQuiz({
  caseData,
  archived = false,
  onNext,
}: {
  caseData: PublicCase;
  archived?: boolean;
  /** practice mode: render a "next question" button after the reveal */
  onNext?: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [reveal, setReveal] = useState<RevealResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answerKey = `pedquest_eeg_answer_${caseData.id}`;

  // restore prior reveal (so a revisit shows the answer without re-submitting)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(answerKey);
      if (raw) setReveal(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [answerKey]);

  const submit = useCallback(async () => {
    setError(null);
    if (caseData.questionType === "multiple_choice" && !selected) { setError("Choose an answer first."); return; }
    if (caseData.questionType === "point_to_feature" && !point) { setError("Click a point on the tracing first."); return; }
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/cases/${caseData.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          sessionId: getSessionId(),
          selectedOptionId: selected ?? undefined,
          pointedX: point?.x, pointedY: point?.y,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setError(json.error || "Could not submit."); return; }
      setReveal(json.reveal as RevealResult);
      try { localStorage.setItem(answerKey, JSON.stringify(json.reveal)); } catch { /* ignore */ }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [caseData, selected, point, answerKey]);

  const answered = !!reveal;
  const credit = imageCreditLine(caseData);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {archived && (
        <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)", letterSpacing: ".04em" }}>
          ARCHIVED CASE{caseData.publishDate ? ` · ${caseData.publishDate}` : ""}
        </div>
      )}

      {caseData.clinicalVignette && (
        <p style={{ fontSize: "1.05rem", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
          {caseData.clinicalVignette}
        </p>
      )}

      {/* image / interactive tracing */}
      {caseData.questionType === "point_to_feature" ? (
        <PointImage
          src={caseData.imageUrl}
          alt={caseData.title}
          point={answered ? (reveal!.yourAnswer.x != null ? { x: reveal!.yourAnswer.x!, y: reveal!.yourAnswer.y! } : point) : point}
          onPick={answered ? undefined : setPoint}
          reveal={answered ? reveal! : null}
        />
      ) : (
        caseData.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={caseData.imageUrl} alt={caseData.title}
            style={{ width: "100%", borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-card)" }} />
        )
      )}

      {/* image caption + credit line (question-bank items carry both) */}
      {(caseData.imageCaption || credit) && (
        <div style={{ marginTop: -8 }}>
          {caseData.imageCaption && (
            <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55, margin: 0 }}>
              {caseData.imageCaption}
            </p>
          )}
          {credit && (
            <p style={{ fontFamily: "monospace", fontSize: 11.5, color: "var(--text-muted)", margin: "6px 0 0" }}>
              {credit}
              {caseData.imageSourceUrl && (
                <>
                  {" · "}
                  <a href={caseData.imageSourceUrl} target="_blank" rel="noopener noreferrer">source</a>
                </>
              )}
            </p>
          )}
        </div>
      )}

      {/* question */}
      <div>
        <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.4rem", margin: 0, color: "var(--text)" }}>
          {caseData.leadIn || caseData.questionPrompt}
        </h2>
        {caseData.leadIn && caseData.questionPrompt && caseData.questionPrompt !== caseData.leadIn && (
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "8px 0 0" }}>
            {caseData.questionPrompt}
          </p>
        )}
      </div>

      {/* multiple choice */}
      {caseData.questionType === "multiple_choice" && (
        <div role="radiogroup" aria-label="Answer choices" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {caseData.options.map((o) => {
            const rev = reveal?.optionExplanations[o.id];
            const isChosen = (answered ? reveal!.yourAnswer.optionId : selected) === o.id;
            const isCorrect = rev?.isCorrect;
            const total = reveal?.stats.total || 0;
            const count = reveal?.stats.optionCounts[o.id] || 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            const border = answered
              ? (isCorrect ? "var(--accent-tertiary)" : isChosen ? "var(--accent-primary)" : "var(--border)")
              : (isChosen ? "var(--accent-primary)" : "var(--border)");
            return (
              <button key={o.id} type="button" role="radio" aria-checked={isChosen} disabled={answered}
                onClick={() => !answered && setSelected(o.id)}
                style={{
                  position: "relative", textAlign: "left", padding: "14px 16px", borderRadius: 12,
                  border: `2px solid ${border}`, background: "var(--bg-card)", cursor: answered ? "default" : "pointer",
                  color: "var(--text)", font: "inherit", overflow: "hidden",
                }}>
                {answered && (
                  <span aria-hidden style={{ position: "absolute", inset: 0, width: `${pct}%`,
                    background: isCorrect ? "color-mix(in srgb, var(--accent-tertiary) 16%, transparent)" : "color-mix(in srgb, var(--accent-primary) 10%, transparent)" }} />
                )}
                <span style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <span style={{ fontWeight: isChosen || isCorrect ? 600 : 500 }}>
                    {answered && isCorrect ? "✓ " : answered && isChosen ? "✗ " : ""}{o.label}
                  </span>
                  {answered && <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{pct}% · {count}</span>}
                </span>
                {answered && rev?.explanation && (
                  <span style={{ position: "relative", display: "block", marginTop: 8, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {rev.explanation}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {error && <div role="alert" style={{ color: "var(--accent-primary)", fontSize: 14 }}>{error}</div>}

      {!answered ? (
        <div>
          <button type="button" onClick={submit} disabled={loading}
            style={{ padding: "12px 24px", borderRadius: 10, border: "none", cursor: "pointer",
              background: "var(--accent-primary)", color: "#fff", fontWeight: 600, fontSize: 15, opacity: loading ? 0.7 : 1 }}>
            {loading ? "Checking…" : "Submit answer"}
          </button>
        </div>
      ) : (
        <>
          <Reveal reveal={reveal!} />
          {onNext && (
            <div>
              <button type="button" onClick={onNext}
                style={{ padding: "12px 24px", borderRadius: 10, border: "1px solid var(--border)", cursor: "pointer",
                  background: "var(--bg-card)", color: "var(--text)", fontWeight: 600, fontSize: 15 }}>
                Next question →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Reveal({ reveal }: { reveal: RevealResult }) {
  const pct = reveal.stats.total ? Math.round((reveal.stats.correctCount / reveal.stats.total) * 100) : 0;
  // Question-bank items carry key_points; older Case-of-the-Day rows only have
  // teaching_points, and a reveal cached in localStorage before the bank
  // shipped has neither field.
  const points: string[] = reveal.keyPoints?.length ? reveal.keyPoints : (reveal.teachingPoints ?? []);
  const references: CaseReference[] = reveal.references ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem", borderTop: "1px solid var(--border)", paddingTop: "1.3rem" }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 10, alignSelf: "flex-start",
        padding: "8px 16px", borderRadius: 30, fontWeight: 600,
        background: reveal.correct ? "color-mix(in srgb, var(--accent-tertiary) 15%, transparent)" : "color-mix(in srgb, var(--accent-primary) 12%, transparent)",
        color: reveal.correct ? "var(--accent-tertiary)" : "var(--accent-primary)",
      }}>
        {reveal.correct ? "✓ Correct" : "✗ Not quite"}
        {reveal.alreadyAnswered && <span style={{ fontFamily: "monospace", fontSize: 11, opacity: 0.7 }}>· you answered this before</span>}
      </div>

      {reveal.explanation && (
        <p style={{ margin: 0, fontSize: "1.02rem", lineHeight: 1.65, color: "var(--text)" }}>{reveal.explanation}</p>
      )}

      {points.length > 0 && (
        <div>
          <div style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Key points</div>
          <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            {points.map((t, i) => <li key={i} style={{ color: "var(--text-secondary)", lineHeight: 1.55 }}>{t}</li>)}
          </ul>
        </div>
      )}

      {references.length > 0 && (
        <div>
          <div style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Evidence</div>
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 7 }}>
            {references.map((r) => (
              <li key={r.id} style={{ color: "var(--text-secondary)", lineHeight: 1.5, fontSize: 13.5 }}>
                {r.citation}
                {r.pmid && (
                  <>
                    {" "}
                    <a href={`https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`} target="_blank" rel="noopener noreferrer"
                      style={{ fontFamily: "monospace", fontSize: 12 }}>
                      PubMed {r.pmid} ↗
                    </a>
                  </>
                )}
                {!r.pmid && r.doi && (
                  <>
                    {" "}
                    <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noopener noreferrer"
                      style={{ fontFamily: "monospace", fontSize: 12 }}>
                      doi ↗
                    </a>
                  </>
                )}
                {r.role === "primary" && (
                  <span style={{ fontFamily: "monospace", fontSize: 10.5, marginLeft: 6, color: "var(--accent-primary)" }}>PRIMARY</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-muted)" }}>
        Community: <strong style={{ color: "var(--text)" }}>{pct}%</strong> of {reveal.stats.total} response{reveal.stats.total === 1 ? "" : "s"} correct
      </div>
    </div>
  );
}

// ---- interactive point-to-feature image with heat-map reveal ----
function PointImage({ src, alt, point, onPick, reveal }:
  { src: string; alt: string; point: { x: number; y: number } | null; onPick?: (p: { x: number; y: number }) => void; reveal: RevealResult | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const interactive = !!onPick;

  const measure = useCallback(() => {
    const el = wrapRef.current;
    if (el) setDims({ w: el.clientWidth, h: el.clientHeight });
  }, []);
  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const handleClick = (e: React.MouseEvent) => {
    if (!onPick || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    onPick({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };
  const handleKey = (e: React.KeyboardEvent) => {
    if (!onPick) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const p = point ?? { x: 0.5, y: 0.5 };
    if (e.key === "ArrowLeft") { onPick({ x: Math.max(0, p.x - step), y: p.y }); e.preventDefault(); }
    else if (e.key === "ArrowRight") { onPick({ x: Math.min(1, p.x + step), y: p.y }); e.preventDefault(); }
    else if (e.key === "ArrowUp") { onPick({ x: p.x, y: Math.max(0, p.y - step) }); e.preventDefault(); }
    else if (e.key === "ArrowDown") { onPick({ x: p.x, y: Math.min(1, p.y + step) }); e.preventDefault(); }
    else if ((e.key === "Enter" || e.key === " ") && !point) { onPick({ x: 0.5, y: 0.5 }); e.preventDefault(); }
  };

  // draw heat-map + correct region on reveal
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !reveal || dims.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = dims.w * dpr; c.height = dims.h * dpr;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dims.w, dims.h);
    // heat-map
    ctx.globalCompositeOperation = "lighter";
    for (const p of reveal.stats.points) {
      const x = p.x * dims.w, y = p.y * dims.h;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
      const col = p.correct ? "42,107,90" : "212,96,58";
      g.addColorStop(0, `rgba(${col},0.5)`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    // correct region outline
    drawRegion(ctx, reveal.correctRegion, dims.w, dims.h);
    // your point
    const yp = reveal.yourAnswer;
    if (yp.x != null && yp.y != null) {
      const x = yp.x * dims.w, y = yp.y * dims.h;
      ctx.strokeStyle = reveal.correct ? "#2a6b5a" : "#d4603a"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
    }
  }, [reveal, dims]);

  return (
    <div>
      <div ref={wrapRef} onClick={handleClick} onKeyDown={handleKey}
        role={interactive ? "button" : "img"}
        aria-label={interactive ? `${alt}. Click, or use arrow keys then Enter, to mark the feature.` : alt}
        tabIndex={interactive ? 0 : -1}
        style={{ position: "relative", width: "100%", borderRadius: 14, overflow: "hidden",
          border: "1px solid var(--border)", background: "var(--bg-card)", cursor: interactive ? "crosshair" : "default", lineHeight: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" draggable={false} style={{ width: "100%", display: "block", userSelect: "none" }} />
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
        {/* live crosshair before submit */}
        {interactive && point && (
          <span aria-hidden style={{ position: "absolute", left: `${point.x * 100}%`, top: `${point.y * 100}%`,
            width: 18, height: 18, transform: "translate(-50%,-50%)", borderRadius: "50%",
            border: "2px solid var(--accent-primary)", boxShadow: "0 0 0 3px color-mix(in srgb,var(--accent-primary) 25%,transparent)" }} />
        )}
      </div>
      {interactive && (
        <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
          {point ? `Marked at ${Math.round(point.x * 100)}%, ${Math.round(point.y * 100)}% — submit to check` : "Click the tracing to place your marker (or use arrow keys)."}
        </div>
      )}
      {reveal && (
        <div style={{ display: "flex", gap: 16, marginTop: 8, fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
          <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: "#2a6b5a", marginRight: 5 }} />correct region</span>
          <span>heat-map = where {reveal.stats.total} responder{reveal.stats.total === 1 ? "" : "s"} pointed</span>
        </div>
      )}
    </div>
  );
}

function drawRegion(ctx: CanvasRenderingContext2D, region: Region | null, w: number, h: number) {
  if (!region) return;
  ctx.save();
  ctx.strokeStyle = "#2a6b5a"; ctx.lineWidth = 2.5; ctx.setLineDash([7, 5]);
  ctx.fillStyle = "rgba(42,107,90,0.08)";
  ctx.beginPath();
  if (region.kind === "rect") {
    ctx.rect(region.x * w, region.y * h, region.w * w, region.h * h);
  } else if (region.kind === "circle") {
    ctx.arc(region.cx * w, region.cy * h, region.r * w, 0, Math.PI * 2);
  } else if (region.kind === "poly") {
    region.points.forEach(([px, py], i) => { const X = px * w, Y = py * h; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath();
  }
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
