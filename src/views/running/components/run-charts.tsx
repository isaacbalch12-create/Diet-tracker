"use client";

import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, ChartLegend, DataTable, SERIES, shortDate } from "@/components/charts";
import { fmtNum } from "@/lib/client/units";
import type { DistanceUnit } from "@/lib/running/stats";
import type { RunningJ } from "@/lib/client/types";
import { axisProps, longDate, monthLabel, monthLong, tickEvery, tooltipFor, type TooltipRow } from "./chart-kit";
import { distIn, effortText, RUN_COLOR, type RunEntryJ } from "./run-meta";

type Bucket = RunningJ["weekly"][number];

const fmtD = (v: number | null, unit: DistanceUnit) => (v == null ? "—" : `${fmtNum(v, 2)} ${unit}`);

function noDistanceNote(buckets: Bucket[]): string | null {
  const runs = buckets.reduce((a, b) => a + b.runs, 0);
  const dist = buckets.reduce((a, b) => a + b.distanceM, 0);
  if (runs > 0 && dist === 0) return "None of these runs has a distance recorded, so totals show 0.";
  return null;
}

export function DistanceBarsChart({ buckets, unit, period, height = 220 }: { buckets: Bucket[]; unit: DistanceUnit; period: "week" | "month"; height?: number }) {
  const data = buckets.map((b) => ({ key: b.start, distance: distIn(b.distanceM, unit) ?? 0, runs: b.runs, runDays: b.runDays }));
  const label = (k: string) => (period === "week" ? shortDate(k) : monthLabel(k));
  const title = period === "week" ? "Weekly distance" : "Monthly distance";
  const tip = tooltipFor<(typeof data)[number]>((d) => ({
    title: period === "week" ? `Week of ${longDate(d.key)}` : monthLong(d.key),
    rows: [
      { label: "Distance", value: fmtD(d.distance, unit), color: RUN_COLOR },
      { label: "Runs", value: String(d.runs) },
      { label: "Days with a run", value: String(d.runDays) },
    ],
  }));
  const note = noDistanceNote(buckets);
  return (
    <ChartFrame
      title={title}
      sub={note ?? (period === "week" ? "Total distance per week. The first and current weeks may be partial." : "Total distance per calendar month. The first and current months may be partial.")}
      height={height}
      table={<DataTable columns={[period === "week" ? "Week of" : "Month", "Distance", "Runs", "Run days"]} rows={[...data].reverse().map((d) => [period === "week" ? d.key : monthLong(d.key), fmtD(d.distance, unit), d.runs, d.runDays])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="key" tickFormatter={label} interval="preserveStartEnd" minTickGap={16} {...axisProps} />
          <YAxis width={44} allowDecimals tickFormatter={(v: number) => fmtNum(v, 1)} {...axisProps} />
          <Tooltip content={tip} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="distance" name={`Distance (${unit})`} fill={RUN_COLOR} maxBarSize={36} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function RunDaysPerWeekChart({ weekly, height = 200 }: { weekly: Bucket[]; height?: number }) {
  const data = weekly.map((w) => ({ key: w.start, runDays: w.runDays, runs: w.runs }));
  const tip = tooltipFor<(typeof data)[number]>((d) => ({
    title: `Week of ${longDate(d.key)}`,
    rows: [
      { label: "Days with a run", value: `${d.runDays} of 7`, color: RUN_COLOR },
      { label: "Runs", value: String(d.runs) },
    ],
  }));
  return (
    <ChartFrame
      title="Run days per week"
      sub="Days with at least one run. Planned rest days are part of a healthy week. The first and current weeks may be partial."
      height={height}
      table={<DataTable columns={["Week of", "Run days", "Runs"]} rows={[...data].reverse().map((d) => [d.key, d.runDays, d.runs])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="key" tickFormatter={shortDate} interval="preserveStartEnd" minTickGap={16} {...axisProps} />
          <YAxis width={40} domain={[0, 7]} ticks={[0, 2, 4, 6, 7]} allowDecimals={false} {...axisProps} />
          <Tooltip content={tip} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="runDays" name="Run days" fill={RUN_COLOR} maxBarSize={36} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

interface ProgressPoint {
  i: number;
  date: string;
  distance: number;
  avg: number | null;
  type: string | null;
  effort: number | null;
}

/** Distance of each run with a recorded distance, oldest first, with a 7-run average. */
export function RunProgressionChart({ entries, unit, minDistanceM, height = 240 }: { entries: RunEntryJ[]; unit: DistanceUnit; minDistanceM: number | null; height?: number }) {
  const runs = entries.filter((e) => e.kind === "run" && e.distanceM != null).sort((a, b) => a.localDate.localeCompare(b.localDate) || a.loggedAt.localeCompare(b.loggedAt));
  const data: ProgressPoint[] = runs.map((r, i) => {
    const win = runs.slice(Math.max(0, i - 6), i + 1).map((x) => x.distanceM ?? 0);
    return { i, date: r.localDate, distance: distIn(r.distanceM, unit) ?? 0, avg: win.length >= 3 ? distIn(win.reduce((a, b) => a + b, 0) / win.length, unit) : null, type: r.runType, effort: r.effort };
  });
  const min = distIn(minDistanceM, unit);
  const tip = tooltipFor<ProgressPoint>((d) => ({
    title: longDate(d.date),
    rows: [
      { label: "Distance", value: fmtD(d.distance, unit), color: RUN_COLOR },
      d.avg != null && { label: "7-run average", value: fmtD(d.avg, unit), color: SERIES.neutral },
      d.type && { label: "Type", value: d.type },
    ].filter(Boolean) as TooltipRow[],
    footer: effortText(d.effort),
  }));
  return (
    <ChartFrame
      title="Distance per run"
      sub="Each dot is a run with a distance (runs logged without one are left out). The line is the average of the last 7 runs."
      height={height}
      legend={
        data.length >= 2 ? (
          <ChartLegend
            items={[
              { key: "d", label: "Run distance", color: RUN_COLOR, shape: "dot" },
              { key: "a", label: "7-run average", color: SERIES.neutral },
              ...(min ? [{ key: "m", label: "Daily minimum", color: SERIES.muted, shape: "dash" as const }] : []),
            ]}
          />
        ) : undefined
      }
      table={<DataTable columns={["Date", "Distance", "Type", "Effort"]} rows={[...data].reverse().map((d) => [d.date, fmtD(d.distance, unit), d.type, d.effort != null ? `${d.effort}/10` : null])} />}
    >
      {data.length < 2 ? (
        <div className="flex h-full items-center justify-center text-center text-sm text-muted">Log at least two runs with a distance to see your progression.</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="i" type="number" domain={[0, Math.max(1, data.length - 1)]} tickFormatter={(i: number) => (data[Math.round(i)] ? shortDate(data[Math.round(i)].date) : "")} interval={tickEvery(data.length)} allowDecimals={false} {...axisProps} />
            <YAxis width={44} tickFormatter={(v: number) => fmtNum(v, 1)} {...axisProps} />
            <Tooltip content={tip} cursor={{ stroke: "var(--axis)" }} />
            {min != null && <ReferenceLine y={min} stroke={SERIES.muted} strokeDasharray="5 4" />}
            <Line dataKey="distance" stroke={RUN_COLOR} strokeOpacity={0.35} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="avg" stroke={SERIES.neutral} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Scatter dataKey="distance" fill={RUN_COLOR} stroke="var(--chart-surface)" strokeWidth={2} r={4.5} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
