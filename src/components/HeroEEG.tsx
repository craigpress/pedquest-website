"use client";

import { useEffect, useRef } from "react";

// ── Living-EEG hero: canvas 10-channel montage (ported from the approved
// homepage-v2 mockup). Each channel sums three sinusoids with deterministic
// per-channel parameters, plus intermittent spindle bursts; a warm "discharge"
// event periodically sweeps across the montage. Middle channels are emphasized.
// Honors prefers-reduced-motion (renders one static frame mid-event).
const EEG_CHANNELS = 10;
const EEG_GRID = "rgba(120,200,210,0.06)";
const EEG_TRACE = "rgba(78,225,210,"; // + alpha
const EEG_GLOW = "rgba(46,214,198,0.35)";
const EEG_WARM = "rgba(245,180,85,";

export function HeroEEG() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const gens = Array.from({ length: EEG_CHANNELS }, (_, i) => ({
      a1: 8 + ((i * 37) % 9), f1: 0.8 + ((i * 13) % 5) * 0.25,
      a2: 2.5 + ((i * 7) % 4), f2: 5 + ((i * 11) % 9),
      a3: 1.2 + ((i * 5) % 3), f3: 14 + ((i * 17) % 12),
      ph: (i * 1.7) % 6.28, drift: 0.2 + ((i * 3) % 5) * 0.06,
    }));
    const ev = { active: false, pos: 0, next: 3.5 };
    let ctx: CanvasRenderingContext2D | null = null;
    let W = 0;
    let H = 0;
    let t = 0;
    let raf = 0;
    let last = 0;
    let lastDraw = 0;
    let visible = false;

    function fit() {
      if (!cv) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      W = r.width;
      H = r.height;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx = cv.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function chanVal(i: number, xt: number, tt: number) {
      const g = gens[i];
      let v =
        Math.sin(xt * g.f1 * 6.28 + tt * g.drift + g.ph) * g.a1 +
        Math.sin(xt * g.f2 * 6.28 + tt * 1.1 + g.ph * 1.3) * g.a2 +
        Math.sin(xt * g.f3 * 6.28 + tt * 1.7) * g.a3;
      // sleep-spindle-like intermittent burst
      const sp = Math.max(0, Math.sin(tt * 0.5 + i * 1.3) - 0.7);
      v += Math.sin(xt * 70 * 6.28 + tt * 3) * sp * 22;
      return v;
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      // faint EEG-paper grid
      ctx.strokeStyle = EEG_GRID;
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += Math.max(34, W / 28)) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, H);
        ctx.stroke();
      }
      const top = H * 0.1;
      const span = H * 0.82;
      const gap = span / (EEG_CHANNELS - 1);
      const evX = ev.active ? ev.pos * W : -1;
      for (let i = 0; i < EEG_CHANNELS; i++) {
        const baseY = top + i * gap;
        const depth = i / (EEG_CHANNELS - 1);
        const front = 1 - Math.abs(depth - 0.5) * 1.3; // middle channels emphasized
        const alpha = 0.18 + Math.max(0, front) * 0.62;
        ctx.lineWidth = 0.8 + Math.max(0, front) * 1.1;
        ctx.beginPath();
        for (let px = 0; px <= W; px += 2) {
          const xt = px / W;
          const amp = (gap * 0.42) / 12;
          const val = chanVal(i, xt, t) * amp;
          let eBoost = 0;
          if (ev.active) {
            const d = Math.abs(px - evX) / (W * 0.12);
            if (d < 3) {
              const env = Math.exp(-d * d);
              eBoost = Math.sin(xt * 40 * 6.28 + t * 8) * env * gap * 0.9;
            }
          }
          const y = baseY + val - eBoost;
          if (px === 0) ctx.moveTo(px, y);
          else ctx.lineTo(px, y);
        }
        ctx.strokeStyle = EEG_TRACE + alpha.toFixed(3) + ")";
        ctx.shadowBlur = front > 0.5 ? 8 : 0;
        ctx.shadowColor = EEG_GLOW;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // warm sweep highlight over the discharge
      if (ev.active) {
        ctx.save();
        const x0 = evX - W * 0.14;
        const x1 = evX + W * 0.14;
        const grd = ctx.createLinearGradient(x0, 0, x1, 0);
        grd.addColorStop(0, EEG_WARM + "0)");
        grd.addColorStop(0.5, EEG_WARM + "0.5)");
        grd.addColorStop(1, EEG_WARM + "0)");
        ctx.strokeStyle = grd;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 12;
        ctx.shadowColor = EEG_WARM + "0.5)";
        for (let i = 0; i < EEG_CHANNELS; i++) {
          const baseY = top + i * gap;
          const depth = i / (EEG_CHANNELS - 1);
          const front = 1 - Math.abs(depth - 0.5) * 1.3;
          ctx.beginPath();
          for (let px = Math.max(0, x0); px <= Math.min(W, x1); px += 2) {
            const xt = px / W;
            const d = Math.abs(px - evX) / (W * 0.12);
            const env = Math.exp(-d * d);
            const amp = (gap * 0.42) / 12;
            const y = baseY + chanVal(i, xt, t) * amp - Math.sin(xt * 40 * 6.28 + t * 8) * env * gap * 0.9;
            if (px === Math.max(0, x0)) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
          }
          ctx.globalAlpha = 0.35 + Math.max(0, front) * 0.5;
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    function tick(dt: number) {
      t += dt;
      if (ev.active) {
        ev.pos += dt * 0.42;
        if (ev.pos > 1.15) {
          ev.active = false;
          ev.next = t + 4 + Math.sin(t) * 2 + 3;
        }
      } else if (t > ev.next) {
        ev.active = true;
        ev.pos = -0.15;
      }
    }

    function staticFrame() {
      ev.active = true;
      ev.pos = 0.62;
      t = 6.2;
      draw();
      ev.active = false;
    }

    function loop(ts: number) {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
      last = ts;
      tick(dt);
      if (!lastDraw || ts - lastDraw >= 1000 / 30 - 0.1) {
        draw();
        lastDraw = ts;
      }
      raf = requestAnimationFrame(loop);
    }

    function syncAnimation() {
      if (reduce) return;
      if (!visible || document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
        lastDraw = 0;
      } else if (!raf) {
        raf = requestAnimationFrame(loop);
      }
    }

    fit();
    const onResize = () => {
      fit();
      if (reduce) staticFrame();
      else if (visible && !document.hidden) draw();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncAnimation();
    });
    observer.observe(cv);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", syncAnimation);
    if (reduce) staticFrame();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", syncAnimation);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="hero-eeg"
      role="img"
      aria-label="A live 10–20 montage electroencephalogram: ten channels of flowing brain-wave activity with an occasional discharge sweeping across the array."
    />
  );
}
