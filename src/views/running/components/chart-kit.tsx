"use client";

/**
 * Small chart helpers shared by the running and health screens. They mirror the
 * conventions in components/charts.tsx (recessive axes, tooltip box, one y-axis
 * per chart) for charts that module doesn't provide.
 */
import { formatLocalDate } from "@/lib/time";

export const axisProps = {
  tickLine: false,
  axisLine: { stroke: "var(--axis)" },
  tick: { fontSize: 12 },
} as const;

/** Show roughly eight x-axis ticks regardless of how many points there are. */
export const tickEvery = (n: number) => Math.max(0, Math.ceil(n / 8) - 1);

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

export function TooltipBox({ title, rows, footer }: { title: string; rows: TooltipRow[]; footer?: string | null }) {
  return (
    <div className="max-w-64 min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-fg">{title}</p>
      {rows.length === 0 ? (
        <p className="text-muted">No data</p>
      ) : (
        rows.map((r) => (
          <p key={r.label} className="flex items-center justify-between gap-4 text-fg-2">
            <span className="inline-flex items-center gap-1.5">
              {r.color && <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} />}
              {r.label}
            </span>
            <span className="font-medium text-fg tabular">{r.value}</span>
          </p>
        ))
      )}
      {footer && <p className="mt-1.5 border-t border-line pt-1 text-[11px] text-muted">{footer}</p>}
    </div>
  );
}

/** Builds a Recharts `content` render function from a row formatter. */
export function tooltipFor<T>(fmt: (row: T) => { title: string; rows: TooltipRow[]; footer?: string | null }) {
  return function renderTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
    if (!active || !payload?.length || !payload[0].payload) return null;
    const { title, rows, footer } = fmt(payload[0].payload as T);
    return <TooltipBox title={title} rows={rows} footer={footer} />;
  };
}

export const longDate = (d: string) => formatLocalDate(d, { weekday: "short", month: "short", day: "numeric" });
export const monthLabel = (d: string) => formatLocalDate(d.length === 7 ? `${d}-01` : d, { month: "short", year: "2-digit" });
export const monthLong = (d: string) => formatLocalDate(d.length === 7 ? `${d}-01` : d, { month: "long", year: "numeric" });

/** Compact axis numbers: 12,400 → "12.4k". */
export function compact(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(Math.abs(v) >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(v * 10) / 10);
}
