"use client";

import { Moon, Plus, Scale, Sun, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateNav } from "@/components/date-nav";
import { MealCard } from "@/components/meal-card";
import { GoalProgress, MACRO_COLORS, NutrientGrid } from "@/components/nutrition";
import { Button, Card, CardTitle, EmptyState, ErrorBanner, Meter, Skeleton } from "@/components/ui";
import { WeightEntryForm } from "@/components/weight-entry";
import { useDay, useSettings } from "@/lib/client/hooks";
import type { DaySummaryJ, SettingsJ } from "@/lib/client/types";
import { fmtKcal } from "@/lib/format";
import { isLocalDate, localParts } from "@/lib/time";
import { formatWeight, formatWeightDelta } from "@/lib/units";

function CaloriesHero({ day }: { day: DaySummaryJ }) {
  const consumed = day.totals.values.calories ?? 0;
  const target = day.goals.calories;
  const remaining = target ? target - consumed : null;
  const over = remaining !== null && remaining < -(target ?? 0) * 0.1;
  return (
    <div>
      <p className="text-sm font-medium text-muted">Calories</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-5xl font-semibold tracking-tight text-fg">{fmtKcal(consumed)}</span>
        <span className="text-lg text-fg-2">{target ? `/ ${fmtKcal(target)} kcal` : "kcal"}</span>
        {day.totals.incomplete.includes("calories") && <span className="text-xs text-muted">(some foods lack calorie data)</span>}
      </div>
      {target ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <Meter value={consumed} max={target} color={MACRO_COLORS.calories} label={`Calories ${Math.round(consumed)} of ${Math.round(target)}`} over={over} />
          <p className={over ? "text-sm text-critical" : "text-sm text-fg-2"}>
            {remaining! >= 0 ? `${fmtKcal(remaining)} kcal remaining` : `${fmtKcal(-remaining!)} kcal over target`}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">
          <Link href="/settings#goals" className="text-accent underline-offset-2 hover:underline">
            Set daily goals
          </Link>{" "}
          to track what&apos;s remaining.
        </p>
      )}
    </div>
  );
}

function WeightCard({ day, settings, today }: { day: DaySummaryJ; settings: SettingsJ; today: string }) {
  const [adding, setAdding] = useState(false);
  const unit = settings.weightUnit;
  const m = day.weights.morning?.weightKg ?? null;
  const n = day.weights.night?.weightKg ?? null;
  const avg = m !== null && n !== null ? (m + n) / 2 : (m ?? n);
  const missingBoth = m === null && n === null;
  return (
    <Card>
      <CardTitle
        sub={avg !== null ? `Daily average ${formatWeight(avg, unit)}${m !== null && n !== null ? ` · night ${formatWeightDelta(n - m, unit)}` : " (one reading)"}` : undefined}
        action={
          <Link href="/weight" className="text-sm font-medium text-accent">
            Trends
          </Link>
        }
      >
        Weight
      </CardTitle>
      <div className="grid grid-cols-2 gap-3">
        {([["morning", m, Sun], ["night", n, Moon]] as const).map(([p, v, Icon]) => (
          <div key={p} className="rounded-lg bg-surface-2 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <Icon className="size-3.5" aria-hidden /> {p === "morning" ? "Morning" : "Night"}
            </p>
            <p className="mt-0.5 text-lg font-semibold text-fg tabular">{v !== null ? formatWeight(v, unit) : <span className="text-muted">Not logged</span>}</p>
          </div>
        ))}
      </div>
      {adding || (missingBoth && day.date === today) ? (
        <div className="mt-3">
          <WeightEntryForm settings={settings} date={day.date} today={today} initialPeriod={m === null ? undefined : "night"} onDone={() => setAdding(false)} />
        </div>
      ) : (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAdding(true)}>
          <Scale className="size-4" /> Log weight
        </Button>
      )}
    </Card>
  );
}

