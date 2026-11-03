"use client";

import { HeartPulse } from "lucide-react";
import { Card, EmptyState, ErrorBanner, Skeleton, Stat } from "@/components/ui";
import { useGoals, useSettings, useVitals } from "@/lib/client/hooks";
import { formatLocalDate } from "@/lib/time";
import { LinkButton } from "@/views/running/components/link-button";
import { SleepChart, SleepScoreChart, StepsChart, VitalLineChart } from "./components/health-charts";
import { dailyGoal, fmtMetric, fmtTrend, HEALTH_COLORS, metricOf, type MetricJ, type MetricKey } from "./components/health-utils";

function weekAvg(m: MetricJ): number | null {
  const last = m.weekly.at(-1);
  return last ? last.average : null;
}

/** Health section of the main Analytics page (no page header). */
export function HealthAnalytics({ range }: { range: "7d" | "30d" | "90d" | "6m" | "1y" | "all" }) {
  const settingsQ = useSettings();
  const goalsQ = useGoals();
  const q = useVitals(`range=${range}`);
  const v = q.data;

  if (q.error) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  if (!settingsQ.data || !v) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const steps = metricOf(v, "steps");
  const sleep = metricOf(v, "sleep");
  const score = metricOf(v, "sleep_score");
  const rhr = metricOf(v, "resting_hr");
  const goals = goalsQ.data?.goals;
  const has = (m: MetricJ | null): m is MetricJ => !!m && m.loggedDays > 0;

  if (!has(steps) && !has(sleep) && !has(score) && !has(rhr)) {
    return (
      <EmptyState
        icon={<HeartPulse className="size-8" />}
        title="No steps or sleep data in this period"
        action={
          <LinkButton href="/health/connect" size="sm" variant="primary">
            Set up phone sync
          </LinkButton>
        }
      >
        Sync from Apple Health or Health Connect through a phone exporter, or add values by hand on the Steps &amp; sleep page.
      </EmptyState>
    );
  }

  const stats: { k: MetricKey; m: MetricJ; label: string }[] = [
    ...(has(steps) ? [{ k: "steps" as const, m: steps, label: "Avg daily steps" }] : []),
    ...(has(sleep) ? [{ k: "sleep" as const, m: sleep, label: "Avg sleep" }] : []),
    ...(has(score) ? [{ k: "sleep_score" as const, m: score, label: "Avg sleep score" }] : []),
    ...(has(rhr) ? [{ k: "resting_hr" as const, m: rhr, label: "Avg resting HR" }] : []),
  ];

  return (
    <div className={`flex flex-col gap-4 ${q.isFetching ? "opacity-80 transition-opacity" : ""}`}>
      <Card>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          {stats.map((s) => (
            <Stat
              key={s.k}
              label={s.label}
              value={fmtMetric(s.k, s.m.average)}
              sub={
                <>
                  {s.m.loggedDays} of {s.m.days.length} days with data
                  <br />
                  Latest week {fmtMetric(s.k, weekAvg(s.m))} · trend {s.m.trendPerWeek == null ? "needs 7+ days" : fmtTrend(s.k, s.m.trendPerWeek)}
                </>
              }
            />
          ))}
        </div>
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          {formatLocalDate(v.range.start, { month: "short", day: "numeric", year: "numeric" })} – {formatLocalDate(v.range.end, { month: "short", day: "numeric", year: "numeric" })}. Averages use only days with data; trends are linear fits (estimates).
        </p>
      </Card>
      {has(steps) && <StepsChart metric={steps} goal={dailyGoal(goals, "steps")?.targetValue ?? null} />}
      {has(sleep) && <SleepChart metric={sleep} goalMin={dailyGoal(goals, "sleep_duration")?.targetValue ?? null} tz={settingsQ.data.settings.timezone} />}
      {(has(score) || has(rhr)) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {has(score) && <SleepScoreChart metric={score} />}
          {has(rhr) && <VitalLineChart metric={rhr} k="resting_hr" title="Resting heart rate" color={HEALTH_COLORS.resting_hr} />}
        </div>
      )}
    </div>
  );
}
