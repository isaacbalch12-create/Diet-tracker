"use client";

import { Archive, Trophy, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, ChartLegend, DataTable, SERIES, shortDate } from "@/components/charts";
import { StreakBadge } from "@/components/kit";
import { Badge, cx, Segmented } from "@/components/ui";
import type { RoutineStatsJ } from "@/lib/client/types";
import { formatLocalDate } from "@/lib/time";
import { KIND_META, pct, SLOT_META, type Slot } from "./shared";

export type SlotStats = RoutineStatsJ["morning"];
export type DayStat = RoutineStatsJ["days"][number];

/** Morning = orange (sun), night = blue — the app's validated categorical slots 2 and 1. */
export const SLOT_COLORS: Record<Slot, string> = { morning: SERIES.s2, night: SERIES.s1 };

const axisProps = { tickLine: false, axisLine: { stroke: "var(--axis)" }, tick: { fontSize: 12 } } as const;
const tickEvery = (n: number) => Math.max(0, Math.ceil(n / 8) - 1);

interface TipRow {
  label: string;
  value: string;
  color?: string;
}

function tip<T>(fmt: (row: T) => { title: string; rows: TipRow[] }) {
  return function renderTip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
    if (!active || !payload?.length || !payload[0].payload) return null;
    const { title, rows } = fmt(payload[0].payload as T);
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
  };
}

const monthLabel = (m: string) => formatLocalDate(`${m}-01`, { month: "short", year: "2-digit" });
const periodLabel = (start: string, by: "week" | "month") => (by === "week" ? `Week of ${shortDate(start)}` : monthLabel(start.slice(0, 7)));
const pctTick = (v: number) => `${v}%`;
const toPct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1000) / 10);

// ---------------------------------------------------------------------------

