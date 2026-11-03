"use client";

import { AlertTriangle, ChevronRight, Lightbulb, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { KindBadge, ProgressRing, StatusPill, StreakBadge } from "@/components/kit";
import { Badge, Card, CardTitle, cx, EmptyState, Meter, Skeleton, Stat } from "@/components/ui";
import type { GoalJ2, InsightsJ, RunningJ, SettingsJ } from "@/lib/client/types";
import { fmtDistance, fmtGoalValue, fmtNum } from "@/lib/client/units";
import type { DistanceUnit } from "@/lib/running/stats";
import { formatLocalDate } from "@/lib/time";
import { monthLong } from "./chart-kit";
import { LinkButton } from "./link-button";
import { isRunGoalMetric, RUN_COLOR, unitPrefs } from "./run-meta";

type Insight = InsightsJ["insights"][number];

const REST_CAUTION_DAYS = 10;

export function RecoveryCaution({ days, detail }: { days: number; detail?: string | null }) {
  return (
    <div role="note" className="flex gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-text">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        {detail ??
          `You've run ${days} days in a row without a rest or recovery day. Planning one keeps your streak intact — and pain, unusual soreness or fatigue are signals to rest, not push through.`}
      </p>
    </div>
  );
}

export function StreakCard({ streaks, recoveryInsight }: { streaks: RunningJ["streaks"]; recoveryInsight?: Insight | null }) {
  const caution = streaks.daysWithoutRest >= REST_CAUTION_DAYS;
  return (
    <Card>
      <CardTitle sub="Rest and recovery days never break a streak.">Streak</CardTitle>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Current" value={<span className="inline-flex items-baseline gap-1">{streaks.current}<span className="text-sm font-normal text-muted">{streaks.current === 1 ? "day" : "days"}</span></span>} />
        <Stat label="Longest" value={<span className="inline-flex items-baseline gap-1">{streaks.longest}<span className="text-sm font-normal text-muted">{streaks.longest === 1 ? "day" : "days"}</span></span>} />
        <Stat label="Since last day off" value={<span className={cx("inline-flex items-baseline gap-1", caution && "text-warning-text")}>{streaks.daysWithoutRest}<span className="text-sm font-normal text-muted">{streaks.daysWithoutRest === 1 ? "day" : "days"}</span></span>} />
      </div>
      {caution && (
        <div className="mt-3">
          <RecoveryCaution days={streaks.daysWithoutRest} detail={recoveryInsight?.detail} />
        </div>
      )}
    </Card>
  );
}

export function ConsistencyStats({ data, unit, rangeLabel }: { data: RunningJ; unit: DistanceUnit; rangeLabel: string }) {
  const c = data.consistency;
  const t = data.totals;
  const excluded = c.rest + c.recovery;
  return (
    <Card>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Consistency"
          value={c.pct == null ? "—" : `${Math.round(c.pct * 100)}%`}
          sub={c.eligible ? `Ran ${c.done} of ${c.eligible} days` : "No eligible days yet"}
        />
        <Stat label="Distance" value={fmtDistance(t.distanceM, unit, 1)} sub={rangeLabel} />
        <Stat label="Run days" value={fmtNum(t.runDays)} sub={`${t.runs} run${t.runs === 1 ? "" : "s"} logged`} />
        <Stat label="Avg per run" value={t.avgDistanceM == null ? "—" : fmtDistance(t.avgDistanceM, unit, 2)} sub="Runs with a distance" />
        <Stat label="Avg effort" value={t.avgEffort == null ? "—" : `${t.avgEffort.toFixed(1)}/10`} sub="Perceived" />
        <Stat label="Days off" value={fmtNum(excluded)} sub={`${c.rest} rest · ${c.recovery} recovery`} />
      </div>
      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
        Consistency = days you ran ÷ days that count. Planned rest and recovery days ({excluded}) are excluded, so taking one never lowers it.
        {c.short > 0 ? ` ${c.short} day${c.short === 1 ? "" : "s"} below your minimum distance count as not met.` : ""}
        {c.missed > 0 ? ` ${c.missed} missed day${c.missed === 1 ? "" : "s"}.` : ""}
      </p>
    </Card>
  );
}

export function RecordsCard({ records, unit }: { records: RunningJ["records"]; unit: DistanceUnit }) {
  const rows: { label: string; value: string; sub: string }[] = [
    { label: "Longest run", value: records.longestRun ? fmtDistance(records.longestRun.distanceM, unit, 2) : "—", sub: records.longestRun ? formatLocalDate(records.longestRun.date, { month: "short", day: "numeric", year: "numeric" }) : "Log a run with a distance" },
    { label: "Best week", value: records.bestWeek ? fmtDistance(records.bestWeek.distanceM, unit, 1) : "—", sub: records.bestWeek ? `Week of ${formatLocalDate(records.bestWeek.start, { month: "short", day: "numeric", year: "numeric" })} · ${records.bestWeek.runDays} run days` : "—" },
    { label: "Best month", value: records.bestMonth ? fmtDistance(records.bestMonth.distanceM, unit, 1) : "—", sub: records.bestMonth ? `${monthLong(records.bestMonth.start)} · ${records.bestMonth.runDays} run days` : "—" },
    { label: "Longest streak", value: `${records.longestStreak} ${records.longestStreak === 1 ? "day" : "days"}`, sub: "Rest days don't break it" },
  ];
  return (
    <Card>
      <CardTitle sub="All time, up to the end of the selected range.">
        <span className="inline-flex items-center gap-1.5">
          <Trophy className="size-4 text-warning" aria-hidden /> Records
        </span>
      </CardTitle>
      <dl className="grid grid-cols-2 gap-3">
        {rows.map((r) => (
          <div key={r.label} className="rounded-lg bg-surface-2 px-3 py-2.5">
            <dt className="text-xs font-medium text-muted">{r.label}</dt>
            <dd className="mt-0.5 text-lg font-semibold text-fg tabular">{r.value}</dd>
            <dd className="text-[11px] text-muted">{r.sub}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function RunTypeBreakdown({ byType, unit }: { byType: RunningJ["byType"]; unit: DistanceUnit }) {
  const max = Math.max(1, ...byType.map((t) => t.runs));
  const total = byType.reduce((a, t) => a + t.runs, 0);
  return (
    <Card>
      <CardTitle sub="Runs in the selected range by type.">Run types</CardTitle>
      {byType.length === 0 ? (
        <p className="text-sm text-muted">No runs in this range.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {byType.map((t) => (
            <li key={t.type} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className={cx("truncate", t.type === "Unspecified" ? "text-muted" : "text-fg")}>{t.type}</span>
                <span className="shrink-0 text-fg-2 tabular">
                  {t.runs} run{t.runs === 1 ? "" : "s"} · {Math.round((t.runs / total) * 100)}%{t.distanceM > 0 ? ` · ${fmtDistance(t.distanceM, unit, 1)}` : ""}
                </span>
              </div>
              <Meter value={t.runs} max={max} color={RUN_COLOR} label={`${t.type}: ${t.runs} runs`} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function goalValueText(g: GoalJ2, s: SettingsJ): string {
  const p = unitPrefs(s);
  if (g.metric === "run_completed") {
    if (g.current?.status === "excused") return "Day off — excused";
    return g.current?.value != null && g.current.value >= 1 ? "Done today" : "Not yet today";
  }
  const cur = fmtGoalValue(g.current?.value ?? null, g.unit, p, g.unitLabel);
  const target = fmtGoalValue(g.targetValue, g.unit, p, g.unitLabel);
  return `${cur} of ${target}`;
}

const PERIOD_LABEL: Record<string, string> = { daily: "Today", weekly: "This week", monthly: "This month", custom: "This period" };

export function RunGoalsCard({ goals, settings, runGoal }: { goals: GoalJ2[] | undefined; settings: SettingsJ; runGoal: RunningJ["goal"] }) {
  const list = (goals ?? []).filter((g) => g.status === "active" && isRunGoalMetric(g.metric));
  const unit = settings.distanceUnit;
  return (
    <Card>
      <CardTitle
        sub={runGoal ? (runGoal.minDistanceM ? `Run every day · minimum ${fmtDistance(runGoal.minDistanceM, unit, 2)} per day` : "Run every day · any distance counts") : "Goals update automatically from what you log."}
        action={
          <Link href="/goals" className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-accent">
            Goals <ChevronRight className="size-4" aria-hidden />
          </Link>
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Target className="size-4 text-accent" aria-hidden /> Running goals
        </span>
      </CardTitle>
      {goals === undefined ? (
        <Skeleton className="h-16" />
      ) : list.length === 0 ? (
        <EmptyState
          title="No running goals yet"
          action={
            <LinkButton href="/goals?new=1" size="sm">
              Add a running goal
            </LinkButton>
          }
        >
          Track &ldquo;run every day&rdquo;, a weekly distance, run days per week or monthly consistency.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.map((g) => (
            <li key={g.id}>
              <Link href={`/goals/${encodeURIComponent(g.id)}`} className="-mx-1 flex items-center gap-3 rounded-lg px-1 py-2.5 hover:bg-surface-2">
                <ProgressRing value={g.progress} size={44} stroke={5} color={RUN_COLOR} label={`${g.title}: ${g.progress == null ? "no data" : `${Math.round(g.progress * 100)}%`}`}>
                  {g.progress == null ? "—" : `${Math.min(999, Math.round(g.progress * 100))}%`}
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{g.title}</p>
                  <p className="text-xs text-fg-2 tabular">
                    {PERIOD_LABEL[g.period] ?? "Current"}: {goalValueText(g, settings)}
                    {g.current?.projected != null && g.metric === "run_distance" && g.current.status === "in_progress" ? ` · projected ${fmtGoalValue(g.current.projected, g.unit, unitPrefs(settings))} (estimate)` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {g.current && <StatusPill status={g.current.status} />}
                    <StreakBadge count={g.streak.current} unit={g.streak.unit} best={g.streak.best} />
                    {g.successRate != null && <span className="text-[11px] text-muted">{Math.round(g.successRate * 100)}% of past periods met</span>}
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && !list.some((g) => g.metric === "run_completed") && (
        <p className="mt-2 text-xs text-muted">
          Want the daily habit tracked as a goal?{" "}
          <Link href="/goals?new=1" className="text-accent hover:underline">
            Add &ldquo;Run every day&rdquo;
          </Link>{" "}
          with an optional minimum distance.
        </p>
      )}
      {runGoal && !runGoal.minDistanceM && (
        <p className="mt-2 text-xs text-muted">
          <Link href={`/goals/${encodeURIComponent(runGoal.id)}`} className="text-accent hover:underline">
            Set a minimum distance
          </Link>{" "}
          if you want short runs to stop counting as done. Keep it easy enough to hit on tired days.
        </p>
      )}
    </Card>
  );
}

const TONE_STYLE: Record<Insight["tone"], string> = {
  caution: "border-warning/40 bg-warning-soft",
  attention: "border-accent/30 bg-accent-soft",
  positive: "border-good/30 bg-good-soft",
  neutral: "border-line bg-surface-2",
};

export function RunInsights({ insights }: { insights: Insight[] }) {
  if (!insights.length) return null;
  return (
    <Card>
      <CardTitle sub="From your last 30 days of runs. Never a reason to train through pain.">
        <span className="inline-flex items-center gap-1.5">
          <Lightbulb className="size-4 text-warning" aria-hidden /> Insights
        </span>
      </CardTitle>
      <ul className="flex flex-col gap-2">
        {insights.map((i) => (
          <li key={i.id} className={cx("rounded-lg border px-3 py-2.5", TONE_STYLE[i.tone])}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-fg">{i.title}</p>
              {i.tone === "caution" && <Badge tone="warning">Caution</Badge>}
              <KindBadge kind={i.kind} />
            </div>
            <p className="mt-1 text-sm text-fg-2">{i.detail}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
