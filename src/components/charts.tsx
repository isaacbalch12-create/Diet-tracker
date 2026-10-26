"use client";

/**
 * Charts. Conventions (kept consistent everywhere):
 * - One y-axis per chart; two measures with different units are shown as two
 *   stacked charts sharing the x-axis and a synchronized hover.
 * - Thin marks (2px lines, ≥8px dots), hairline grid, legend for ≥2 series,
 *   tooltips on hover, and a table view for every chart.
 * - Missing days are gaps, never zeros.
 */
import { Table2, LineChart as LineIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatLocalDate } from "@/lib/time";
import { cx } from "./ui";

export const SERIES = {
  s1: "var(--series-1)",
  s2: "var(--series-2)",
  s3: "var(--series-3)",
  cal: "var(--series-cal)",
  neutral: "var(--text-2)",
  muted: "var(--muted)",
};

export function shortDate(d: string) {
  return formatLocalDate(d, { month: "short", day: "numeric" });
}

const axisProps = {
  tickLine: false,
  axisLine: { stroke: "var(--axis)" },
  tick: { fontSize: 12 },
} as const;

interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
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

/** Builds a Recharts tooltip render function from a row formatter. */
function tooltipFor<T>(fmt: (row: T) => { title: string; rows: TooltipRow[] }) {
  return function renderTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
    if (!active || !payload?.length || !payload[0].payload) return null;
    const { title, rows } = fmt(payload[0].payload as T);
    return <TooltipBox title={title} rows={rows} />;
  };
}

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  shape?: "line" | "dot" | "dash" | "bar";
  active?: boolean;
}

