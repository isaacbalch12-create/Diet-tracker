"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, ChartLegend, DataTable, SERIES, shortDate, type LegendItem } from "@/components/charts";
import { Card, CardTitle, Segmented } from "@/components/ui";
import type { VitalsJ } from "@/lib/client/types";
import { formatSleepMinutes } from "@/lib/health/metrics";
import { formatTimeInZone } from "@/lib/time";
import { axisProps, compact, longDate, monthLong, tickEvery, tooltipFor, type TooltipRow } from "@/views/running/components/chart-kit";
import { fmtMetric, fmtTrend, HEALTH_COLORS, hasValue, METRIC_KEYS, METRIC_LABEL, rolling7, scoreProvider, sleepInfo, sourceText, type MetricJ, type MetricKey } from "./health-utils";

function coverage(m: MetricJ): string {
  return `${m.loggedDays} of ${m.days.length} days have data`;
}

function altText(alts: { sourceLabel: string; value: number }[], k: MetricKey): string | null {
  if (!alts.length) return null;
  return `Also reported: ${alts.map((a) => `${fmtMetric(k, a.value)} (${a.sourceLabel})`).join(", ")}`;
}

// ---------- Steps ----------

interface StepRow {
  date: string;
  steps: number | null;
  avg7: number | null;
  source: string | null;
  alts: string | null;
}

