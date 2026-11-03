"use client";

/**
 * Strength charts. Same conventions as src/components/charts.tsx: one y-axis per
 * chart, thin marks, a legend for 2+ series, a table view for every chart, and
 * missing sessions are gaps (never zeros). Values arrive in the display unit.
 */
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, ChartLegend, DataTable, SERIES, shortDate } from "@/components/charts";
import { formatLocalDate } from "@/lib/time";

const axisProps = { tickLine: false, axisLine: { stroke: "var(--axis)" }, tick: { fontSize: 12 } } as const;
const tickEvery = (n: number) => Math.max(0, Math.ceil(n / 8) - 1);
const longDate = (d: string) => formatLocalDate(d, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

interface TipRow {
  label: string;
  value: string;
  color?: string;
}

function TipBox({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-fg">{title}</p>
      {rows.length === 0 ? (
        <p className="text-muted">No data</p>
      ) : (
        rows.map((r) => (
          <p key={r.label} className="flex items-center justify-between gap-4 text-fg-2">
            <span className="inline-flex items-center gap-1.5">
              {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} />}
              {r.label}
            </span>
            <span className="font-medium text-fg tabular">{r.value}</span>
          </p>
        ))
      )}
    </div>
  );
}

function tooltipFor<T>(fmt: (row: T) => { title: string; rows: TipRow[] }) {
  return function renderTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
    if (!active || !payload?.length || !payload[0].payload) return null;
    const { title, rows } = fmt(payload[0].payload as T);
    return <TipBox title={title} rows={rows} />;
  };
}

const num = (v: number, decimals = 1) => v.toLocaleString("en-US", { maximumFractionDigits: decimals });

function paddedDomain(values: (number | null)[], minPad = 1): [number, number] {
  const vs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!vs.length) return [0, 1];
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const pad = Math.max(minPad, (max - min) * 0.12);
  return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
}

export interface StrengthPointJ {
  date: string;
  e1rm: number | null;
  top: number;
  topReps: number;
}

/** Estimated 1RM and top-set weight per session: same unit, so one shared axis. */
export function StrengthChart({ data, unit, actions }: { data: StrengthPointJ[]; unit: string; actions?: ReactNode }) {
  const fmt = (v: number | null) => (v == null ? "—" : `${num(v)} ${unit}`);
  const tip = tooltipFor<StrengthPointJ>((d) => ({
    title: longDate(d.date),
    rows: [
      { label: "Est. 1RM (best set)", value: d.e1rm == null ? "Not estimable" : fmt(d.e1rm), color: SERIES.s2 },
      { label: "Top set", value: `${fmt(d.top)} × ${d.topReps}`, color: SERIES.s1 },
    ],
  }));
  const dot = (color: string) => (data.length <= 40 ? { r: 3.5, fill: color, stroke: "var(--chart-surface)", strokeWidth: 1.5 } : false);
  return (
    <ChartFrame
      title="Estimated 1RM and top set"
      sub="Per session. Estimated 1RM uses your best eligible set; sets above your rep cap aren't used."
      actions={actions}
      legend={
        <ChartLegend
          items={[
            { key: "e1rm", label: "Estimated 1RM", color: SERIES.s2 },
            { key: "top", label: "Top set weight", color: SERIES.s1 },
          ]}
        />
      }
      table={<DataTable columns={["Date", "Est. 1RM", "Top set"]} rows={[...data].reverse().map((d) => [d.date, fmt(d.e1rm), `${fmt(d.top)} × ${d.topReps}`])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(data.length)} minTickGap={16} {...axisProps} />
          <YAxis domain={paddedDomain(data.flatMap((d) => [d.e1rm, d.top]))} width={48} allowDecimals={false} {...axisProps} />
          <Tooltip content={tip} cursor={{ stroke: "var(--axis)" }} />
          <Line dataKey="top" stroke={SERIES.s1} strokeWidth={2} dot={dot(SERIES.s1)} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="e1rm" stroke={SERIES.s2} strokeWidth={2} dot={dot(SERIES.s2)} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export interface BarPoint {
  key: string;
  value: number | null;
  /** Extra tooltip/table text, e.g. "3 sessions". */
  note?: string;
}

/** One measure per period or session, as bars. */
export function BarSeriesChart({
  title,
  sub,
  data,
  valueLabel,
  fmt,
  keyLabel = "Date",
  keyFmt = shortDate,
  keyTitle = longDate,
  color = SERIES.s2,
  height = 220,
  allowDecimals = false,
  actions,
}: {
  title: string;
  sub?: ReactNode;
  data: BarPoint[];
  valueLabel: string;
  fmt: (v: number) => string;
  keyLabel?: string;
  keyFmt?: (k: string) => string;
  keyTitle?: (k: string) => string;
  color?: string;
  height?: number;
  allowDecimals?: boolean;
  actions?: ReactNode;
}) {
  const tip = tooltipFor<BarPoint>((d) => ({ title: keyTitle(d.key), rows: [{ label: valueLabel, value: d.value == null ? "—" : fmt(d.value), color }, ...(d.note ? [{ label: "Detail", value: d.note }] : [])] }));
  return (
    <ChartFrame
      title={title}
      sub={sub}
      height={height}
      actions={actions}
      table={<DataTable columns={[keyLabel, valueLabel, ...(data.some((d) => d.note) ? ["Detail"] : [])]} rows={[...data].reverse().map((d) => [keyTitle(d.key), d.value == null ? null : fmt(d.value), ...(data.some((x) => x.note) ? [d.note ?? null] : [])])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="key" tickFormatter={keyFmt} interval={tickEvery(data.length)} minTickGap={12} {...axisProps} />
          <YAxis width={52} allowDecimals={allowDecimals} tickFormatter={(v: number) => (v >= 10_000 ? `${num(v / 1000, 0)}k` : v >= 1000 ? `${num(v / 1000)}k` : num(v))} {...axisProps} />
          <Tooltip content={tip} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="value" fill={color} maxBarSize={22} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export interface RepsPoint {
  date: string;
  reps: number | null;
  note?: string;
}

/** Reps per session as a line with dots (one axis: reps). */
export function RepsChart({ title, sub, data, actions, color = SERIES.s3, emptyText }: { title: string; sub?: ReactNode; data: RepsPoint[]; actions?: ReactNode; color?: string; emptyText?: string }) {
  const tip = tooltipFor<RepsPoint>((d) => ({ title: longDate(d.date), rows: [{ label: "Reps", value: d.reps == null ? "—" : String(d.reps), color }, ...(d.note ? [{ label: "Set", value: d.note }] : [])] }));
  return (
    <ChartFrame
      title={title}
      sub={sub}
      height={220}
      actions={actions}
      table={data.length ? <DataTable columns={["Date", "Reps", "Detail"]} rows={[...data].reverse().map((d) => [d.date, d.reps, d.note ?? null])} /> : <p className="text-sm text-muted">{emptyText ?? "No data."}</p>}
    >
      {data.length === 0 ? (
        <p className="flex h-full items-center justify-center text-sm text-muted">{emptyText ?? "No data."}</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(data.length)} minTickGap={16} {...axisProps} />
            <YAxis domain={paddedDomain(data.map((d) => d.reps))} width={40} allowDecimals={false} {...axisProps} />
            <Tooltip content={tip} cursor={{ stroke: "var(--axis)" }} />
            <Line dataKey="reps" stroke={color} strokeWidth={2} dot={{ r: 3.5, fill: color, stroke: "var(--chart-surface)", strokeWidth: 1.5 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