/** Weekly or monthly share of days with every required activity done (one routine). */
export function CompletionBars({ stats, slot }: { stats: SlotStats; slot: Slot }) {
  const [by, setBy] = useState<"week" | "month">("week");
  const rows = (by === "week" ? stats.weekly : stats.monthly).map((p) => ({ ...p, value: toPct(p.completionPct), avg: toPct(p.avgPct) }));
  type Row = (typeof rows)[number];
  const color = SLOT_COLORS[slot];
  return (
    <ChartFrame
      title={by === "week" ? "Weekly completion" : "Monthly completion"}
      sub="Share of days with every required activity done. Today counts once it's complete."
      height={200}
      actions={
        <Segmented
          label="Group by"
          size="sm"
          value={by}
          onChange={setBy}
          options={[
            { value: "week", label: "Weekly" },
            { value: "month", label: "Monthly" },
          ]}
        />
      }
      table={
        <DataTable
          columns={[by === "week" ? "Week of" : "Month", "Days tracked", "Fully done", "Completion", "Avg done"]}
          rows={[...rows].reverse().map((r) => [by === "week" ? r.start : monthLabel(r.start), r.days, r.complete, pct(r.completionPct), pct(r.avgPct)])}
        />
      }
    >
      {rows.length === 0 ? (
        <p className="flex h-full items-center justify-center text-sm text-muted">No tracked days in this range yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="start" tickFormatter={(s: string) => (by === "week" ? shortDate(s) : monthLabel(s.slice(0, 7)))} interval="preserveStartEnd" minTickGap={16} {...axisProps} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={44} tickFormatter={pctTick} {...axisProps} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={tip<Row>((r) => ({
                title: periodLabel(r.start, by),
                rows: [
                  { label: "Completion", value: pct(r.completionPct), color },
                  { label: "Fully done", value: `${r.complete} of ${r.days} days` },
                  { label: "Avg of required done", value: pct(r.avgPct) },
                ],
              }))}
            />
            <Bar dataKey="value" fill={color} maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------

type DayStatus = "complete" | "partial" | "missed" | "today" | "none";
const DAY_STYLE: Record<DayStatus, { cls: string; label: string }> = {
  complete: { cls: "bg-good", label: "All required done" },
  partial: { cls: "bg-warning", label: "Partly done" },
  missed: { cls: "bg-critical/70", label: "Nothing done" },
  today: { cls: "border-2 border-accent bg-accent-soft", label: "Today, in progress" },
  none: { cls: "border border-dashed border-line-strong", label: "Nothing required" },
};

function dayStatus(d: DayStat, slot: Slot, today: string): DayStatus {
  const p = d[slot];
  if (p.required === 0) return "none";
  if (p.complete) return "complete";
  if (d.date === today) return "today";
  return p.done > 0 ? "partial" : "missed";
}

/** One square per day (oldest first), with a text legend so status never relies on color alone. */
export function DayStrip({ days, slot, today, limit = 91 }: { days: DayStat[]; slot: Slot; today: string; limit?: number }) {
  const shown = days.slice(-limit);
  if (shown.length === 0) return null;
  const used = new Set(shown.map((d) => dayStatus(d, slot, today)));
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted">
        Daily history{days.length > limit ? ` · last ${limit} days` : ""}
      </p>
      <ul className="flex flex-wrap gap-1" aria-label={`${SLOT_META[slot].label} daily history`}>
        {shown.map((d) => {
          const s = dayStatus(d, slot, today);
          const text = `${formatLocalDate(d.date)}: ${DAY_STYLE[s].label}${d[slot].required ? ` (${d[slot].done}/${d[slot].required})` : ""}`;
          return (
            <li key={d.date} title={text} className={cx("size-4 rounded-[4px]", DAY_STYLE[s].cls)}>
              <span className="sr-only">{text}</span>
            </li>
          );
        })}
      </ul>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-2" aria-hidden>
        {(Object.keys(DAY_STYLE) as DayStatus[])
          .filter((s) => used.has(s))
          .map((s) => (
            <li key={s} className="inline-flex items-center gap-1">
              <span className={cx("size-2.5 rounded-[3px]", DAY_STYLE[s].cls)} />
              {DAY_STYLE[s].label}
            </li>
          ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Per-activity completion rates, most consistent first. Today is excluded until tomorrow. */
export function ActivityRates({ stats, slot, compact }: { stats: SlotStats; slot: Slot; compact?: boolean }) {
  const rated = stats.activities.filter((a) => a.rate != null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.eligibleDays - a.eligibleDays);
  const unrated = stats.activities.filter((a) => a.rate == null);
  const best = rated.length >= 2 ? rated[0] : null;
  const worst = rated.length >= 2 && (rated[rated.length - 1].rate ?? 0) < (rated[0].rate ?? 0) ? rated[rated.length - 1] : null;
  const color = SLOT_COLORS[slot];
  if (stats.activities.length === 0) return <p className="text-sm text-muted">No activities in this range.</p>;
  return (
    <div>
      {!compact && (
        <p className="mb-2 text-xs font-medium text-muted">
          By activity <span className="font-normal">· days done of the days it was part of the routine (today not counted yet)</span>
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {rated.map((a) => {
          const Icon = KIND_META[a.kind].icon;
          return (
            <li key={a.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-fg">
                  <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 break-words">{a.title}</span>
                  {!a.required && <Badge tone="outline">Optional</Badge>}
                  {a.archived && (
                    <Badge tone="neutral" title="Removed from the routine; kept for history">
                      <Archive className="size-3" aria-hidden /> Removed
                    </Badge>
                  )}
                  {best?.id === a.id && (
                    <Badge tone="good">
                      <Trophy className="size-3" aria-hidden /> Most consistent
                    </Badge>
                  )}
                  {worst?.id === a.id && (
                    <Badge tone="warning">
                      <TriangleAlert className="size-3" aria-hidden /> Most missed
                    </Badge>
                  )}
                </span>
                <span className="shrink-0 text-fg-2 tabular">
                  {a.doneDays}/{a.eligibleDays} days · <span className="font-semibold text-fg">{pct(a.rate)}</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="meter" aria-label={`${a.title} completion rate`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((a.rate ?? 0) * 100)}>
                <div className="h-full rounded-full" style={{ width: `${(a.rate ?? 0) * 100}%`, background: color }} />
              </div>
            </li>
          );
        })}
      </ul>
      {unrated.length > 0 && <p className="mt-3 text-xs text-muted">New today, no rate yet: {unrated.map((a) => a.title).join(", ")}.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function StreakStat({ stats, label = "Current streak" }: { stats: SlotStats; label?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-fg tabular">
        {stats.streak.current} <span className="text-sm font-normal text-fg-2">day{stats.streak.current === 1 ? "" : "s"}</span>
      </p>
      <div className="mt-0.5">
        <StreakBadge count={stats.streak.longest} unit="days" best={stats.streak.longest} />
        <span className="ml-1 text-xs text-muted">longest</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Morning vs night weekly completion %, one shared percent axis. */
export function SlotsWeeklyChart({ stats }: { stats: RoutineStatsJ }) {
  const [by, setBy] = useState<"week" | "month">("week");
  const pick = (s: SlotStats) => (by === "week" ? s.weekly : s.monthly);
  const keys = [...new Set([...pick(stats.morning), ...pick(stats.night)].map((p) => p.start))].sort();
  const rows = keys.map((start) => {
    const m = pick(stats.morning).find((p) => p.start === start);
    const n = pick(stats.night).find((p) => p.start === start);
    return { start, morning: toPct(m?.completionPct), night: toPct(n?.completionPct), mDays: m ? `${m.complete}/${m.days}` : "—", nDays: n ? `${n.complete}/${n.days}` : "—" };
  });
  type Row = (typeof rows)[number];
  const fmt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
  const dot = (c: string) => ({ r: 4, fill: c, stroke: "var(--chart-surface)", strokeWidth: 2 });
  return (
    <ChartFrame
      title={by === "week" ? "Weekly completion: morning vs night" : "Monthly completion: morning vs night"}
      sub="Share of days with every required activity done."
      height={240}
      legend={
        <ChartLegend
          items={[
            { key: "m", label: "Morning", color: SLOT_COLORS.morning },
            { key: "n", label: "Night", color: SLOT_COLORS.night },
          ]}
        />
      }
      actions={
        <Segmented
          label="Group by"
          size="sm"
          value={by}
          onChange={setBy}
          options={[
            { value: "week", label: "Weekly" },
            { value: "month", label: "Monthly" },
          ]}
        />
      }
      table={<DataTable columns={[by === "week" ? "Week of" : "Month", "Morning", "Days done", "Night", "Days done"]} rows={[...rows].reverse().map((r) => [by === "week" ? r.start : monthLabel(r.start), fmt(r.morning), r.mDays, fmt(r.night), r.nDays])} />}
    >
      {rows.length === 0 ? (
        <p className="flex h-full items-center justify-center text-sm text-muted">No tracked days in this range yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="start" tickFormatter={(s: string) => (by === "week" ? shortDate(s) : monthLabel(s.slice(0, 7)))} interval="preserveStartEnd" minTickGap={16} {...axisProps} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={44} tickFormatter={pctTick} {...axisProps} />
            <Tooltip
              cursor={{ stroke: "var(--axis)" }}
              content={tip<Row>((r) => ({
                title: periodLabel(r.start, by),
                rows: [
                  { label: `Morning (${r.mDays} days)`, value: fmt(r.morning), color: SLOT_COLORS.morning },
                  { label: `Night (${r.nDays} days)`, value: fmt(r.night), color: SLOT_COLORS.night },
                ],
              }))}
            />
            <Line dataKey="morning" stroke={SLOT_COLORS.morning} strokeWidth={2} dot={dot(SLOT_COLORS.morning)} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="night" stroke={SLOT_COLORS.night} strokeWidth={2} dot={dot(SLOT_COLORS.night)} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

/** Daily % of required activities done, morning and night. Days with nothing required are gaps. */
export function SlotsDailyChart({ stats }: { stats: RoutineStatsJ }) {
  const rows = stats.days.map((d) => ({
    date: d.date,
    morning: d.morning.required ? toPct(d.morning.pct) : null,
    night: d.night.required ? toPct(d.night.pct) : null,
    m: d.morning,
    n: d.night,
    reading: d.readingValue || null,
    journaled: [d.journaled.morning && "Morning", d.journaled.night && "Night"].filter(Boolean).join(" + ") || null,
  }));
  type Row = (typeof rows)[number];
  const fmt = (p: Row["m"]) => (p.required ? `${p.done}/${p.required} (${pct(p.pct)})` : "Nothing required");
  const dots = rows.length <= 45;
  const dot = (c: string) => (dots ? { r: 3.5, fill: c, stroke: "var(--chart-surface)", strokeWidth: 1.5 } : false);
  return (
    <ChartFrame
      title="Daily completion"
      sub="Share of required activities done each day."
      height={220}
      legend={
        <ChartLegend
          items={[
            { key: "m", label: "Morning", color: SLOT_COLORS.morning },
            { key: "n", label: "Night", color: SLOT_COLORS.night },
          ]}
        />
      }
      table={<DataTable columns={["Date", "Morning", "Night", "Reading", "Journaled"]} rows={[...rows].reverse().map((r) => [r.date, fmt(r.m), fmt(r.n), r.reading, r.journaled])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} interval={tickEvery(rows.length)} minTickGap={16} {...axisProps} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={44} tickFormatter={pctTick} {...axisProps} />
          <Tooltip
            cursor={{ stroke: "var(--axis)" }}
            content={tip<Row>((r) => ({
              title: formatLocalDate(r.date, { weekday: "short", month: "short", day: "numeric" }),
              rows: [
                { label: "Morning", value: fmt(r.m), color: SLOT_COLORS.morning },
                { label: "Night", value: fmt(r.n), color: SLOT_COLORS.night },
              ],
            }))}
          />
          <Line dataKey="morning" stroke={SLOT_COLORS.morning} strokeWidth={2} dot={dot(SLOT_COLORS.morning)} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="night" stroke={SLOT_COLORS.night} strokeWidth={2} dot={dot(SLOT_COLORS.night)} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
