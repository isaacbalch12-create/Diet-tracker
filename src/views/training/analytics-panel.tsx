"use client";

import { Dumbbell } from "lucide-react";
import Link from "next/link";
import { KindBadge } from "@/components/kit";
import { Badge, Card, CardTitle, cx, EmptyState, ErrorBanner, Skeleton, Stat } from "@/components/ui";
import { useSettings, useTrainingAnalytics } from "@/lib/client/hooks";
import type { TrainingAnalyticsJ } from "@/lib/client/types";
import { formatLocalDate } from "@/lib/time";
import type { Unit } from "@/lib/training/types";
import { formatVolume } from "@/lib/training/units";
import { exerciseHref, fmtInt, PLATEAU_LABEL, PLATEAU_TONE, plural, signedPct, titleCase } from "./components/format";
import { MuscleBreakdown } from "./components/muscle-breakdown";
import { BarSeriesChart } from "./components/strength-charts";

type Range = "7d" | "30d" | "90d" | "6m" | "1y" | "all";
type ExerciseRow = TrainingAnalyticsJ["exercises"][number];

const weekTitle = (k: string) => `Week of ${formatLocalDate(k, { month: "short", day: "numeric", year: "numeric" })}`;
const monthShort = (k: string) => formatLocalDate(k, { month: "short" });
const monthTitle = (k: string) => formatLocalDate(k, { month: "long", year: "numeric" });

/** Strength section of the Analytics page (rendered under its range picker; no page header). */
export function StrengthAnalytics({ range }: { range: Range }) {
  const settingsQ = useSettings();
  const unit: Unit = settingsQ.data?.settings.weightUnit ?? "lb";
  const q = useTrainingAnalytics(`range=${range}`);
  const d = q.data;

  if (q.error && !d) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  if (!d) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading strength analytics">
        <Skeleton className="h-28" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (d.totals.workouts === 0) {
    return (
      <EmptyState
        icon={<Dumbbell className="size-6" />}
        title="No strength training in this period"
        action={
          <Link href="/training?start=1" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
            Log a workout
          </Link>
        }
      >
        Completed working sets (not warm-ups) count toward these statistics. Try a longer range.
      </EmptyState>
    );
  }

  const vol = (v: number) => `${v.toLocaleString("en-US")} ${unit}`;
  const count = (v: number) => v.toLocaleString("en-US");
  return (
    <div className={cx("flex flex-col gap-4", q.isFetching && "opacity-80")}>
      <Card>
        <CardTitle sub={`${formatLocalDate(d.range.start, { month: "short", day: "numeric", year: "numeric" })} – ${formatLocalDate(d.range.end, { month: "short", day: "numeric", year: "numeric" })} · ${plural(d.trainingDays.length, "training day")}`} action={<KindBadge kind="measured" />}>
          Strength training
        </CardTitle>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-5">
          <Stat label="Workouts" value={<span className="tabular">{fmtInt(d.totals.workouts)}</span>} />
          <Stat label="Working sets" value={<span className="tabular">{fmtInt(d.totals.sets)}</span>} />
          <Stat label="Reps" value={<span className="tabular">{fmtInt(d.totals.reps)}</span>} />
          <Stat label="Volume" value={<span className="tabular">{formatVolume(d.totals.volumeKg, unit)}</span>} />
          <Stat label="Exercises" value={<span className="tabular">{fmtInt(d.totals.exercises)}</span>} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarSeriesChart title="Workouts per week" sub="Weeks with no workouts show as zero." data={d.workoutsPerWeek.map((p) => ({ key: p.date, value: p.value }))} valueLabel="Workouts" fmt={count} keyLabel="Week" keyTitle={weekTitle} />
        <BarSeriesChart title="Workouts per month" data={d.workoutsPerMonth.map((p) => ({ key: p.date, value: p.value }))} valueLabel="Workouts" fmt={count} keyLabel="Month" keyFmt={monthShort} keyTitle={monthTitle} color="var(--series-3)" />
        <BarSeriesChart title="Volume per week" sub="Weight × reps of completed working sets." data={d.volumePerWeek.map((p) => ({ key: p.date, value: p.value }))} valueLabel="Volume" fmt={vol} keyLabel="Week" keyTitle={weekTitle} color="var(--series-1)" />
        <BarSeriesChart title="Working sets per week" data={d.setsPerWeek.map((p) => ({ key: p.date, value: p.value }))} valueLabel="Sets" fmt={count} keyLabel="Week" keyTitle={weekTitle} color="var(--series-cal)" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle sub="Hard sets per muscle and weekly average. Secondary muscles count as half a set; volume share counts primary muscles only.">Muscle groups</CardTitle>
          {d.muscles.length === 0 ? <p className="text-sm text-muted">No data.</p> : <MuscleBreakdown muscles={d.muscles} unit={unit} />}
        </Card>
        <ExerciseTable rows={d.exercises} />
      </div>
    </div>
  );
}

function ExerciseTable({ rows }: { rows: ExerciseRow[] }) {
  return (
    <Card>
      <CardTitle sub="Trend is a line fitted to each session's best estimated 1RM. Current vs peak compares the last 30 days with your all-time best." action={<KindBadge kind="estimate" />}>
        Exercises
      </CardTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No exercises in this period.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.exerciseId} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <Link href={exerciseHref(r.exerciseId)} className="block truncate font-medium text-fg hover:text-accent">
                  {r.name}
                </Link>
                <p className="truncate text-xs text-muted">
                  {r.muscle ? `${titleCase(r.muscle)} · ` : ""}
                  {plural(r.sessionsInRange, "session")} in range
                  {r.relative && <> · {Math.round(r.relative.ratio * 100)}% of peak</>}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {r.trend.status === "ok" ? (
                  <span className={cx("text-sm font-semibold tabular", r.trend.pctPerMonth > 0.001 ? "text-good-text" : r.trend.pctPerMonth < -0.001 ? "text-critical" : "text-fg-2")} title={`Fitted to ${plural(r.trend.sessions, "session")}`}>
                    {signedPct(r.trend.pctPerMonth)}/mo
                  </span>
                ) : (
                  <span className="text-xs text-muted" title={r.trend.reason}>
                    Trend —
                  </span>
                )}
                <Badge tone={PLATEAU_TONE[r.plateau.status]} title={r.plateau.explanation}>
                  {PLATEAU_LABEL[r.plateau.status]}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
