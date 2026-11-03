"use client";

import { CalendarDays, ChevronRight, ClipboardList, Dumbbell, Library, Minus, Play, Plus, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { DOMAIN_COLORS, KindBadge, PageHeader, StreakBadge } from "@/components/kit";
import { Button, Card, CardTitle, cx, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { useSettings, useTrainingAnalytics, useTrainingOverview } from "@/lib/client/hooks";
import type { TrainingOverviewJ } from "@/lib/client/types";
import type { Unit } from "@/lib/training/types";
import { formatLift, formatVolume } from "@/lib/training/units";
import { dayLabel, exerciseHref, plural, RECORD_SHORT, recordValue, signedPct, workoutHref } from "./components/format";
import { MuscleBreakdown } from "./components/muscle-breakdown";
import { Sparkline } from "./components/sparkline";
import { StartWorkoutDialog } from "./components/start-workout";
import { WorkoutRow } from "./components/workout-row";

type Overview = TrainingOverviewJ;
type ChangeJ = Overview["keyLifts"][number]["change30"];

const LINKS = [
  { href: "/training/history", label: "History", sub: "Every workout", icon: CalendarDays },
  { href: "/training/exercises", label: "Exercises", sub: "Library & progress", icon: Library },
  { href: "/training/records", label: "Records", sub: "PRs & milestones", icon: Trophy },
  { href: "/training/templates", label: "Templates", sub: "Saved workouts", icon: ClipboardList },
] as const;

export function TrainingHubView({ start }: { start: string | null }) {
  const router = useRouter();
  const settingsQ = useSettings();
  const q = useTrainingOverview();
  const [startOpen, setStartOpen] = useState(start === "1");
  const unit: Unit = settingsQ.data?.settings.weightUnit ?? "lb";
  const today = settingsQ.data?.today ?? "";
  const d = q.data;

  const closeStart = () => {
    setStartOpen(false);
    if (start === "1") router.replace("/training");
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Training"
        icon={<Dumbbell className="size-5" style={{ color: DOMAIN_COLORS.training }} aria-hidden />}
        sub="Sets, reps and weight — progress measured by what you lift."
        actions={
          d?.inProgress ? (
            <Link href={workoutHref(d.inProgress.id)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
              <Play className="size-4" aria-hidden /> Resume workout
            </Link>
          ) : (
            <Button onClick={() => setStartOpen(true)} disabled={!settingsQ.data}>
              <Plus className="size-4" aria-hidden /> Start workout
            </Button>
          )
        }
      />

      {q.error ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} /> : null}

      {d?.inProgress && (
        <Card className="border-accent/40 bg-accent-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-accent">Workout in progress</p>
              <p className="truncate font-semibold text-fg">{d.inProgress.name}</p>
              <p className="text-xs text-fg-2">{dayLabel(d.inProgress.localDate)}</p>
            </div>
            <Link href={workoutHref(d.inProgress.id)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
              <Play className="size-4" aria-hidden /> Resume
            </Link>
          </div>
        </Card>
      )}

      {!d ? (
        q.error ? null : <HubSkeleton />
      ) : d.totals.workouts === 0 && !d.inProgress && d.recentWorkouts.length === 0 ? (
        <>
          <EmptyState
            icon={<Dumbbell className="size-7" />}
            title="Log your first workout"
            action={
              <Button size="lg" onClick={() => setStartOpen(true)}>
                <Play className="size-5" aria-hidden /> Start workout
              </Button>
            }
          >
            Add exercises, then log weight and reps for each set. Next time, last session&apos;s numbers appear beside every set so you know what to beat.
          </EmptyState>
          <QuickLinks />
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            <div className="lg:hidden">
              <QuickLinks />
            </div>
            <WeekCard d={d} unit={unit} />
            <KeyLifts d={d} unit={unit} />
            <RecentWorkouts d={d} unit={unit} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="hidden lg:block">
              <QuickLinks />
            </div>
            <MusclesCard unit={unit} />
            <RecentRecords d={d} unit={unit} />
          </div>
        </div>
      )}

      {today && <StartWorkoutDialog open={startOpen} onClose={closeStart} today={today} recent={d?.recentWorkouts ?? []} inProgress={d?.inProgress ?? null} />}
    </div>
  );
}

function HubSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-busy="true" aria-label="Loading training overview">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Skeleton className="h-44" />
        <Skeleton className="h-64" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}

function QuickLinks() {
  return (
    <nav aria-label="Training sections" className="grid grid-cols-2 gap-2">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="flex min-h-14 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-[var(--shadow)] hover:bg-surface-2">
          <l.icon className="size-5 shrink-0 text-fg-2" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-fg">{l.label}</span>
            <span className="block truncate text-xs text-muted">{l.sub}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}

function Delta({ cur, base, fmt, baseLabel }: { cur: number; base: number; fmt: (v: number) => string; baseLabel: string }) {
  const diff = cur - base;
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  return (
    <span className={cx("inline-flex items-center gap-1", diff > 0 ? "text-good-text" : "text-muted")}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="tabular">
        {diff === 0 ? "Same as" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))} vs`} {baseLabel}
      </span>
    </span>
  );
}

function WeekStat({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-0.5 truncate text-xl font-semibold text-fg tabular">{value}</p>
      <div className="mt-0.5 text-xs">{sub}</div>
    </div>
  );
}

function WeekCard({ d, unit }: { d: Overview; unit: Unit }) {
  const w = d.week;
  const inProgress = w.dayOfWeek < 7;
  const base = inProgress ? w.lastWeekToDate : w.lastWeek;
  const baseLabel = inProgress ? "last wk so far" : "last wk";
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <Card>
      <CardTitle
        sub={inProgress ? `Day ${w.dayOfWeek} of 7 · compared with last week up to the same day` : "Compared with last week"}
        action={<StreakBadge count={d.streak.currentWeeks} unit="weeks" best={d.streak.longestWeeks} />}
      >
        This week
      </CardTitle>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        <WeekStat label="Workouts" value={n(w.thisWeek.workouts)} sub={<Delta cur={w.thisWeek.workouts} base={base.workouts} fmt={n} baseLabel={baseLabel} />} />
        <WeekStat label="Working sets" value={n(w.thisWeek.sets)} sub={<Delta cur={w.thisWeek.sets} base={base.sets} fmt={n} baseLabel={baseLabel} />} />
        <WeekStat label="Reps" value={n(w.thisWeek.reps)} sub={<Delta cur={w.thisWeek.reps} base={base.reps} fmt={n} baseLabel={baseLabel} />} />
        <WeekStat label="Volume" value={formatVolume(w.thisWeek.volumeKg, unit)} sub={<Delta cur={w.thisWeek.volumeKg} base={base.volumeKg} fmt={(v) => formatVolume(v, unit)} baseLabel={baseLabel} />} />
      </div>
      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
        Last week in full: {plural(w.lastWeek.workouts, "workout")} · {plural(w.lastWeek.sets, "set")} · {formatVolume(w.lastWeek.volumeKg, unit)}. Streak counts consecutive weeks with at least one workout
        {d.streak.longestWeeks > 0 ? ` (best ${plural(d.streak.longestWeeks, "week")})` : ""}.
      </p>
    </Card>
  );
}

function ChangeChip({ label, change }: { label: string; change: ChangeJ }) {
  if (change.status !== "ok") {
    return (
      <span className="text-xs text-muted" title={change.reason}>
        {label} —
      </span>
    );
  }
  return (
    <span className={cx("text-xs font-medium tabular", change.pct > 0.001 ? "text-good-text" : change.pct < -0.001 ? "text-critical" : "text-fg-2")} title={change.explanation}>
      {label} {signedPct(change.pct)}
    </span>
  );
}

function KeyLifts({ d, unit }: { d: Overview; unit: Unit }) {
  return (
    <Card>
      <CardTitle sub="Your most-trained exercises. Estimated 1RM from your best set each session." action={<KindBadge kind="estimate" />}>
        Key lifts
      </CardTitle>
      {d.keyLifts.length === 0 ? (
        <p className="text-sm text-muted">Log a few sessions to see strength trends here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {d.keyLifts.map((k) => (
            <li key={k.exerciseId} className="py-2.5 first:pt-0 last:pb-0">
              <Link href={exerciseHref(k.exerciseId)} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fg">{k.name}</p>
                  <p className="text-xs text-fg-2 tabular">
                    Est. 1RM {formatLift(k.latestE1rmKg, unit)}
                    {k.bestE1rmKg != null && <span className="text-muted"> · best {formatLift(k.bestE1rmKg, unit)}</span>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3">
                    <ChangeChip label="30d" change={k.change30} />
                    <ChangeChip label="90d" change={k.change90} />
                    <span className="text-xs text-muted">{plural(k.sessions, "session")}</span>
                  </p>
                </div>
                <Sparkline values={k.series.map((p) => p.e1rmKg)} label={`${k.name} estimated 1RM over the last ${k.series.length} sessions`} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentWorkouts({ d, unit }: { d: Overview; unit: Unit }) {
  return (
    <Card>
      <CardTitle
        action={
          <Link href="/training/history" className="inline-flex items-center gap-0.5 text-sm font-medium text-accent">
            History <ChevronRight className="size-4" aria-hidden />
          </Link>
        }
      >
        Recent workouts
      </CardTitle>
      {d.recentWorkouts.length === 0 ? <p className="text-sm text-muted">No workouts yet.</p> : <ul className="-mx-2 flex flex-col">{d.recentWorkouts.map((w) => <WorkoutRow key={w.id} w={w} unit={unit} />)}</ul>}
    </Card>
  );
}

function RecentRecords({ d, unit }: { d: Overview; unit: Unit }) {
  return (
    <Card>
      <CardTitle
        action={
          <Link href="/training/records" className="inline-flex items-center gap-0.5 text-sm font-medium text-accent">
            All <ChevronRight className="size-4" aria-hidden />
          </Link>
        }
      >
        Recent records
      </CardTitle>
      {d.recentRecords.length === 0 ? (
        <p className="text-sm text-muted">Records appear once you beat an earlier session — your first session of each exercise sets the baseline.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {d.recentRecords.map((r) => (
            <li key={r.key}>
              <Link href={workoutHref(r.workoutId)} className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-1 hover:bg-surface-2">
                <Trophy className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{r.exerciseName ?? "Whole workout"}</span>
                  <span className="block text-xs text-fg-2 tabular">
                    {RECORD_SHORT[r.type]}: {recordValue(r, unit)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted">{dayLabel(r.date)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MusclesCard({ unit }: { unit: Unit }) {
  const q = useTrainingAnalytics("range=30d");
  return (
    <Card>
      <CardTitle sub="Hard sets per muscle, last 30 days. Secondary muscles count as half a set.">Muscle groups</CardTitle>
      {q.error ? (
        <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : q.data.muscles.length === 0 ? (
        <p className="text-sm text-muted">No completed working sets in the last 30 days.</p>
      ) : (
        <MuscleBreakdown muscles={q.data.muscles} unit={unit} limit={8} showVolume={false} />
      )}
    </Card>
  );
}
