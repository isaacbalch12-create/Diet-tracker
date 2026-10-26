"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MACRO_COLORS } from "@/components/nutrition";
import { Card, ErrorBanner, IconButton, Skeleton } from "@/components/ui";
import { useHistory, useSettings } from "@/lib/client/hooks";
import { fmtKcal } from "@/lib/format";
import { addDays, addMonths, formatLocalDate, minDate, startOfMonth } from "@/lib/time";
import { formatWeight } from "@/lib/units";

export function HistoryView() {
  const settingsQ = useSettings();
  const today = settingsQ.data?.today ?? null;
  const [month, setMonth] = useState<string | null>(null);
  const start = month ?? (today ? startOfMonth(today) : null);
  const end = start && today ? minDate(addDays(addMonths(start, 1), -1), today) : null;
  const q = useHistory(start ?? "", end ?? "");
  if (!settingsQ.data || !start || !end || !today) return null;
  const unit = settingsQ.data.settings.weightUnit;
  const goalCal = settingsQ.data.goalTargets.calories;
  const days = q.data?.days ?? [];
  const logged = days.filter((d) => d.mealCount > 0);
  const avg = (k: "calories" | "protein") => (logged.length ? logged.reduce((a, d) => a + (d[k] ?? 0), 0) / logged.length : null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Nutrition history</h1>
        <div className="flex items-center gap-1">
          <IconButton label="Previous month" onClick={() => setMonth(addMonths(start, -1))}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <span className="min-w-32 text-center font-medium">{formatLocalDate(start, { month: "long", year: "numeric" })}</span>
          <IconButton label="Next month" onClick={() => setMonth(addMonths(start, 1))} disabled={addMonths(start, 1) > today}>
            <ChevronRight className="size-5" />
          </IconButton>
        </div>
      </div>
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      <p className="text-sm text-muted">
        {logged.length} of {days.length} days logged
        {logged.length > 0 && (
          <>
            {" "}
            · average {fmtKcal(avg("calories"))} kcal and {Math.round(avg("protein") ?? 0)} g protein on logged days
          </>
        )}
        . Tap a day to open its full log.
      </p>
      {!q.data ? (
        <Skeleton className="h-96" />
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {days.map((d) => {
              const pct = goalCal && d.calories ? Math.min(1, d.calories / goalCal) : 0;
              return (
                <li key={d.date}>
                  <Link href={`/?date=${d.date}`} className="grid grid-cols-1 gap-1 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[8rem_1fr_12rem] sm:items-center sm:gap-4 sm:px-5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-fg">{formatLocalDate(d.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                      {d.mealCount > 0 && (
                        <span className="text-xs text-muted sm:hidden">
                          {d.mealCount} meal{d.mealCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </span>
                    {d.mealCount === 0 ? (
                      <span className="text-sm text-muted">Not logged</span>
                    ) : (
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-baseline gap-x-3 text-sm whitespace-nowrap tabular">
                          <span className="font-semibold text-fg">{fmtKcal(d.calories)} kcal</span>
                          <span className="text-fg-2">P {Math.round(d.protein ?? 0)}</span>
                          <span className="text-fg-2">C {Math.round(d.carbs ?? 0)}</span>
                          <span className="text-fg-2">F {Math.round(d.fat ?? 0)}</span>
                          <span className="hidden text-xs text-muted sm:inline">
                            {d.mealCount} meal{d.mealCount === 1 ? "" : "s"}
                          </span>
                        </span>
                        {goalCal && (
                          <span className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-3" aria-hidden>
                            <span className="block h-full rounded-full" style={{ width: `${pct * 100}%`, background: MACRO_COLORS.calories }} />
                          </span>
                        )}
                      </span>
                    )}
                    <span className="text-xs whitespace-nowrap text-fg-2 tabular sm:text-right">
                      {d.morningKg != null || d.nightKg != null ? (
                        <>
                          {d.morningKg != null ? `AM ${formatWeight(d.morningKg, unit)}` : "AM —"} · {d.nightKg != null ? `PM ${formatWeight(d.nightKg, unit)}` : "PM —"}
                        </>
                      ) : (
                        <span className="text-muted">No weigh-in</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