function Contributors({ day }: { day: DaySummaryJ }) {
  const block = (title: string, rows: DaySummaryJ["topContributors"]["calories"], unit: string) => (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">—</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.mealId} className="flex items-baseline justify-between gap-2 text-sm">
              <Link href={`/meals/${r.mealId}`} className="truncate text-fg hover:underline">
                {r.title}
              </Link>
              <span className="shrink-0 text-fg-2 tabular">
                {Math.round(r.value).toLocaleString()} {unit} <span className="text-muted">· {Math.round(r.share * 100)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Card>
      <CardTitle>Biggest contributors</CardTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-1">
        {block("Calories", day.topContributors.calories, "kcal")}
        {block("Protein", day.topContributors.protein, "g")}
      </div>
    </Card>
  );
}

export function DashboardView({ initialDate }: { initialDate: string | null }) {
  const router = useRouter();
  const settingsQ = useSettings();
  const [date, setDate] = useState<string | null>(initialDate && isLocalDate(initialDate) ? initialDate : null);
  const today = settingsQ.data?.today ?? null;
  const active = date ?? today;
  const dayQ = useDay(active);
  const [showAll, setShowAll] = useState(false);

  const changeDate = (d: string) => {
    setDate(d);
    router.replace(d === today ? "/" : `/?date=${d}`, { scroll: false });
  };

  if (!settingsQ.data || !active) return null;
  const settings = settingsQ.data.settings;
  const day = dayQ.data;
  const now = localParts(new Date(), settings.timezone);
  const morningDue = day && active === today && !day.weights.morning && now.time >= settings.reminders.morning && now.hour < 15;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateNav date={active} today={today!} onChange={changeDate} />
        <Link href={active === today ? "/log" : `/log?date=${active}`}>
          <Button>
            <Plus className="size-4" /> Log meal
          </Button>
        </Link>
      </div>

      {dayQ.error && <ErrorBanner error={dayQ.error} onRetry={() => dayQ.refetch()} />}
      {morningDue && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-fg">
          <Sun className="size-4 text-accent" aria-hidden /> Morning weigh-in not logged yet — best done after waking and using the bathroom.
        </div>
      )}

      {!day ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Skeleton className="h-64 md:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-4 md:grid-cols-3 ${dayQ.isFetching ? "opacity-80 transition-opacity" : ""}`}>
          <Card className="md:col-span-2">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
              <CaloriesHero day={day} />
              <div className="flex flex-col gap-4">
                {(["protein", "carbs", "fat"] as const).map((k) => (
                  <GoalProgress key={k} nkey={k} value={day.totals.values[k]} target={day.goals[k]} incomplete={day.totals.incomplete.includes(k)} />
                ))}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm text-fg-2">
              <span>
                {day.meals.length} meal{day.meals.length === 1 ? "" : "s"} logged
              </span>
              <button type="button" className="font-medium text-accent" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
                {showAll ? "Hide other nutrients" : "All nutrients"}
              </button>
            </div>
            {showAll && (
              <div className="mt-3">
                <NutrientGrid values={day.totals.values} incomplete={day.totals.incomplete} targets={day.goals} />
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-4">
            <WeightCard day={day} settings={settings} today={today!} />
          </div>

          <Card className="md:col-span-2">
            <CardTitle sub="Chronological. Tap a meal for foods, portions and full nutrition.">Meals</CardTitle>
            {day.meals.length === 0 ? (
              <EmptyState
                icon={<UtensilsCrossed className="size-8" />}
                title={active === today ? "Nothing logged yet today" : "No meals logged on this day"}
                action={
                  <Link href={active === today ? "/log" : `/log?date=${active}`}>
                    <Button>
                      <Plus className="size-4" /> Log a meal
                    </Button>
                  </Link>
                }
              >
                Describe what you ate in plain English, snap a photo, or search the food database.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {day.meals.map((m) => (
                  <MealCard key={m.id} meal={m} />
                ))}
              </ul>
            )}
          </Card>
          {day.meals.length > 0 && <Contributors day={day} />}
        </div>
      )}
    </div>
  );
}
