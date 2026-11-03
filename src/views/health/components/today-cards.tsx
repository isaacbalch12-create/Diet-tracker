"use client";

import { BedDouble, Footprints, Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ProgressRing, SourceLine } from "@/components/kit";
import { Card, CardTitle } from "@/components/ui";
import type { GoalJ2 } from "@/lib/client/types";
import { formatSleepMinutes } from "@/lib/health/metrics";
import { addDays, formatLocalDate, formatTimeInZone } from "@/lib/time";
import { dayValue, fmtMetric, HEALTH_COLORS, latest, rolling7, scoreProvider, sleepInfo, type MetricJ, type MetricKey, type SleepStages, type ValueDay } from "./health-utils";

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return formatLocalDate(date, { weekday: "short", month: "short", day: "numeric" });
}

function Alternatives({ d, k }: { d: ValueDay; k: MetricKey }) {
  if (!d.alternatives.length) return null;
  return <p className="text-[11px] text-muted">Also reported: {d.alternatives.map((a) => `${fmtMetric(k, a.value)} (${a.sourceLabel})`).join(", ")}</p>;
}

function GoalRing({ value, target, color, label, children }: { value: number | null; target: number; color: string; label: string; children: ReactNode }) {
  return (
    <ProgressRing value={value == null ? null : value / target} size={76} stroke={7} color={color} label={label}>
      <span className="text-center text-[11px] leading-tight">{children}</span>
    </ProgressRing>
  );
}

