"use client";

/** Tiny trend line without axes; null values break the line (gaps, never zeros). */
export function Sparkline({ values, label, width = 104, height = 32, color = "var(--series-2)" }: { values: (number | null)[]; label: string; width?: number; height?: number; color?: string }) {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length < 2) {
    return (
      <span className="inline-flex items-center text-xs text-muted" style={{ width, height }}>
        {nums.length === 1 ? "1 session" : "No data"}
      </span>
    );
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pad = 3;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / span);
  const segments: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
      return;
    }
    cur.push(`${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(" "));
  let lastIndex = values.length - 1;
  while (lastIndex >= 0 && values[lastIndex] == null) lastIndex -= 1;
  const last = values[lastIndex] as number;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="shrink-0 overflow-visible">
      {segments.map((pts) => (
        <polyline key={pts} points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      <circle cx={pad + lastIndex * step} cy={y(last)} r={3} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}
