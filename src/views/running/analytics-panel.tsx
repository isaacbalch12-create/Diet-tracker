"use client";

import { Footprints } from "lucide-react";
import { rangeTitle } from "@/components/kit";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { useRuns, useSettings } from "@/lib/client/hooks";
import { ConsistencyStats, RecordsCard, StreakCard } from "./components/run-cards";
import { DistanceBarsChart, RunDaysPerWeekChart } from "./components/run-charts";
import { LinkButton } from "./components/link-button";

/** Running section of the main Analytics page (no page header). */
export function RunningAnalytics({ range }: { range: "7d" | "30d" | "90d" | "6m" | "1y" | "all" }) {
  const settingsQ = useSettings();
  const q = useRuns(`range=${range}`);
  const d = q.data;

  if (q.error) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  if (!settingsQ.data || !d) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  const unit = settingsQ.data.settings.distanceUnit;
  if (d.entries.length === 0 && d.totals.runs === 0 && d.streaks.longest === 0) {
    return (
      <EmptyState
        icon={<Footprints className="size-8" />}
        title="No runs logged yet"
        action={
          <LinkButton href="/running?log=1" size="sm" variant="primary">
            Log a run
          </LinkButton>
        }
      >
        Running analytics — weekly distance, run days, consistency and records — appear once you log runs.
      </EmptyState>
    );
  }

  return (
    <div className={`flex flex-col gap-4 ${q.isFetching ? "opacity-80 transition-opacity" : ""}`}>
      <ConsistencyStats data={d} unit={unit} rangeLabel={rangeTitle(range)} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DistanceBarsChart buckets={d.weekly} unit={unit} period="week" />
        <DistanceBarsChart buckets={d.monthly} unit={unit} period="month" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RunDaysPerWeekChart weekly={d.weekly} />
        <StreakCard streaks={d.streaks} />
      </div>
      <RecordsCard records={d.records} unit={unit} />
    </div>
  );
}