export function StepsTodayCard({ metric, today, goal }: { metric: MetricJ | null; today: string; goal: GoalJ2 | null }) {
  const todayV = dayValue(metric, today);
  const yesterday = dayValue(metric, addDays(today, -1));
  const last = latest(metric);
  // Today is still in progress, so the average covers the 7 days before it.
  const avg = metric ? (rolling7(metric.days.filter((d) => d.date < today)).at(-1) ?? null) : null;
  const target = goal?.targetValue ?? null;
  const pct = todayV && target ? Math.round((todayV.value / target) * 100) : null;
  return (
    <Card>
      <CardTitle
        sub={todayV ? "So far today" : last ? `Nothing synced yet today · latest ${dayLabel(last.date, today).toLowerCase()}` : undefined}
        action={
          target ? (
            <GoalRing value={todayV?.value ?? null} target={target} color={HEALTH_COLORS.steps} label={`Steps: ${pct ?? 0}% of ${fmtMetric("steps", target)} goal`}>
              {pct != null ? `${pct}%` : "—"}
            </GoalRing>
          ) : undefined
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Footprints className="size-4" style={{ color: HEALTH_COLORS.steps }} aria-hidden /> Steps
        </span>
      </CardTitle>
      <p className="text-4xl font-semibold tracking-tight text-fg tabular">{todayV ? fmtMetric("steps", todayV.value) : <span className="text-2xl text-muted">No data today</span>}</p>
      <p className="mt-1 text-sm text-fg-2">
        {target ? (
          todayV ? (
            todayV.value >= target ? (
              `Goal of ${fmtMetric("steps", target)} reached`
            ) : (
              `${fmtMetric("steps", target - todayV.value)} to go of ${fmtMetric("steps", target)}`
            )
          ) : (
            `Goal ${fmtMetric("steps", target)} steps`
          )
        ) : (
          <>
            No daily step goal.{" "}
            <Link href="/goals?new=1" className="text-accent hover:underline">
              Set one
            </Link>
          </>
        )}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
        <div>
          <p className="text-xs text-muted">Yesterday</p>
          <p className="font-medium text-fg tabular">{yesterday ? fmtMetric("steps", yesterday.value) : <span className="text-muted">No data</span>}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Avg, previous 7 days</p>
          <p className="font-medium text-fg tabular">{avg != null ? fmtMetric("steps", avg) : <span className="text-muted">Need 3+ days</span>}</p>
        </div>
      </div>
      {(todayV ?? last) && (
        <div className="mt-2">
          <SourceLine label={(todayV ?? last)!.sourceLabel} origin={(todayV ?? last)!.origin} syncedAt={(todayV ?? last)!.syncedAt} />
          <Alternatives d={(todayV ?? last)!} k="steps" />
        </div>
      )}
    </Card>
  );
}

const STAGE_ROWS: { key: keyof SleepStages; label: string; color: string }[] = [
  { key: "deep", label: "Deep", color: HEALTH_COLORS.deep },
  { key: "core", label: "Core / light", color: HEALTH_COLORS.core },
  { key: "rem", label: "REM", color: HEALTH_COLORS.rem },
  { key: "awake", label: "Awake", color: HEALTH_COLORS.awake },
];

export function StageBar({ stages }: { stages: SleepStages }) {
  const rows = STAGE_ROWS.map((r) => ({ ...r, min: stages[r.key] ?? 0 })).filter((r) => r.min > 0);
  if (stages.unspecified && stages.unspecified > 0) rows.push({ key: "unspecified", label: "No stage", color: HEALTH_COLORS.unstaged, min: stages.unspecified });
  const total = rows.reduce((a, r) => a + r.min, 0);
  if (!total) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Sleep stages: ${rows.map((r) => `${r.label} ${formatSleepMinutes(r.min)}`).join(", ")}`}>
        {rows.map((r) => (
          <div key={r.key} style={{ width: `${(r.min / total) * 100}%`, background: r.color }} />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-fg-2 sm:grid-cols-4">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: r.color }} aria-hidden />
            {r.label} <span className="font-medium text-fg tabular">{formatSleepMinutes(r.min)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SleepCard({ sleep, score, today, goal, tz }: { sleep: MetricJ | null; score: MetricJ | null; today: string; goal: GoalJ2 | null; tz: string }) {
  const night = dayValue(sleep, today) ?? latest(sleep);
  const isRecent = night && night.date >= addDays(today, -1);
  const info = night ? sleepInfo(night.details) : null;
  const scoreDay = night ? dayValue(score, night.date) : null;
  const target = goal?.targetValue ?? null;
  const pct = night && target ? Math.round((night.value / target) * 100) : null;
  let window: string | null = null;
  try {
    window = info?.start && info?.end ? `${formatTimeInZone(info.start, tz)} – ${formatTimeInZone(info.end, tz)}` : null;
  } catch {
    window = null;
  }
  return (
    <Card>
      <CardTitle
        sub={night ? (night.date === today ? "Last night" : `Night ending ${dayLabel(night.date, today).toLowerCase()}${isRecent ? "" : " · nothing newer synced"}`) : undefined}
        action={
          target ? (
            <GoalRing value={night?.value ?? null} target={target} color={HEALTH_COLORS.sleep} label={`Sleep: ${pct ?? 0}% of ${formatSleepMinutes(target)} goal`}>
              {pct != null ? `${pct}%` : "—"}
            </GoalRing>
          ) : undefined
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <BedDouble className="size-4" style={{ color: HEALTH_COLORS.sleep }} aria-hidden /> Sleep
        </span>
      </CardTitle>
      {night ? (
        <>
          <p className="text-4xl font-semibold tracking-tight text-fg tabular">
            {formatSleepMinutes(night.value)} <span className="text-base font-normal text-muted">asleep</span>
          </p>
          <p className="mt-1 text-sm text-fg-2">
            {[info?.inBedMinutes != null ? `${formatSleepMinutes(info.inBedMinutes)} in bed` : null, window, target ? `goal ${formatSleepMinutes(target)}` : null].filter(Boolean).join(" · ") || "No in-bed time reported"}
          </p>
          {info?.stages ? (
            <div className="mt-3">
              <StageBar stages={info.stages} />
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">No sleep stages for this night (stages need a watch or tracker that records them).</p>
          )}
        </>
      ) : (
        <p className="text-2xl font-semibold text-muted">No sleep data</p>
      )}
      <div className="mt-3 flex items-start justify-between gap-3 border-t border-line pt-3 text-sm">
        {scoreDay ? (
          <div>
            <p className="text-xs text-muted">Sleep score</p>
            <p className="font-medium text-fg tabular">
              {fmtMetric("sleep_score", scoreDay.value)} <span className="text-xs font-normal text-muted">from {scoreProvider(scoreDay) ?? "a connected source"}</span>
            </p>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>No sleep score from a connected source. Scores appear only when a device or app (e.g. Oura, Fitbit, Garmin, Whoop) supplies its own — this app never calculates one.</span>
          </p>
        )}
      </div>
      {night && (
        <div className="mt-2">
          <SourceLine label={night.sourceLabel} origin={info?.origins.length ? info.origins.join(", ") : night.origin} syncedAt={night.syncedAt} />
          <Alternatives d={night} k="sleep" />
        </div>
      )}
    </Card>
  );
}

export function VitalMiniCard({ k, metric, title, today, color }: { k: MetricKey; metric: MetricJ; title: string; today: string; color: string }) {
  const last = latest(metric);
  if (!last) return null;
  return (
    <Card className="p-4 sm:p-4">
      <p className="text-xs font-medium text-muted">{title}</p>
      <p className="mt-0.5 text-xl font-semibold text-fg tabular">{fmtMetric(k, last.value)}</p>
      <p className="text-xs text-fg-2">
        {dayLabel(last.date, today)}
        {metric.average != null ? ` · avg ${fmtMetric(k, metric.average)}` : ""}
      </p>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <SourceLine label={last.sourceLabel} origin={last.origin} syncedAt={last.syncedAt} />
      </div>
    </Card>
  );
}
