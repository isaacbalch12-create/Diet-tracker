"use client";

import { HeartPulse, PenLine, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader, RangeTabs, rangeTitle } from "@/components/kit";
import { Button, EmptyState, ErrorBanner, Modal, Skeleton } from "@/components/ui";
import { useGoals, useSettings, useVitals } from "@/lib/client/hooks";
import { formatLocalDate, type RangePreset } from "@/lib/time";
import { LinkButton } from "@/views/running/components/link-button";
import { AveragesCard, SleepChart, SleepScoreChart, StepsChart, VitalLineChart } from "./components/health-charts";
import { dailyGoal, HEALTH_COLORS, metricOf, METRIC_KEYS } from "./components/health-utils";
import { ValuesLog } from "./components/health-values";
import { ManualEntryForm } from "./components/manual-entry";
import { SyncBanner } from "./components/sync-status";
import { SleepCard, StepsTodayCard, VitalMiniCard } from "./components/today-cards";

export function HealthView({ log }: { log: string | null }) {
  const router = useRouter();
  const settingsQ = useSettings();
  const goalsQ = useGoals();
  const [range, setRange] = useState<RangePreset>("30d");
  const q = useVitals(`range=${range}`);
  const [manualOpen, setManualOpen] = useState(log === "1");
  const [prevLog, setPrevLog] = useState(log);

  // Opening /health?log=1 while already on the page (quick-add menu) reopens the form.
  if (log !== prevLog) {
    setPrevLog(log);
    if (log === "1") setManualOpen(true);
  }
  useEffect(() => {
    if (log === "1") router.replace("/health", { scroll: false });
  }, [log, router]);

  if (!settingsQ.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }
  const settings = settingsQ.data.settings;
  const today = settingsQ.data.today;
  const v = q.data;
  const goals = goalsQ.data?.goals;
  const steps = metricOf(v, "steps");
  const sleep = metricOf(v, "sleep");
  const score = metricOf(v, "sleep_score");
  const rhr = metricOf(v, "resting_hr");
  const hrv = metricOf(v, "hrv");
  const energy = metricOf(v, "active_energy");
  const stepGoal = dailyGoal(goals, "steps");
  const sleepGoal = dailyGoal(goals, "sleep_duration");
  const hasData = !!v && METRIC_KEYS.some((k) => (v.metrics[k]?.loggedDays ?? 0) > 0);
  const minis = [
    { k: "resting_hr" as const, m: rhr, title: "Resting heart rate", color: HEALTH_COLORS.resting_hr },
    { k: "hrv" as const, m: hrv, title: "Heart rate variability", color: HEALTH_COLORS.hrv },
    { k: "active_energy" as const, m: energy, title: "Active energy", color: HEALTH_COLORS.active_energy },
  ].filter((x) => x.m && x.m.loggedDays > 0);
  const covered = v ? (range === "all" ? `${formatLocalDate(v.range.start, { month: "short", day: "numeric", year: "numeric" })} – ${formatLocalDate(v.range.end, { month: "short", day: "numeric", year: "numeric" })}` : rangeTitle(range)) : rangeTitle(range);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Steps & sleep"
        icon={<HeartPulse className="size-5" style={{ color: HEALTH_COLORS.steps }} aria-hidden />}
        sub="Synced from your phone's health app, or entered by hand. Missing days stay blank."
        actions={
          <>
            <Button variant="secondary" onClick={() => setManualOpen(true)}>
              <PenLine className="size-4" /> Add manually
            </Button>
            <LinkButton href="/health/connect" variant="ghost">
              <Smartphone className="size-4" aria-hidden /> Phone sync
            </LinkButton>
          </>
        }
      />

      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}

      {!v ? (
        <>
          <Skeleton className="h-20" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
          <Skeleton className="h-72" />
        </>
      ) : (
        <>
          <SyncBanner sync={v.sync} hasData={hasData} />

          {hasData && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <StepsTodayCard metric={steps} today={today} goal={stepGoal} />
              <SleepCard sleep={sleep} score={score} today={today} goal={sleepGoal} tz={settings.timezone} />
            </div>
          )}

          {minis.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {minis.map((x) => (
                <VitalMiniCard key={x.k} k={x.k} metric={x.m!} title={x.title} today={today} color={x.color} />
              ))}
            </div>
          )}

          {!hasData ? (
            <EmptyState
              icon={<HeartPulse className="size-8" />}
              title={range === "all" ? "No steps or sleep data yet" : `No steps or sleep in the last ${rangeTitle(range).toLowerCase()}`}
              action={
                <Button size="sm" variant="secondary" onClick={() => setManualOpen(true)}>
                  <PenLine className="size-4" /> Add a value by hand
                </Button>
              }
            >
              Charts, averages and trends appear once your phone syncs or you add values by hand.{range !== "all" ? " Older data may exist — try a longer time period." : ""}
              <div className="mt-3">
                <RangeTabs value={range} onChange={setRange} />
              </div>
            </EmptyState>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-fg">Trends · {covered}</h2>
                <RangeTabs value={range} onChange={setRange} />
              </div>
              <div className={`flex flex-col gap-4 ${q.isFetching ? "opacity-80 transition-opacity" : ""}`}>
                {steps && steps.loggedDays > 0 && <StepsChart metric={steps} goal={stepGoal?.targetValue ?? null} />}
                {sleep && sleep.loggedDays > 0 && <SleepChart metric={sleep} goalMin={sleepGoal?.targetValue ?? null} tz={settings.timezone} />}
                {score && score.loggedDays > 0 && <SleepScoreChart metric={score} />}
                {minis.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {minis.map((x) => (
                      <VitalLineChart key={x.k} metric={x.m!} k={x.k} title={x.title} color={x.color} />
                    ))}
                  </div>
                )}
                <AveragesCard vitals={v} />
                <ValuesLog vitals={v} onAdd={() => setManualOpen(true)} />
              </div>
            </>
          )}
        </>
      )}

      <Modal open={manualOpen} onClose={() => setManualOpen(false)} title="Add steps, sleep or vitals">
        {manualOpen && <ManualEntryForm today={today} vitals={v} onDone={() => setManualOpen(false)} onCancel={() => setManualOpen(false)} />}
      </Modal>
    </div>
  );
}
