"use client";

import { AlertCircle, Info, Lightbulb, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CaloriesChart, CategoryChart, DataTable, MacroChart, WeeklyPairsCharts, WeightVsCaloriesCharts } from "@/components/charts";
import { Card, CardTitle, EmptyState, ErrorBanner, Input, Segmented, Skeleton, Stat } from "@/components/ui";
import { useAnalytics, useInsights, useSettings } from "@/lib/client/hooks";
import { useRouter } from "next/navigation";
import { KindBadge } from "@/components/kit";
import { fmtDistance } from "@/lib/client/units";
import { formatSleepMinutes } from "@/lib/health/metrics";
import { formatWeightDelta } from "@/lib/units";
import { StrengthAnalytics } from "@/views/training/analytics-panel";
import { RunningAnalytics } from "@/views/running/analytics-panel";
import { HealthAnalytics } from "@/views/health/analytics-panel";
import { RoutineAnalytics } from "@/views/routines/analytics-panel";
import type { AnalyticsJ, InsightsJ } from "@/lib/client/types";
import { fmtKcal, fmtNutrient, fmtPct } from "@/lib/format";
import { describeGoalRule } from "@/lib/nutrition/goals";
import { NUTRIENTS, NUTRIENT_BY_KEY, SECONDARY_KEYS, type NutrientKey } from "@/lib/nutrition/nutrients";
import { addDays, formatLocalDate, RANGE_LABELS, RANGE_PRESETS, type RangePreset } from "@/lib/time";
import { fromKg } from "@/lib/units";

type RangeChoice = RangePreset | "custom";

