"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, Rectangle, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarShapeProps } from "recharts";
import { ChartFrame, ChartLegend, DataTable, type LegendItem } from "@/components/charts";
import { statusLabel } from "@/components/kit";
import { Segmented } from "@/components/ui";
import type { GoalJ2 } from "@/lib/client/types";
import { toDisplay, type UnitPrefs } from "@/lib/client/units";
import { CATEGORY_META, fmtPeriodValue, fmtTarget, rangeLabel, shortDay, valueUnit, type GoalPeriodJ } from "./labels";

interface Row {
  start: string;
  value: number | null;
  target: number | null;
  targetMax: number | null;
  period: GoalPeriodJ;
}

const axisProps = { tickLine: false, axisLine: { stroke: "var(--axis)" }, tick: { fontSize: 12 } } as const;

function barColor(status: GoalPeriodJ["status"] | undefined, accent: string): string {
  if (status === "met") return "var(--good)";
  if (status === "missed") return "var(--critical)";
  if (status === "in_progress") return accent;
  return "var(--muted)";
}

type Range = "30" | "90" | "all";

/**
 * One bar (or point, for level/trend goals) per period, with the target that
 * applied in each period as a dashed line — two lines for ranges.
 */
export function GoalHistoryChart({ goal, prefs }: { goal: GoalJ2; prefs: UnitPrefs }) {
  const unit = valueUnit(goal);
  const all = goal.recent.filter((p) => p.status !== "upcoming");
  const daily = goal.period === "daily";
  const [range, setRange] = useState<Range>(daily && all.length > 90 ? "90" : "all");
  const shown = range === "all" ? all : all.slice(-Number(range));
  const accent = CATEGORY_META[goal.category].color;
  const isRange = goal.comparator === "range";
  const lineMode = goal.aggregation === "level" || goal.aggregation === "rate";
  const conv = (v: number | null) => (v == null ? null : toDisplay(v, unit, prefs));
  const rows: Row[] = shown.map((p) => {
    const lo = isRange ? Math.min(p.target, p.targetMax ?? p.target) : p.target;
    const hi = isRange ? Math.max(p.target, p.targetMax ?? p.target) : null;
    return { start: p.start, value: conv(p.value), target: conv(lo), targetMax: conv(hi), period: p };
  });
  const constant = rows.every((r) => r.target === rows[0]?.target && r.targetMax === rows[0]?.targetMax);
  const nums = rows.flatMap((r) => [r.value, r.target, r.targetMax]).filter((v): v is number => v != null);
  const lo = nums.length ? Math.min(...nums) : 0;
  const hi = nums.length ? Math.max(...nums) : 1;
  const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.02, 0.1);
  const domain: [number, number] = lineMode ? [lo - pad, hi + pad] : [Math.min(0, lo), hi + pad];
  const tick = (v: number) => {
    if (unit === "min") return `${Number(v.toFixed(1))}h`;
    if (unit === "fraction") return `${Math.round(v)}%`;
    if (Math.abs(v) >= 10_000) return `${Number((v / 1000).toFixed(1))}k`;
    return String(Number(v.toFixed(Math.abs(v) < 10 ? 2 : 0)));
  };
  const renderTip = ({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
    const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
    if (!row) return null;
    const p = row.period;
    return (
      <div className="min-w-44 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
        <p className="mb-1 font-medium text-fg">{rangeLabel(p)}</p>
        <p className="flex justify-between gap-4 text-fg-2">
          Value <span className="font-medium text-fg tabular">{fmtPeriodValue(goal, p.value, prefs)}</span>
        </p>
        <p className="flex justify-between gap-4 text-fg-2">
          Target <span className="font-medium text-fg tabular">{fmtTarget(goal, p.target, p.targetMax, prefs)}</span>
        </p>
        <p className="flex justify-between gap-4 text-fg-2">
          Status <span className="font-medium text-fg">{statusLabel(p.status)}</span>
        </p>
      </div>
    );
  };
  const legend: LegendItem[] = lineMode
    ? [
        { key: "v", label: goal.aggregation === "rate" ? "Weekly trend" : "Value", color: accent, shape: "dot" },
        { key: "t", label: isRange ? "Target range" : "Target", color: "var(--muted)", shape: "dash" },
      ]
    : [
        { key: "met", label: "Met", color: "var(--good)", shape: "bar" },
        { key: "missed", label: "Missed", color: "var(--critical)", shape: "bar" },
        { key: "cur", label: "In progress", color: accent, shape: "bar" },
        { key: "t", label: isRange ? "Target range" : "Target", color: "var(--muted)", shape: "dash" },
      ];
  const unitWord = goal.period === "daily" ? "day" : goal.period === "weekly" ? "week" : goal.period === "monthly" ? "month" : "period";
  return (
    <ChartFrame
      title="History"
      sub={`One ${lineMode ? "point" : "bar"} per ${unitWord}; the dashed line is the target in force at the time. Periods without data are blank.`}
      height={240}
      legend={<ChartLegend items={legend} />}
      actions={
        daily && all.length > 30 ? (
          <Segmented<Range>
            label="History range"
            size="sm"
            value={range}
            onChange={setRange}
            options={[
              { value: "30", label: "30d" },
              { value: "90", label: "90d" },
              { value: "all", label: "All" },
            ]}
          />
        ) : undefined
      }
      table={<DataTable columns={["Period", "Value", "Target", "Status"]} rows={[...shown].reverse().map((p) => [rangeLabel(p), fmtPeriodValue(goal, p.value, prefs), fmtTarget(goal, p.target, p.targetMax, prefs), statusLabel(p.status)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="start" tickFormatter={shortDay} interval="preserveStartEnd" minTickGap={20} {...axisProps} />
          <YAxis width={52} domain={domain} tickFormatter={tick} allowDataOverflow={false} {...axisProps} />
          <Tooltip content={renderTip} cursor={lineMode ? { stroke: "var(--axis)" } : { fill: "var(--surface-2)" }} />
          {lo < 0 && <ReferenceLine y={0} stroke="var(--axis)" />}
          {lineMode ? (
            <Line dataKey="value" stroke={accent} strokeWidth={2} dot={{ r: 3.5, fill: accent, stroke: "var(--chart-surface)", strokeWidth: 1.5 }} connectNulls={false} isAnimationActive={false} />
          ) : (
            <Bar
              dataKey="value"
              maxBarSize={28}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
              shape={(props: BarShapeProps) => <Rectangle {...props} fill={barColor(rows[props.index]?.period.status, accent)} />}
            />
          )}
          {constant && rows[0]?.target != null && <ReferenceLine y={rows[0].target} stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} />}
          {constant && rows[0]?.targetMax != null && <ReferenceLine y={rows[0].targetMax} stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} />}
          {!constant && <Line type="stepAfter" dataKey="target" stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          {!constant && isRange && <Line type="stepAfter" dataKey="targetMax" stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
