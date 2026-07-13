// Generates two SYNTHETIC (drawn, no patient data) EEG teaching images as SVG.
// Run: node scripts/gen-sample-eeg.mjs
// Output: public/images/eeg-cases/sample-asymmetry.svg, sample-seizure.svg
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "images", "eeg-cases");
mkdirSync(outDir, { recursive: true });

const W = 1000, H = 600, PAD = 70, CH = 8;
const labels = ["Fp1-F3", "F3-C3", "C3-P3", "P3-O1", "Fp2-F4", "F4-C4", "C4-P4", "P4-O2"];

// deterministic pseudo-random so output is stable across runs
function rng(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }

function trace(baseY, amp, freq, rand, opts = {}) {
  const step = 2, pts = [];
  for (let x = PAD; x <= W - PAD; x += step) {
    const t = (x - PAD) / (W - 2 * PAD);
    let y = Math.sin(t * freq * Math.PI * 2) * amp
          + Math.sin(t * freq * 2.7 * Math.PI * 2) * amp * 0.35
          + (rand() - 0.5) * amp * 0.4;
    // localized evolving discharge (seizure) inside [x0,x1]
    if (opts.seizure) {
      const { x0, x1 } = opts.seizure;
      if (t > x0 && t < x1) {
        const p = (t - x0) / (x1 - x0);          // 0..1 across the event
        const env = Math.sin(p * Math.PI);        // rise & fall
        const evoFreq = 6 + p * 22;               // frequency evolves upward
        y += Math.sin(p * evoFreq * Math.PI * 2) * amp * 2.6 * env;
      }
    }
    pts.push(`${x.toFixed(1)},${(baseY - y).toFixed(1)}`);
  }
  return pts.join(" ");
}

function svg({ title, seizure = null, asymmetry = false, region = null }) {
  const rowH = (H - 2 * PAD) / (CH - 1);
  let body = "";
  // faint EEG-paper grid
  for (let gx = PAD; gx <= W - PAD; gx += (W - 2 * PAD) / 20)
    body += `<line x1="${gx.toFixed(0)}" y1="${PAD - 20}" x2="${gx.toFixed(0)}" y2="${H - PAD + 20}" stroke="#c9d3e0" stroke-width="0.5"/>`;
  for (let i = 0; i < CH; i++) {
    const baseY = PAD + i * rowH;
    const left = i < CH / 2;
    // asymmetry: left channels bigger & slower; right attenuated & faster
    const amp = asymmetry ? (left ? rowH * 0.42 : rowH * 0.16) : rowH * 0.3;
    const freq = asymmetry ? (left ? 5 : 11) : 8;
    const r = rng(1000 + i * 37);
    body += `<text x="${PAD - 12}" y="${(baseY + 4).toFixed(0)}" text-anchor="end" font-family="monospace" font-size="15" fill="#5a6c80">${labels[i]}</text>`;
    body += `<polyline points="${trace(baseY, amp, freq, r, { seizure })}" fill="none" stroke="#0b6c78" stroke-width="1.4" stroke-linejoin="round"/>`;
  }
  // optional visible target ring is intentionally NOT drawn (the quiz reveals it)
  const scaleBar = `<line x1="${W - PAD - 60}" y1="${H - 34}" x2="${W - PAD}" y2="${H - 34}" stroke="#5a6c80" stroke-width="2"/><text x="${W - PAD - 30}" y="${H - 40}" text-anchor="middle" font-family="monospace" font-size="12" fill="#5a6c80">1 s</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
  <rect width="${W}" height="${H}" fill="#f7f9fb"/>
  ${body}
  <text x="${PAD}" y="34" font-family="system-ui,sans-serif" font-size="18" font-weight="600" fill="#0d1a2b">Synthetic teaching tracing — ${title}</text>
  ${scaleBar}
</svg>`;
}

writeFileSync(join(outDir, "sample-asymmetry.svg"),
  svg({ title: "left-hemisphere asymmetry", asymmetry: true }));
writeFileSync(join(outDir, "sample-seizure.svg"),
  svg({ title: "evolving electrographic seizure", seizure: { x0: 0.52, x1: 0.72 } }));

console.log("Wrote sample-asymmetry.svg and sample-seizure.svg to", outDir);