export function ChartLegend({ items, onToggle }: { items: LegendItem[]; onToggle?: (key: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-2">
      {items.map((it) => {
        const swatch =
          it.shape === "dot" ? (
            <span className="size-2.5 rounded-full" style={{ background: it.color }} />
          ) : it.shape === "bar" ? (
            <span className="h-2.5 w-2 rounded-sm" style={{ background: it.color }} />
          ) : (
            <span className="h-0 w-4 border-t-2" style={{ borderColor: it.color, borderStyle: it.shape === "dash" ? "dashed" : "solid" }} />
          );
        const content = (
          <span className={cx("inline-flex items-center gap-1.5", it.active === false && "opacity-40")}>
            {swatch}
            {it.label}
          </span>
        );
        return (
          <li key={it.key}>
            {onToggle ? (
              <button type="button" aria-pressed={it.active !== false} onClick={() => onToggle(it.key)} className="rounded px-1 hover:bg-surface-2">
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Frame for a chart with title, legend, and a chart/table toggle. */
export function ChartFrame({ title, sub, legend, table, children, height = 260, actions }: { title: string; sub?: ReactNode; legend?: ReactNode; table: ReactNode; children: ReactNode; height?: number; actions?: ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow)] sm:p-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={() => setView(view === "chart" ? "table" : "chart")}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-2 hover:bg-surface-2"
            aria-label={view === "chart" ? `Show ${title} as a table` : `Show ${title} as a chart`}
          >
            {view === "chart" ? <Table2 className="size-3.5" /> : <LineIcon className="size-3.5" />}
            {view === "chart" ? "Table" : "Chart"}
          </button>
        </div>
      </div>
      {legend && view === "chart" && <div className="mb-2">{legend}</div>}
      {view === "chart" ? <div style={{ height }}>{children}</div> : <div className="max-h-80 overflow-auto">{table}</div>}
    </section>
  );
}

export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number | null)[][] }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-surface">
        <tr>
          {columns.map((c, i) => (
            <th key={i} className="border-b border-line px-2 py-1.5 font-medium text-muted">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="tabular">
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line last:border-0">
            {r.map((c, j) => (
              <td key={j} className="px-2 py-1.5 text-fg-2">
                {c ?? "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const tickEvery = (n: number) => Math.max(0, Math.ceil(n / 8) - 1);

// ---------- Weight ----------

export interface WeightPoint {
  date: string;
  morning: number | null;
  night: number | null;
  average: number | null;
  rolling7: number | null;
  trend: number | null;
}

type WeightSeriesKey = "morning" | "night" | "average" | "rolling7" | "trend";

export function WeightChart({ data, unit, height = 300 }: { data: WeightPoint[]; unit: string; height?: number }) {
  const [shown, setShown] = useState<Record<WeightSeriesKey, boolean>>({ morning: true, night: true, average: false, rolling7: true, trend: true });
  const fmt = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} ${unit}`);
  const legend: LegendItem[] = [
    { key: "morning", label: "Morning", color: SERIES.s1, shape: "dot", active: shown.morning },
    { key: "night", label: "Night", color: SERIES.s2, shape: "dot", active: shown.night },
    { key: "average", label: "Daily average", color: SERIES.neutral, shape: "line", active: shown.average },
    { key: "rolling7", label: "7-day average", color: SERIES.s3, shape: "line", active: shown.rolling7 },
    { key: "trend", label: "Trend line", color: SERIES.muted, shape: "dash", active: shown.trend },
  ];
  const values = data.flatMap((d) => [d.morning, d.night, d.rolling7]).filter((v): v is number => v != null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const pad = Math.max(0.5, (max - min) * 0.1);
  const tip = tooltipFor<WeightPoint>((d) => ({
    title: formatLocalDate(d.date, { weekday: "short", month: "short", day: "numeric" }),
    rows: [
      d.morning != null && { label: "Morning", value: fmt(d.morning), color: SERIES.s1 },
      d.night != null && { label: "Night", value: fmt(d.night), color: SERIES.s2 },
      d.average != null && { label: "Daily avg", value: fmt(d.average) },
      d.rolling7 != null && { label: "7-day avg", value: fmt(d.rolling7), color: SERIES.s3 },
      d.trend != null && { label: "Trend", value: fmt(d.trend) },
    ].filter(Boolean) as TooltipRow[],
  }));
  return (
    <ChartFrame
      title="Weight"
      sub="Dots are weigh-ins; the 7-day average smooths daily water swings. Missing days stay blank."
      legend={<ChartLegend items={legend} onToggle={(k) => setShown({ ...shown, [k]: !shown[k as WeightSeriesKey] })} />}
      height={height}
      table={<DataTable columns={["Date", "Morning", "Night", "Daily avg", "7-day avg"]} rows={[...data].reverse().filter((d) => d.average != null || d.rolling7 != null).map((d) => [d.date, fmt(d.morning), fmt(d.night), fmt(d.average), fmt(d.rolling7)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(data.length)} minTickGap={16} {...axisProps} />
          <YAxis domain={[Math.floor(min - pad), Math.ceil(max + pad)]} width={48} allowDecimals={false} tickFormatter={(v: number) => v.toFixed(0)} {...axisProps} />
          <Tooltip content={tip} cursor={{ stroke: "var(--axis)" }} />
          {shown.average && <Line dataKey="average" stroke={SERIES.neutral} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />}
          {shown.trend && <Line dataKey="trend" stroke={SERIES.muted} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
          {shown.rolling7 && <Line dataKey="rolling7" stroke={SERIES.s3} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />}
          {shown.morning && <Scatter dataKey="morning" fill={SERIES.s1} stroke="var(--chart-surface)" strokeWidth={2} r={4.5} isAnimationActive={false} />}
          {shown.night && <Scatter dataKey="night" fill={SERIES.s2} stroke="var(--chart-surface)" strokeWidth={2} r={4.5} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function FluctuationChart({ data, unit }: { data: { date: string; fluctuation: number | null }[]; unit: string }) {
  const fmt = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)} ${unit}`);
  const tip = tooltipFor<{ date: string; fluctuation: number | null }>((d) => ({
    title: formatLocalDate(d.date, { weekday: "short", month: "short", day: "numeric" }),
    rows: d.fluctuation == null ? [] : [{ label: "Night − morning", value: fmt(d.fluctuation), color: SERIES.s1 }],
  }));
  return (
    <ChartFrame
      title="Morning → night change"
      sub="How much heavier you were at night than that morning (food, fluids, sodium). Days missing either reading are blank."
      table={<DataTable columns={["Date", "Night − morning"]} rows={[...data].reverse().filter((d) => d.fluctuation != null).map((d) => [d.date, fmt(d.fluctuation)])} />}
      height={200}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(data.length)} minTickGap={16} {...axisProps} />
          <YAxis width={48} tickFormatter={(v: number) => v.toFixed(1)} {...axisProps} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip content={tip} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="fluctuation" fill={SERIES.s1} maxBarSize={18} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function AverageChart({ title, sub, data, unit, labelFmt }: { title: string; sub?: string; data: { key: string; label: string; average: number | null; days: number }[]; unit: string; labelFmt?: (k: string) => string }) {
  const fmt = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} ${unit}`);
  const tip = tooltipFor<{ label: string; average: number | null; days: number }>((d) => ({ title: d.label, rows: [{ label: "Average", value: fmt(d.average), color: SERIES.s1 }, { label: "Days with data", value: String(d.days) }] }));
  const vals = data.map((d) => d.average).filter((v): v is number => v != null);
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;
  const pad = Math.max(0.5, (max - min) * 0.15);
  return (
    <ChartFrame title={title} sub={sub} height={200} table={<DataTable columns={["Period", "Average", "Days"]} rows={[...data].reverse().map((d) => [d.label, fmt(d.average), d.days])} />}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="key" tickFormatter={labelFmt} interval="preserveStartEnd" minTickGap={16} {...axisProps} />
          <YAxis domain={[Math.floor(min - pad), Math.ceil(max + pad)]} width={48} allowDecimals={false} tickFormatter={(v: number) => v.toFixed(0)} {...axisProps} />
          <Tooltip content={tip} cursor={{ stroke: "var(--axis)" }} />
          <Line dataKey="average" stroke={SERIES.s1} strokeWidth={2} dot={{ r: 4, fill: SERIES.s1, stroke: "var(--chart-surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------- Nutrition ----------

export interface CaloriePoint {
  date: string;
  calories: number | null;
  calories7d: number | null;
  goalCalories: number | null;
}

export function CaloriesChart({ data, height = 260, syncId }: { data: CaloriePoint[]; height?: number; syncId?: string }) {
  const goal = [...data].reverse().find((d) => d.goalCalories != null)?.goalCalories ?? null;
  const fmt = (v: number | null) => (v == null ? "—" : `${Math.round(v).toLocaleString()} kcal`);
  const tip = tooltipFor<CaloriePoint>((d) => ({
    title: formatLocalDate(d.date, { weekday: "short", month: "short", day: "numeric" }),
    rows: [
      { label: "Calories", value: d.calories == null ? "Not logged" : fmt(d.calories), color: SERIES.cal },
      d.calories7d != null && { label: "7-day avg", value: fmt(d.calories7d), color: SERIES.neutral },
      d.goalCalories != null && { label: "Goal", value: fmt(d.goalCalories) },
    ].filter(Boolean) as TooltipRow[],
  }));
  return (
    <ChartFrame
      title="Calories"
      sub="Bars are logged days; unlogged days are blank, not zero."
      height={height}
      legend={
        <ChartLegend
          items={[
            { key: "cal", label: "Daily calories", color: SERIES.cal, shape: "bar" },
            { key: "avg", label: "7-day average", color: SERIES.neutral, shape: "line" },
            ...(goal ? [{ key: "goal", label: "Goal", color: SERIES.muted, shape: "dash" as const }] : []),
          ]}
        />
      }
      table={<DataTable columns={["Date", "Calories", "7-day avg", "Goal"]} rows={[...data].reverse().map((d) => [d.date, fmt(d.calories), fmt(d.calories7d), fmt(d.goalCalories)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} syncId={syncId} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(data.length)} minTickGap={16} {...axisProps} />
          <YAxis width={52} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} {...axisProps} />
          <Tooltip content={tip} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="calories" fill={SERIES.cal} maxBarSize={20} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          {goal && <Line dataKey="goalCalories" stroke={SERIES.muted} strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          <Line dataKey="calories7d" stroke={SERIES.neutral} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export interface MacroPoint {
  date: string;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export function MacroChart({ data }: { data: MacroPoint[] }) {
  const fmt = (v: number | null) => (v == null ? "—" : `${Math.round(v)} g`);
  const tip = tooltipFor<MacroPoint>((d) => ({
    title: formatLocalDate(d.date, { weekday: "short", month: "short", day: "numeric" }),
    rows:
      d.protein == null && d.carbs == null
        ? []
        : [
            { label: "Protein", value: fmt(d.protein), color: SERIES.s1 },
            { label: "Carbs", value: fmt(d.carbs), color: SERIES.s2 },
            { label: "Fat", value: fmt(d.fat), color: SERIES.s3 },
          ],
  }));
  const dot = (color: string) => ({ r: 3, fill: color, stroke: "var(--chart-surface)", strokeWidth: 1.5 });
  return (
    <ChartFrame
      title="Macros per day"
      sub="Grams on logged days."
      legend={
        <ChartLegend
          items={[
            { key: "p", label: "Protein", color: SERIES.s1 },
            { key: "c", label: "Carbs", color: SERIES.s2 },
            { key: "f", label: "Fat", color: SERIES.s3 },
          ]}
        />
      }
      table={<DataTable columns={["Date", "Protein", "Carbs", "Fat"]} rows={[...data].reverse().map((d) => [d.date, fmt(d.protein), fmt(d.carbs), fmt(d.fat)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(data.length)} minTickGap={16} {...axisProps} />
          <YAxis width={48} {...axisProps} />
          <Tooltip content={tip} cursor={{ stroke: "var(--axis)" }} />
          <Line dataKey="protein" stroke={SERIES.s1} strokeWidth={2} dot={data.length <= 45 ? dot(SERIES.s1) : false} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="carbs" stroke={SERIES.s2} strokeWidth={2} dot={data.length <= 45 ? dot(SERIES.s2) : false} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="fat" stroke={SERIES.s3} strokeWidth={2} dot={data.length <= 45 ? dot(SERIES.s3) : false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Weight and calories over the same days, as two stacked charts with a shared
 * x-axis and synchronized hover (never a dual-axis chart).
 */
export function WeightVsCaloriesCharts({ data, unit }: { data: { date: string; weight: number | null; weight7d: number | null; calories: number | null; calories7d: number | null }[]; unit: string }) {
  const fmtW = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} ${unit}`);
  const fmtC = (v: number | null) => (v == null ? "—" : `${Math.round(v).toLocaleString()} kcal`);
  type Row = (typeof data)[number];
  const tip = tooltipFor<Row>((d) => ({
    title: formatLocalDate(d.date, { weekday: "short", month: "short", day: "numeric" }),
    rows: [
      { label: "Weight (daily avg)", value: fmtW(d.weight), color: SERIES.s1 },
      { label: "Weight 7-day avg", value: fmtW(d.weight7d), color: SERIES.s3 },
      { label: "Calories", value: d.calories == null ? "Not logged" : fmtC(d.calories), color: SERIES.cal },
      { label: "Calories 7-day avg", value: fmtC(d.calories7d), color: SERIES.neutral },
    ],
  }));
  const ws = data.flatMap((d) => [d.weight, d.weight7d]).filter((v): v is number => v != null);
  const min = ws.length ? Math.min(...ws) : 0;
  const max = ws.length ? Math.max(...ws) : 1;
  const pad = Math.max(0.5, (max - min) * 0.1);
  return (
    <ChartFrame
      title="Weight vs. calories"
      sub="Same days, stacked — hover either chart to compare. Associations here don't prove cause and effect."
      height={380}
      legend={
        <ChartLegend
          items={[
            { key: "w", label: "Weight (daily avg)", color: SERIES.s1, shape: "dot" },
            { key: "w7", label: "Weight 7-day avg", color: SERIES.s3 },
            { key: "c", label: "Calories", color: SERIES.cal, shape: "bar" },
            { key: "c7", label: "Calories 7-day avg", color: SERIES.neutral },
          ]}
        />
      }
      table={<DataTable columns={["Date", "Weight", "Weight 7d", "Calories", "Calories 7d"]} rows={[...data].reverse().map((d) => [d.date, fmtW(d.weight), fmtW(d.weight7d), fmtC(d.calories), fmtC(d.calories7d)])} />}
    >
      <div className="flex h-full flex-col">
        <div className="h-1/2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} syncId="wvc" margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis domain={[Math.floor(min - pad), Math.ceil(max + pad)]} width={52} allowDecimals={false} tickFormatter={(v: number) => `${v.toFixed(0)}`} {...axisProps} />
              <Tooltip content={tip} cursor={{ stroke: "var(--axis)" }} />
              <Line dataKey="weight7d" stroke={SERIES.s3} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
              <Scatter dataKey="weight" fill={SERIES.s1} stroke="var(--chart-surface)" strokeWidth={2} r={4} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="h-1/2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} syncId="wvc" margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(data.length)} minTickGap={16} {...axisProps} />
              <YAxis width={52} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} {...axisProps} />
              <Tooltip content={tip} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="calories" fill={SERIES.cal} maxBarSize={16} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line dataKey="calories7d" stroke={SERIES.neutral} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ChartFrame>
  );
}

/** Weekly averages: weight (top) and calories / protein (bottom), stacked. */
export function WeeklyPairsCharts({ data, unit }: { data: { week: string; weight: number | null; calories: number | null; protein: number | null }[]; unit: string }) {
  const fmtW = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} ${unit}`);
  const fmtC = (v: number | null) => (v == null ? "—" : `${Math.round(v).toLocaleString()} kcal`);
  const fmtP = (v: number | null) => (v == null ? "—" : `${Math.round(v)} g`);
  type Row = (typeof data)[number];
  const tip = tooltipFor<Row>((d) => ({
    title: `Week of ${shortDate(d.week)}`,
    rows: [
      { label: "Avg weight", value: fmtW(d.weight), color: SERIES.s1 },
      { label: "Avg calories", value: fmtC(d.calories), color: SERIES.cal },
      { label: "Avg protein", value: fmtP(d.protein) },
    ],
  }));
  const ws = data.map((d) => d.weight).filter((v): v is number => v != null);
  const min = ws.length ? Math.min(...ws) : 0;
  const max = ws.length ? Math.max(...ws) : 1;
  const pad = Math.max(0.5, (max - min) * 0.15);
  return (
    <ChartFrame
      title="Weekly averages: weight and calories"
      sub="Weeks need ≥4 logged food days and ≥3 weigh-in days to be shown."
      height={340}
      legend={
        <ChartLegend
          items={[
            { key: "w", label: "Avg weight", color: SERIES.s1 },
            { key: "c", label: "Avg calories", color: SERIES.cal, shape: "bar" },
          ]}
        />
      }
      table={<DataTable columns={["Week of", "Avg weight", "Avg calories", "Avg protein"]} rows={[...data].reverse().map((d) => [d.week, fmtW(d.weight), fmtC(d.calories), fmtP(d.protein)])} />}
    >
      <div className="flex h-full flex-col">
        <div className="h-1/2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} syncId="weekly" margin={{ top: 8, right: 12, bottom: 0, left: -4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="week" hide />
              <YAxis domain={[Math.floor(min - pad), Math.ceil(max + pad)]} width={52} allowDecimals={false} {...axisProps} />
              <Tooltip content={tip} cursor={{ stroke: "var(--axis)" }} />
              <Line dataKey="weight" stroke={SERIES.s1} strokeWidth={2} dot={{ r: 4, fill: SERIES.s1, stroke: "var(--chart-surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="h-1/2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} syncId="weekly" margin={{ top: 8, right: 12, bottom: 0, left: -4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="week" tickFormatter={shortDate} interval="preserveStartEnd" minTickGap={16} {...axisProps} />
              <YAxis width={52} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} {...axisProps} />
              <Tooltip content={tip} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="calories" fill={SERIES.cal} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ChartFrame>
  );
}

export function CategoryChart({ data }: { data: { category: string; avgCalories: number; pctCalories: number; pctProtein: number; meals: number }[] }) {
  const tip = tooltipFor<(typeof data)[number]>((d) => ({
    title: d.category,
    rows: [
      { label: "Avg kcal / logged day", value: Math.round(d.avgCalories).toLocaleString(), color: SERIES.cal },
      { label: "Share of calories", value: `${Math.round(d.pctCalories * 100)}%` },
      { label: "Share of protein", value: `${Math.round(d.pctProtein * 100)}%` },
      { label: "Meals logged", value: String(d.meals) },
    ],
  }));
  return (
    <ChartFrame
      title="Where calories come from"
      sub="Average calories per logged day by meal type."
      height={Math.max(140, data.length * 44)}
      table={<DataTable columns={["Meal", "Avg kcal/day", "% calories", "% protein", "Meals"]} rows={data.map((d) => [d.category, Math.round(d.avgCalories), `${Math.round(d.pctCalories * 100)}%`, `${Math.round(d.pctProtein * 100)}%`, d.meals])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" {...axisProps} />
          <YAxis type="category" dataKey="category" width={84} {...axisProps} />
          <Tooltip content={tip} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="avgCalories" fill={SERIES.cal} maxBarSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