function signed(v: number | null, unit: string, decimals = 0) {
  if (v == null) return "—";
  const r = Number(v.toFixed(decimals));
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toLocaleString()} ${unit}`;
}

function Overview({ a, goals }: { a: AnalyticsJ; goals: Partial<Record<NutrientKey, number>> }) {
  const n = a.nutrition;
  const avg = (k: NutrientKey) => n.averages[k].value;
  return (
    <Card>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
        {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
          <Stat key={k} label={`Avg ${NUTRIENT_BY_KEY[k].label.toLowerCase()} / day`} value={fmtNutrient(k, avg(k))} sub={goals[k] ? `Goal ${fmtNutrient(k, goals[k])}` : undefined} />
        ))}
        <Stat label="Avg meals per logged day" value={n.avgMealsPerDay == null ? "—" : n.avgMealsPerDay.toFixed(1)} />
        <Stat label="Days meeting all macro goals" value={fmtPct(n.allPrimaryMetPct)} sub="Calories, carbs, fat within ±10%; protein at or above goal" />
        <Stat label="Logging streak" value={`${n.consistency.currentStreak} days`} sub={`Longest ${n.consistency.longestStreak} days`} />
        <Stat label="Calorie trend" value={n.calorieTrendPerWeek == null ? "—" : signed(n.calorieTrendPerWeek, "kcal/wk")} sub="Change in daily intake per week" />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-line pt-4 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted">Calories</p>
          <p className="text-fg-2">
            Highest: {n.extremes.calories.highest ? <Link className="text-fg hover:underline" href={`/nutrition?date=${n.extremes.calories.highest.date}`}>{fmtKcal(n.extremes.calories.highest.value)} kcal on {formatLocalDate(n.extremes.calories.highest.date)}</Link> : "—"}
          </p>
          <p className="text-fg-2">
            Lowest: {n.extremes.calories.lowest ? <Link className="text-fg hover:underline" href={`/nutrition?date=${n.extremes.calories.lowest.date}`}>{fmtKcal(n.extremes.calories.lowest.value)} kcal on {formatLocalDate(n.extremes.calories.lowest.date)}</Link> : "—"}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted">Protein</p>
          <p className="text-fg-2">
            Highest: {n.extremes.protein.highest ? <Link className="text-fg hover:underline" href={`/nutrition?date=${n.extremes.protein.highest.date}`}>{Math.round(n.extremes.protein.highest.value)} g on {formatLocalDate(n.extremes.protein.highest.date)}</Link> : "—"}
          </p>
          <p className="text-fg-2">
            Lowest: {n.extremes.protein.lowest ? <Link className="text-fg hover:underline" href={`/nutrition?date=${n.extremes.protein.lowest.date}`}>{Math.round(n.extremes.protein.lowest.value)} g on {formatLocalDate(n.extremes.protein.lowest.date)}</Link> : "—"}
          </p>
        </div>
      </div>
    </Card>
  );
}

function Adherence({ a }: { a: AnalyticsJ }) {
  const rows = Object.entries(a.nutrition.adherence) as [NutrientKey, { evaluated: number; met: number; pct: number }][];
  return (
    <Card>
      <CardTitle sub="Each logged day is judged against the goals that were in effect that day.">Goal adherence</CardTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          No goals set. <Link href="/goals#nutrition-targets" className="text-accent">Set goals</Link> to track adherence.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(([k, r]) => (
            <li key={k} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-fg">
                  {NUTRIENT_BY_KEY[k].label} <span className="text-xs text-muted">({describeGoalRule(k)})</span>
                </span>
                <span className="text-fg-2 tabular">
                  {r.met}/{r.evaluated} days · <span className="font-semibold text-fg">{Math.round(r.pct * 100)}%</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-accent" style={{ width: `${r.pct * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Weekly({ a }: { a: AnalyticsJ }) {
  const weeks = a.nutrition.weekly.filter((w) => w.loggedDays > 0);
  return (
    <Card>
      <CardTitle sub="Averages over logged days; change is versus the previous week.">Week by week</CardTitle>
      {weeks.length === 0 ? (
        <p className="text-sm text-muted">No logged weeks in this range.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <DataTable
            columns={["Week of", "Days", "Calories", "Δ", "Protein", "Δ", "Carbs", "Fat"]}
            rows={[...weeks].reverse().map((w) => [formatLocalDate(w.weekStart, { month: "short", day: "numeric" }), w.loggedDays, fmtKcal(w.calories), signed(w.caloriesChange, ""), w.protein == null ? "—" : `${Math.round(w.protein)} g`, signed(w.proteinChange, "g"), w.carbs == null ? "—" : `${Math.round(w.carbs)} g`, w.fat == null ? "—" : `${Math.round(w.fat)} g`])}
          />
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Day-to-day: calories change by {fmtKcal(a.nutrition.variability.avgAbsDayToDayCalories)} kcal on average between consecutive logged days (SD {fmtKcal(a.nutrition.variability.sdCalories)} kcal).
      </p>
    </Card>
  );
}

function Micronutrients({ a, goals }: { a: AnalyticsJ; goals: Partial<Record<NutrientKey, number>> }) {
  const logged = a.nutrition.range.loggedDays;
  return (
    <Card>
      <CardTitle sub="Daily averages over logged days. Values only count foods that report each nutrient — AI estimates often omit micronutrients.">Other nutrients</CardTitle>
      <div className="overflow-x-auto">
        <DataTable
          columns={["Nutrient", "Avg / day", "Goal", "Days with data"]}
          rows={NUTRIENTS.filter((d) => SECONDARY_KEYS.includes(d.key)).map((d) => {
            const av = a.nutrition.averages[d.key];
            return [d.label, fmtNutrient(d.key, av.value), goals[d.key] ? `${d.goalType === "max" ? "≤" : "≥"} ${fmtNutrient(d.key, goals[d.key])}` : "—", `${av.days}/${logged}`];
          })}
        />
      </div>
    </Card>
  );
}

function Relationship({ a, unit }: { a: AnalyticsJ; unit: "kg" | "lb" }) {
  const conv = (kg: number | null) => (kg == null ? null : fromKg(kg, unit));
  const daily = a.nutrition.daily.map((d, i) => ({
    date: d.date,
    weight: conv(a.weight.days[i]?.average ?? null),
    weight7d: conv(a.weight.days[i]?.rolling7 ?? null),
    calories: d.calories,
    calories7d: d.calories7d,
  }));
  const weekly = a.relationship.weeks.map((w) => ({ week: w.weekStart, weight: conv(w.avgWeight), calories: w.avgCalories, protein: w.avgProtein }));
  const hasBoth = a.weight.loggedDays > 0 && a.nutrition.range.loggedDays > 0;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="mt-2 text-lg font-semibold">Weight &amp; nutrition</h2>
      <Card>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <TrendingUp className="size-4 text-accent" /> Observations
          </span>
        </CardTitle>
        <ul className="flex flex-col gap-2">
          {a.relationship.observations.map((o, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-fg-2">
              {o.kind === "insufficient" ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />}
              <span>{o.text}</span>
            </li>
          ))}
          {a.relationship.correlation && (
            <li className="text-xs text-muted">
              Correlation uses weekly average calories vs. the following week&apos;s change in average weight ({a.relationship.correlation.n} paired weeks).
            </li>
          )}
        </ul>
      </Card>
      {hasBoth ? (
        <>
          <WeightVsCaloriesCharts data={daily} unit={unit} />
          {weekly.some((w) => w.weight != null && w.calories != null) && <WeeklyPairsCharts data={weekly} unit={unit} />}
        </>
      ) : (
        <EmptyState title="Log both food and weight to compare them">Charts comparing your weight with calorie intake appear once this range has both.</EmptyState>
      )}
    </section>
  );
}

/** Nutrition and body-weight analytics (the original diet-tracker analytics). */
export function NutritionAnalytics({ qs }: { qs: string }) {
  const settingsQ = useSettings();
  const q = useAnalytics(qs);
  if (!settingsQ.data) return null;
  const unit = settingsQ.data.settings.weightUnit;
  const goals = settingsQ.data.goalTargets;
  const a = q.data;

  return (
    <div className="flex flex-col gap-4">
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {!a ? (
        <Skeleton className="h-[32rem]" />
      ) : (
        <div className={`flex flex-col gap-4 ${q.isFetching ? "opacity-80 transition-opacity" : ""}`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm">
            <span className="font-medium text-fg">
              {formatLocalDate(a.range.start, { month: "short", day: "numeric", year: "numeric" })} – {formatLocalDate(a.range.end, { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <span className="text-fg-2">
              Food logged on <span className="font-semibold text-fg">{a.nutrition.range.loggedDays}</span> of {a.nutrition.range.totalDays} days ({fmtPct(a.nutrition.range.completeness)})
            </span>
            <span className="text-fg-2">
              Weigh-ins on <span className="font-semibold text-fg">{a.weight.loggedDays}</span> days
            </span>
          </div>
          {a.nutrition.range.loggedDays === 0 ? (
            <EmptyState title="No food logged in this range">
              Averages and charts appear once you log meals. <Link className="text-accent" href="/log">Log a meal</Link>
            </EmptyState>
          ) : (
            <>
              {a.nutrition.range.loggedDays < 7 && (
                <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">Only {a.nutrition.range.loggedDays} logged days — treat averages and trends as preliminary.</p>
              )}
              <Overview a={a} goals={goals} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CaloriesChart data={a.nutrition.daily.map((d) => ({ date: d.date, calories: d.calories, calories7d: d.calories7d, goalCalories: d.goalCalories }))} />
                <MacroChart data={a.nutrition.daily.map((d) => ({ date: d.date, protein: d.protein, carbs: d.carbs, fat: d.fat }))} />
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Adherence a={a} />
                {a.nutrition.categories.length > 0 && <CategoryChart data={a.nutrition.categories} />}
              </div>
              <Weekly a={a} />
              <Micronutrients a={a} goals={goals} />
            </>
          )}
          <Relationship a={a} unit={unit} />
        </div>
      )}
    </div>
  );
}

type Tab = "overview" | "nutrition" | "strength" | "running" | "health" | "routines";
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "nutrition", label: "Nutrition & body" },
  { value: "strength", label: "Strength" },
  { value: "running", label: "Running" },
  { value: "health", label: "Steps & sleep" },
  { value: "routines", label: "Routines" },
];
const INSIGHT_DAYS: Record<RangePreset, number> = { "7d": 7, "30d": 30, "90d": 90, "6m": 182, "1y": 365, all: 365 };

function SummaryCard({ sum, unit, distanceUnit }: { sum: InsightsJ["summaries"]["weekly"]; unit: "kg" | "lb"; distanceUnit: "mi" | "km" }) {
  const row = (label: string, value: string, sub?: string) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-sm last:border-0">
      <span className="text-fg-2">{label}</span>
      <span className="text-right tabular text-fg">
        {value}
        {sub && <span className="ml-1 text-xs text-muted">{sub}</span>}
      </span>
    </div>
  );
  const pctTxt = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  return (
    <Card>
      <CardTitle sub={sum.days > 1 ? `${formatLocalDate(sum.range.start, { month: "short", day: "numeric" })} – ${formatLocalDate(sum.range.end, { month: "short", day: "numeric" })}` : formatLocalDate(sum.range.start)}>{sum.label}</CardTitle>
      {row("Avg calories", sum.nutrition.avgCalories == null ? "—" : `${fmtKcal(sum.nutrition.avgCalories)} kcal`, `${sum.nutrition.loggedDays} logged day${sum.nutrition.loggedDays === 1 ? "" : "s"}`)}
      {row("Avg protein", sum.nutrition.avgProtein == null ? "—" : `${Math.round(sum.nutrition.avgProtein)} g`, sum.nutrition.proteinTargetDays != null ? `target met ${sum.nutrition.proteinTargetDays}×` : undefined)}
      {row("Weight change", sum.body.changeKg == null ? "—" : formatWeightDelta(sum.body.changeKg, unit), `${sum.body.weighInDays} weigh-in days`)}
      {row("Workouts", String(sum.training.workouts), `${sum.training.sets} sets`)}
      {row("Run days", String(sum.running.runDays), `${fmtDistance(sum.running.distanceM, distanceUnit)} · ${sum.running.restDays} rest`)}
      {row("Run consistency", pctTxt(sum.running.consistencyPct), "rest days excluded")}
      {row("Avg steps", sum.health.avgSteps == null ? "—" : Math.round(sum.health.avgSteps).toLocaleString(), `${sum.health.stepDays} days with data`)}
      {row("Avg sleep", formatSleepMinutes(sum.health.avgSleepMin), `${sum.health.sleepDays} nights`)}
      {row("Morning routine", pctTxt(sum.routines.morningPct), "complete days")}
      {row("Nightly routine", pctTxt(sum.routines.nightPct), "complete days")}
      {row("Journaling", `${sum.routines.journalDays} days`, `${Math.round(sum.routines.readingTotal)} pages read`)}
    </Card>
  );
}

function OverviewTab({ range }: { range: RangePreset }) {
  const settingsQ = useSettings();
  const q = useInsights(INSIGHT_DAYS[range]);
  const [domain, setDomain] = useState<string>("all");
  if (!settingsQ.data) return null;
  const s = settingsQ.data.settings;
  const d = q.data;
  const domains = ["all", ...new Set(d?.insights.map((i) => i.domain) ?? [])];
  const list = (d?.insights ?? []).filter((i) => domain === "all" || i.domain === domain);
  return (
    <div className="flex flex-col gap-4">
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      <Card>
        <CardTitle sub="Computed only from your recorded data. Measured = counts of what you logged; Estimate = model-based (e.g. estimated 1RM); Pattern = an association in your data, not proof of cause.">
          <span className="inline-flex items-center gap-2">
            <Lightbulb className="size-4 text-accent" /> Insights
          </span>
        </CardTitle>
        {domains.length > 2 && (
          <div className="mb-3">
            <Segmented label="Insight area" size="sm" value={domain} onChange={setDomain} options={domains.map((x) => ({ value: x, label: x === "all" ? "All" : x[0].toUpperCase() + x.slice(1) }))} />
          </div>
        )}
        {!d ? (
          <Skeleton className="h-40" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted">Not enough data in this period for reliable insights yet. Keep logging meals, workouts, runs, routines and syncing steps & sleep.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((i) => (
              <li key={i.id} className={`rounded-lg border px-3 py-2.5 ${i.tone === "caution" ? "border-warning/50 bg-warning-soft" : "border-line"}`}>
                <div className="mb-0.5 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg">{i.title}</span>
                  <KindBadge kind={i.kind} />
                  <span className="text-xs text-muted capitalize">{i.domain}</span>
                </div>
                <p className="text-sm text-fg-2">{i.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {d && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SummaryCard sum={d.summaries.daily} unit={s.weightUnit} distanceUnit={s.distanceUnit} />
          <SummaryCard sum={d.summaries.weekly} unit={s.weightUnit} distanceUnit={s.distanceUnit} />
          <SummaryCard sum={d.summaries.monthly} unit={s.weightUnit} distanceUnit={s.distanceUnit} />
        </div>
      )}
      <p className="text-xs text-muted">
        Want a narrative? Ask the <Link href="/assistant" className="text-accent">AI assistant</Link> — its answers are AI-generated observations based on the same data.
      </p>
    </div>
  );
}

export function AnalyticsView({ initialTab }: { initialTab?: string | null }) {
  const router = useRouter();
  const settingsQ = useSettings();
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.value === initialTab) ? (initialTab as Tab) : "overview");
  const [choice, setChoice] = useState<RangeChoice>("30d");
  const today = settingsQ.data?.today ?? "";
  const [custom, setCustom] = useState({ start: addDays(today || "2026-01-01", -59), end: today });
  if (!settingsQ.data) return null;
  const preset: RangePreset = choice === "custom" ? "90d" : choice;
  const qs = choice === "custom" ? `start=${custom.start}&end=${custom.end}` : `range=${choice}`;
  const changeTab = (t: Tab) => {
    setTab(t);
    if (t !== "nutrition" && choice === "custom") setChoice("90d");
    router.replace(t === "overview" ? "/analytics" : `/analytics?tab=${t}`, { scroll: false });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <Segmented
          label="Date range"
          size="sm"
          value={choice}
          onChange={setChoice}
          options={[...RANGE_PRESETS.map((r) => ({ value: r as RangeChoice, label: r === "all" ? "All" : r.toUpperCase() })), ...(tab === "nutrition" ? [{ value: "custom" as RangeChoice, label: "Custom" }] : [])]}
        />
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented label="Analytics area" value={tab} onChange={changeTab} options={TABS} />
      </div>
      {choice === "custom" && tab === "nutrition" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input type="date" aria-label="Start date" value={custom.start} max={custom.end} onChange={(e) => e.target.value && setCustom({ ...custom, start: e.target.value })} className="w-auto" />
          <span className="text-muted">to</span>
          <Input type="date" aria-label="End date" value={custom.end} min={custom.start} max={today} onChange={(e) => e.target.value && setCustom({ ...custom, end: e.target.value })} className="w-auto" />
        </div>
      )}
      <p className="text-xs text-muted">{RANGE_LABELS[preset]}{choice === "custom" ? " (custom)" : ""}</p>
      {tab === "overview" && <OverviewTab range={preset} />}
      {tab === "nutrition" && <NutritionAnalytics qs={qs} />}
      {tab === "strength" && <StrengthAnalytics range={preset} />}
      {tab === "running" && <RunningAnalytics range={preset} />}
      {tab === "health" && <HealthAnalytics range={preset} />}
      {tab === "routines" && <RoutineAnalytics range={preset} />}
    </div>
  );
}
