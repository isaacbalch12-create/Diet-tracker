"use client";

import { Moon, Sun } from "lucide-react";
import Link from "next/link";
import { Card, CardTitle, cx, EmptyState, ErrorBanner, Skeleton, Stat } from "@/components/ui";
import { useRoutineStats } from "@/lib/client/hooks";
import { formatLocalDate } from "@/lib/time";
import { fmtNum, pct, SLOT_META, type Slot } from "./components/shared";
import { ActivityRates, SlotsDailyChart, SlotsWeeklyChart, StreakStat } from "./components/stats";

type Range = "7d" | "30d" | "90d" | "6m" | "1y" | "all";

/** Morning and nightly routine analytics, embedded in the main Analytics page. */
export function RoutineAnalytics({ range }: { range: Range }) {
  const q = useRoutineStats(`range=${range}`);
  const s = q.data;

  if (q.error) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  if (!s)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-36" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );

  const nothing = s.morning.trackedDays === 0 && s.night.trackedDays === 0 && s.reading.days === 0 && s.journaling.days === 0 && s.days.every((d) => d.morning.done + d.morning.optionalDone + d.night.done + d.night.optionalDone === 0);
  if (nothing)
    return (
      <EmptyState icon={<Sun className="size-8" />} title="No routine history in this period">
        Tick off your{" "}
        <Link href="/routines/morning" className="text-accent">
          morning
        </Link>{" "}
        or{" "}
        <Link href="/routines/night" className="text-accent">
          nightly
        </Link>{" "}
        routine to see completion, streaks and consistency here.
      </EmptyState>
    );

  const slotStat = (slot: Slot) => {
    const st = s[slot];
    const Icon = slot === "morning" ? Sun : Moon;
    return (
      <Stat
        label={`${SLOT_META[slot].short} days fully done`}
        value={
          <span className="inline-flex items-center gap-1.5">
            <Icon className={cx("size-4", SLOT_META[slot].iconClass)} aria-hidden />
            {pct(st.completionPct)}
          </span>
        }
        sub={`${st.completeDays} of ${st.trackedDays} days · avg ${pct(st.avgPct)} done`}
      />
    );
  };

  return (
    <div className={cx("flex flex-col gap-4", q.isPlaceholderData && "opacity-70 transition-opacity")}>
      <Card>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
          {slotStat("morning")}
          {slotStat("night")}
          <StreakStat stats={s.morning} label="Morning streak" />
          <StreakStat stats={s.night} label="Night streak" />
          <Stat label="Reading logged" value={fmtNum(s.reading.total)} sub={`${s.reading.days} day${s.reading.days === 1 ? "" : "s"} with reading (in each activity's unit)`} />
          <Stat label="Days journaled" value={s.journaling.days} sub={`Morning ${s.journaling.morning} · Night ${s.journaling.night}`} />
        </div>
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          {formatLocalDate(s.range.start, { month: "short", day: "numeric", year: "numeric" })} – {formatLocalDate(s.range.end, { month: "short", day: "numeric", year: "numeric" })}. Each day is judged against the activities that were in the routine that day; today counts once it&apos;s complete.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SlotsWeeklyChart stats={s} />
        <SlotsDailyChart stats={s} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(["morning", "night"] as const).map((slot) => (
          <Card key={slot}>
            <CardTitle
              sub="Days done of the days each activity was in the routine."
              action={
                <Link href={`/routines/${slot}`} className="text-sm font-medium text-accent">
                  Open
                </Link>
              }
            >
              <span className="inline-flex items-center gap-2">
                {slot === "morning" ? <Sun className={cx("size-4", SLOT_META.morning.iconClass)} aria-hidden /> : <Moon className={cx("size-4", SLOT_META.night.iconClass)} aria-hidden />}
                {SLOT_META[slot].label}: by activity
              </span>
            </CardTitle>
            <ActivityRates stats={s[slot]} slot={slot} compact />
          </Card>
        ))}
      </div>
    </div>
  );
}