export function StepsChart({ metric, goal, height = 260 }: { metric: MetricJ; goal: number | null; height?: number }) {
  const avg = rolling7(metric.days);
  const data: StepRow[] = metric.days.map((d, i) => ({
    date: d.date,
    steps: d.value,
    avg7: avg[i] == null ? null : Math.round(avg[i] as number),
    source: hasValue(d) ? sourceText(d) : null,
    alts: hasValue(d) ? altText(d.alternatives, "steps") : null,
  }));
  const tip = tooltipFor<StepRow>((d) => ({
    title: longDate(d.date),
    rows: [
      { label: "Steps", value: d.steps == null ? "No data" : fmtMetric("steps", d.steps), color: HEALTH_COLORS.steps },
      d.avg7 != null && { label: "7-day average", value: fmtMetric("steps", d.avg7), color: SERIES.neutral },
      goal != null && { label: "Goal", value: fmtMetric("steps", goal) },
    ].filter(Boolean) as TooltipRow[],
    footer: [d.source, d.alts].filter(Boolean).join(" · ") || null,
  }));
  const legend: LegendItem[] = [
    { key: "s", label: "Daily steps", color: HEALTH_COLORS.steps, shape: "bar" },
    { key: "a", label: "7-day average", color: SERIES.neutral },
    ...(goal != null ? [{ key: "g", label: "Goal", color: SERIES.muted, shape: "dash" as const }] : []),
  ];
  return (
    <ChartFrame
      title="Steps"
      sub={`${coverage(metric)}. Days without data are blank, not zero. The 7-day average needs 3+ days in the window.`}
      height={height}
      legend={<ChartLegend items={legend} />}
      table={<DataTable columns={["Date", "Steps", "7-day avg", "Source"]} rows={[...data].reverse().map((d) => [d.date, d.steps == null ? null : fmtMetric("steps", d.steps), d.avg7 == null ? null : fmtMetric("steps", d.avg7), d.source])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(data.length)} minTickGap={16} {...axisProps} />
          <YAxis width={44} domain={[0, (max: number) => Math.ceil(Math.max(max, goal ?? 0) * 1.05)]} tickFormatter={compact} {...axisProps} />
          <Tooltip content={tip} cursor={{ fill: "var(--surface-2)" }} />
          {goal != null && <ReferenceLine y={goal} stroke={SERIES.muted} strokeDasharray="5 4" ifOverflow="extendDomain" />}
          <Bar dataKey="steps" fill={HEALTH_COLORS.steps} maxBarSize={20} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Line dataKey="avg7" stroke={SERIES.neutral} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------- Sleep ----------

interface SleepRow {
  date: string;
  total: number | null;
  deep: number | null;
  core: number | null;
  rem: number | null;
  unstaged: number | null;
  /** Minutes, for tooltips and tables. */
  min: { total: number | null; deep: number | null; core: number | null; rem: number | null; unstaged: number | null; awake: number | null; inBed: number | null };
  window: string | null;
  source: string | null;
}

const toH = (m: number | null | undefined) => (m == null ? null : Math.round((m / 60) * 100) / 100);

function sleepRows(metric: MetricJ, tz: string): SleepRow[] {
  return metric.days.map((d) => {
    const empty = { total: null, deep: null, core: null, rem: null, unstaged: null, awake: null, inBed: null };
    if (!hasValue(d)) return { date: d.date, total: null, deep: null, core: null, rem: null, unstaged: null, min: empty, window: null, source: null };
    const info = sleepInfo(d.details);
    const st = info?.stages ?? null;
    const staged = st ? (st.deep ?? 0) + (st.core ?? 0) + (st.rem ?? 0) : 0;
    const rest = st ? Math.max(0, d.value - staged) : d.value;
    const unstaged = st ? (rest >= 1 ? rest : null) : d.value;
    let window: string | null = null;
    try {
      window = info?.start && info?.end ? `${formatTimeInZone(info.start, tz)} – ${formatTimeInZone(info.end, tz)}` : null;
    } catch {
      window = null;
    }
    return {
      date: d.date,
      total: toH(d.value),
      deep: toH(st?.deep),
      core: toH(st?.core),
      rem: toH(st?.rem),
      unstaged: toH(unstaged),
      min: { total: d.value, deep: st?.deep ?? null, core: st?.core ?? null, rem: st?.rem ?? null, unstaged: st ? unstaged : null, awake: st?.awake ?? null, inBed: info?.inBedMinutes ?? null },
      window,
      source: sourceText(d),
    };
  });
}

export function SleepChart({ metric, goalMin, tz, height = 260 }: { metric: MetricJ; goalMin: number | null; tz: string; height?: number }) {
  const data = sleepRows(metric, tz);
  const staged = data.some((r) => r.deep != null || r.core != null || r.rem != null);
  const goalH = toH(goalMin);
  const fm = (m: number | null) => (m == null ? null : formatSleepMinutes(m));
  const tip = tooltipFor<SleepRow>((d) => ({
    title: `Night ending ${longDate(d.date)}`,
    rows:
      d.min.total == null
        ? []
        : ([
            { label: "Asleep", value: formatSleepMinutes(d.min.total), color: staged ? undefined : HEALTH_COLORS.sleep },
            d.min.deep != null && { label: "Deep", value: formatSleepMinutes(d.min.deep), color: HEALTH_COLORS.deep },
            d.min.core != null && { label: "Core / light", value: formatSleepMinutes(d.min.core), color: HEALTH_COLORS.core },
            d.min.rem != null && { label: "REM", value: formatSleepMinutes(d.min.rem), color: HEALTH_COLORS.rem },
            d.min.unstaged != null && { label: "Asleep (no stage)", value: formatSleepMinutes(d.min.unstaged), color: HEALTH_COLORS.unstaged },
            d.min.awake != null && { label: "Awake", value: formatSleepMinutes(d.min.awake) },
            d.min.inBed != null && { label: "In bed", value: formatSleepMinutes(d.min.inBed) },
          ].filter(Boolean) as TooltipRow[]),
    footer: [d.window, d.source].filter(Boolean).join(" · ") || null,
  }));
  const legend: LegendItem[] = staged
    ? [
        { key: "deep", label: "Deep", color: HEALTH_COLORS.deep, shape: "bar" },
        { key: "core", label: "Core / light", color: HEALTH_COLORS.core, shape: "bar" },
        { key: "rem", label: "REM", color: HEALTH_COLORS.rem, shape: "bar" },
        { key: "un", label: "No stage data", color: HEALTH_COLORS.unstaged, shape: "bar" },
      ]
    : [{ key: "t", label: "Time asleep", color: HEALTH_COLORS.sleep, shape: "bar" }];
  if (goalH != null) legend.push({ key: "g", label: "Goal", color: SERIES.muted, shape: "dash" });
  return (
    <ChartFrame
      title="Sleep"
      sub={`${coverage(metric)}. Hours asleep for the night ending on each day${staged ? ", split by stage where your device recorded stages" : ""}. Awake time isn't included in the bar.`}
      height={height}
      legend={<ChartLegend items={legend} />}
      table={
        <DataTable
          columns={["Night ending", "Asleep", "Deep", "Core", "REM", "Awake", "In bed", "Source"]}
          rows={[...data].reverse().map((d) => [d.date, fm(d.min.total), fm(d.min.deep), fm(d.min.core), fm(d.min.rem), fm(d.min.awake), fm(d.min.inBed), d.source])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(data.length)} minTickGap={16} {...axisProps} />
          <YAxis width={40} domain={[0, (max: number) => Math.ceil(Math.max(max, goalH ?? 0, 4) + 0.5)]} allowDecimals={false} tickFormatter={(v: number) => `${v}h`} {...axisProps} />
          <Tooltip content={tip} cursor={{ fill: "var(--surface-2)" }} />
          {goalH != null && <ReferenceLine y={goalH} stroke={SERIES.muted} strokeDasharray="5 4" />}
          {staged ? (
            <>
              <Bar dataKey="deep" stackId="s" fill={HEALTH_COLORS.deep} maxBarSize={20} isAnimationActive={false} />
              <Bar dataKey="core" stackId="s" fill={HEALTH_COLORS.core} maxBarSize={20} isAnimationActive={false} />
              <Bar dataKey="rem" stackId="s" fill={HEALTH_COLORS.rem} maxBarSize={20} isAnimationActive={false} />
              <Bar dataKey="unstaged" stackId="s" fill={HEALTH_COLORS.unstaged} maxBarSize={20} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </>
          ) : (
            <Bar dataKey="total" fill={HEALTH_COLORS.sleep} maxBarSize={20} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------- Sleep score and other daily vitals ----------

interface LineRow {
  date: string;
  value: number | null;
  source: string | null;
}

export function VitalLineChart({ metric, k, title, sub, color, height = 220, domain }: { metric: MetricJ; k: MetricKey; title: string; sub?: string; color: string; height?: number; domain?: [number, number] }) {
  const data: LineRow[] = metric.days.map((d) => ({ date: d.date, value: d.value, source: hasValue(d) ? (k === "sleep_score" ? `${scoreProvider(d) ?? "Unknown provider"} · ${d.sourceLabel}` : sourceText(d)) : null }));
  const vals = data.map((d) => d.value).filter((v): v is number => v != null);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const pad = Math.max(1, (hi - lo) * 0.15);
  const dom: [number, number] = domain ?? [Math.max(0, Math.floor(lo - pad)), Math.ceil(hi + pad)];
  const tip = tooltipFor<LineRow>((d) => ({ title: longDate(d.date), rows: d.value == null ? [] : [{ label: METRIC_LABEL[k], value: fmtMetric(k, d.value), color }], footer: d.source }));
  const dense = data.length > 60;
  return (
    <ChartFrame
      title={title}
      sub={`${sub ? `${sub} ` : ""}${coverage(metric)}.`}
      height={height}
      table={<DataTable columns={["Date", METRIC_LABEL[k], "Source"]} rows={[...data].reverse().filter((d) => d.value != null).map((d) => [d.date, fmtMetric(k, d.value), d.source])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(data.length)} minTickGap={16} {...axisProps} />
          <YAxis width={44} domain={dom} allowDecimals={false} tickFormatter={compact} {...axisProps} />
          <Tooltip content={tip} cursor={{ stroke: "var(--axis)" }} />
          <Line dataKey="value" stroke={color} strokeWidth={2} dot={{ r: dense ? 2.5 : 4, fill: color, stroke: "var(--chart-surface)", strokeWidth: dense ? 1 : 2 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function SleepScoreChart({ metric, height }: { metric: MetricJ; height?: number }) {
  const providers = [...new Set(metric.days.filter(hasValue).map((d) => scoreProvider(d) ?? "unknown provider"))];
  return <VitalLineChart metric={metric} k="sleep_score" title="Sleep score" color={HEALTH_COLORS.score} height={height} domain={[0, 100]} sub={`Scores calculated by ${providers.join(", ")} — this app never calculates one.`} />;
}

// ---------- Averages ----------

type View = "summary" | "weekly" | "monthly";

export function AveragesCard({ vitals }: { vitals: VitalsJ }) {
  const [view, setView] = useState<View>("summary");
  const keys = METRIC_KEYS.filter((k) => (vitals.metrics[k]?.loggedDays ?? 0) > 0);
  if (!keys.length) return null;
  const withDays = (k: MetricKey, v: number | null | undefined, n: number) => (v == null ? null : `${fmtMetric(k, v)} (${n}d)`);

  let table: { columns: string[]; rows: (string | number | null)[][] };
  if (view === "summary") {
    table = {
      columns: ["Metric", "Daily average", "Days with data", "Lowest – highest", "Trend"],
      rows: keys.map((k) => {
        const m = vitals.metrics[k];
        return [METRIC_LABEL[k], fmtMetric(k, m.average), `${m.loggedDays} of ${m.days.length}`, m.min == null ? null : `${fmtMetric(k, m.min)} – ${fmtMetric(k, m.max)}`, m.trendPerWeek == null ? "Needs 7+ days" : fmtTrend(k, m.trendPerWeek)];
      }),
    };
  } else {
    const starts = [...new Set(keys.flatMap((k) => (view === "weekly" ? vitals.metrics[k].weekly.map((w) => w.start) : vitals.metrics[k].monthly.map((w) => w.month))))].sort().reverse();
    const showStepTotal = keys.includes("steps");
    table = {
      columns: [view === "weekly" ? "Week of" : "Month", ...keys.map((k) => `${METRIC_LABEL[k]} (avg/day)`), ...(showStepTotal ? ["Steps (total)"] : [])],
      rows: starts.map((s) => {
        const cells = keys.map((k) => {
          const m = vitals.metrics[k];
          const b = view === "weekly" ? m.weekly.find((w) => w.start === s) : m.monthly.find((w) => w.month === s);
          return b ? withDays(k, b.average, b.days) : null;
        });
        const stepB = showStepTotal ? (view === "weekly" ? vitals.metrics.steps.weekly.find((w) => w.start === s) : vitals.metrics.steps.monthly.find((w) => w.month === s)) : null;
        return [view === "weekly" ? s : monthLong(s), ...cells, ...(showStepTotal ? [stepB ? fmtMetric("steps", stepB.total) : null] : [])];
      }),
    };
  }

  return (
    <Card>
      <CardTitle sub="Averages use only days with data — missing days are skipped, never counted as zero. (n d) = days with data in that period. Trend = linear fit of daily values (an estimate).">Averages</CardTitle>
      <div className="mb-3">
        <Segmented<View>
          label="Averages view"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "summary", label: "Summary" },
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
          ]}
        />
      </div>
      <div className="max-h-96 overflow-auto">
        <DataTable columns={table.columns} rows={table.rows} />
      </div>
    </Card>
  );
}
