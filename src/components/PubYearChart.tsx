// Inline SVG line+area chart of publications per year. Pure/deterministic, so
// it renders identically on server and client. Styling via .pub-chart tokens.
export function PubYearChart({ data }: { data: { year: number; count: number }[] }) {
  const W = 520;
  const H = 150;
  const pad = 20;
  const max = Math.max(1, ...data.map((d) => d.count));
  const xs = (i: number) => pad + (i * (W - pad * 2)) / (data.length - 1 || 1);
  const ys = (c: number) => H - pad - (c / max) * (H - pad * 2);
  const line = data.map((d, i) => `${xs(i).toFixed(1)},${ys(d.count).toFixed(1)}`).join(" ");
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);
  return (
    <svg
      className="pub-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Peer-reviewed publications per year"
    >
      <polygon points={area} fill="var(--accent)" opacity="0.09" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {peak && (
        <circle cx={xs(data.indexOf(peak))} cy={ys(peak.count)} r="3.5" fill="var(--accent)" />
      )}
    </svg>
  );
}
