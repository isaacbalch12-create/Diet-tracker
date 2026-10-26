/**
 * Long-term nutrition statistics. Only "logged days" (days with at least one
 * meal) count toward averages — a day with no entries is missing data, not a
 * zero-calorie day.
 */
import { type NutrientTotals, mergeTotals } from "../nutrition/calc";
import { evaluateGoal, goalForDate, goalTargets, type GoalVersion } from "../nutrition/goals";
import { NUTRIENT_KEYS, PRIMARY_KEYS, type NutrientKey } from "../nutrition/nutrients";
import { addDays, eachDate, type LocalDate, startOfWeek } from "../time";

export interface DayNutrition {
  date: LocalDate;
  mealCount: number;
  totals: NutrientTotals;
  byCategory: Record<string, NutrientTotals & { meals: number }>;
}

export interface DailyPoint {
  date: LocalDate;
  logged: boolean;
  mealCount: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** Trailing 7-day mean of logged days (needs ≥ 3 logged days). */
  calories7d: number | null;
  protein7d: number | null;
  goalCalories: number | null;
  goalProtein: number | null;
}

export interface WeeklyPoint {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  loggedDays: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  caloriesChange: number | null;
  proteinChange: number | null;
}

export interface NutritionSummary {
  range: { start: LocalDate; end: LocalDate; totalDays: number; loggedDays: number; completeness: number };
  averages: Record<NutrientKey, { value: number | null; days: number }>;
  extremes: {
    calories: { highest: { date: LocalDate; value: number } | null; lowest: { date: LocalDate; value: number } | null };
    protein: { highest: { date: LocalDate; value: number } | null; lowest: { date: LocalDate; value: number } | null };
  };
  avgMealsPerDay: number | null;
  adherence: Partial<Record<NutrientKey, { evaluated: number; met: number; pct: number }>>;
  allPrimaryMetPct: number | null;
  daily: DailyPoint[];
  weekly: WeeklyPoint[];
  variability: { avgAbsDayToDayCalories: number | null; sdCalories: number | null };
  categories: { category: string; meals: number; avgCalories: number; pctCalories: number; avgProtein: number; pctProtein: number }[];
  consistency: { loggedDays: number; totalDays: number; pct: number; currentStreak: number; longestStreak: number };
  calorieTrendPerWeek: number | null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function sd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values) as number;
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

function slope(xs: number[], ys: number[]): number | null {
  if (xs.length < 5) return null;
  const mx = mean(xs) as number;
  const my = mean(ys) as number;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  return sxx === 0 ? null : sxy / sxx;
}

export function summarizeNutrition(
  days: DayNutrition[],
  range: { start: LocalDate; end: LocalDate },
  goals: GoalVersion[],
  opts: { weekStartsOn?: number } = {},
): NutritionSummary {
  const weekStartsOn = opts.weekStartsOn ?? 1;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const dates = eachDate(range.start, range.end);
  const logged = dates.map((d) => byDate.get(d)).filter((d): d is DayNutrition => !!d && d.mealCount > 0);
  const loggedSet = new Set(logged.map((d) => d.date));

  // Averages per nutrient over logged days that report it.
  const averages = {} as NutritionSummary["averages"];
  for (const key of NUTRIENT_KEYS) {
    const vals = logged.map((d) => d.totals.values[key]).filter((v): v is number => v !== null);
    averages[key] = { value: mean(vals), days: vals.length };
  }

  const extreme = (key: NutrientKey) => {
    const vals = logged.filter((d) => d.totals.values[key] !== null).map((d) => ({ date: d.date, value: d.totals.values[key] as number }));
    if (!vals.length) return { highest: null, lowest: null };
    const sorted = [...vals].sort((a, b) => a.value - b.value);
    return { highest: sorted[sorted.length - 1], lowest: sorted[0] };
  };

  // Adherence: each logged day judged against the goals in force that day.
  const adherence: NutritionSummary["adherence"] = {};
  let allMetDays = 0;
  let allEvaluated = 0;
  for (const day of logged) {
    const targets = goalTargets(goalForDate(goals, day.date));
    let dayAll = true;
    let dayAny = false;
    for (const [k, target] of Object.entries(targets) as [NutrientKey, number][]) {
      const v = day.totals.values[k];
      if (v === null) continue;
      const ev = evaluateGoal(k, v, target);
      const a = (adherence[k] ??= { evaluated: 0, met: 0, pct: 0 });
      a.evaluated += 1;
      if (ev.met) a.met += 1;
      if (PRIMARY_KEYS.includes(k)) {
        dayAny = true;
        if (!ev.met) dayAll = false;
      }
    }
    if (dayAny) {
      allEvaluated += 1;
      if (dayAll) allMetDays += 1;
    }
  }
  for (const a of Object.values(adherence)) if (a) a.pct = a.evaluated ? a.met / a.evaluated : 0;

  // Daily series with trailing 7-day means over logged days (lookback can precede the range).
  const trailing = (date: LocalDate, key: NutrientKey) => {
    const vals: number[] = [];
    for (let i = 0; i < 7; i++) {
      const d = byDate.get(addDays(date, -i));
      const v = d && d.mealCount > 0 ? d.totals.values[key] : null;
      if (v != null) vals.push(v);
    }
    return vals.length >= 3 ? mean(vals) : null;
  };
  const daily: DailyPoint[] = dates.map((date) => {
    const d = byDate.get(date);
    const isLogged = loggedSet.has(date);
    const t = goalTargets(goalForDate(goals, date));
    return {
      date,
      logged: isLogged,
      mealCount: d?.mealCount ?? 0,
      calories: isLogged ? d!.totals.values.calories : null,
      protein: isLogged ? d!.totals.values.protein : null,
      carbs: isLogged ? d!.totals.values.carbs : null,
      fat: isLogged ? d!.totals.values.fat : null,
      calories7d: trailing(date, "calories"),
      protein7d: trailing(date, "protein"),
      goalCalories: t.calories ?? null,
      goalProtein: t.protein ?? null,
    };
  });

  // Weekly means over logged days.
  const weeks = new Map<LocalDate, DayNutrition[]>();
  for (const date of dates) {
    const ws = startOfWeek(date, weekStartsOn);
    if (!weeks.has(ws)) weeks.set(ws, []);
    const d = byDate.get(date);
    if (d && d.mealCount > 0) weeks.get(ws)!.push(d);
  }
  const weekly: WeeklyPoint[] = [];
  for (const [weekStart, ds] of [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const avg = (k: NutrientKey) => mean(ds.map((d) => d.totals.values[k]).filter((v): v is number => v !== null));
    const prev = weekly.at(-1);
    const calories = avg("calories");
    const protein = avg("protein");
    weekly.push({
      weekStart,
      weekEnd: addDays(weekStart, 6),
      loggedDays: ds.length,
      calories,
      protein,
      carbs: avg("carbs"),
      fat: avg("fat"),
      caloriesChange: prev?.calories != null && calories != null ? calories - prev.calories : null,
      proteinChange: prev?.protein != null && protein != null ? protein - prev.protein : null,
    });
  }

  // Day-to-day variability across consecutive logged days.
  const calSeries = logged.map((d) => d.totals.values.calories).filter((v): v is number => v !== null);
  const diffs: number[] = [];
  for (let i = 1; i < logged.length; i++) {
    const a = logged[i - 1];
    const b = logged[i];
    if (addDays(a.date, 1) !== b.date) continue;
    const va = a.totals.values.calories;
    const vb = b.totals.values.calories;
    if (va !== null && vb !== null) diffs.push(Math.abs(vb - va));
  }

  // Meal category composition.
  const catTotals = new Map<string, NutrientTotals & { meals: number }>();
  for (const d of logged) {
    for (const [cat, t] of Object.entries(d.byCategory)) {
      const prev = catTotals.get(cat);
      const merged = mergeTotals(prev ? [prev, t] : [t]);
      catTotals.set(cat, { ...merged, meals: (prev?.meals ?? 0) + t.meals });
    }
  }
  const totalCal = [...catTotals.values()].reduce((a, t) => a + (t.values.calories ?? 0), 0);
  const totalPro = [...catTotals.values()].reduce((a, t) => a + (t.values.protein ?? 0), 0);
  const categories = [...catTotals.entries()]
    .map(([category, t]) => ({
      category,
      meals: t.meals,
      avgCalories: logged.length ? (t.values.calories ?? 0) / logged.length : 0,
      pctCalories: totalCal ? (t.values.calories ?? 0) / totalCal : 0,
      avgProtein: logged.length ? (t.values.protein ?? 0) / logged.length : 0,
      pctProtein: totalPro ? (t.values.protein ?? 0) / totalPro : 0,
    }))
    .sort((a, b) => b.avgCalories - a.avgCalories);

  // Logging streaks.
  let longest = 0;
  let run = 0;
  for (const date of dates) {
    run = loggedSet.has(date) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (loggedSet.has(dates[i])) current++;
    else if (i === dates.length - 1) continue; // today may not be logged yet
    else break;
  }

  // Calorie trend (kcal/day change per week) over logged days.
  const idx = logged.filter((d) => d.totals.values.calories !== null);
  const s = slope(
    idx.map((d) => dates.indexOf(d.date)),
    idx.map((d) => d.totals.values.calories as number),
  );

  return {
    range: {
      start: range.start,
      end: range.end,
      totalDays: dates.length,
      loggedDays: logged.length,
      completeness: dates.length ? logged.length / dates.length : 0,
    },
    averages,
    extremes: { calories: extreme("calories"), protein: extreme("protein") },
    avgMealsPerDay: mean(logged.map((d) => d.mealCount)),
    adherence,
    allPrimaryMetPct: allEvaluated ? allMetDays / allEvaluated : null,
    daily,
    weekly,
    variability: { avgAbsDayToDayCalories: mean(diffs), sdCalories: sd(calSeries) },
    categories,
    consistency: {
      loggedDays: logged.length,
      totalDays: dates.length,
      pct: dates.length ? logged.length / dates.length : 0,
      currentStreak: current,
      longestStreak: longest,
    },
    calorieTrendPerWeek: s === null ? null : s * 7,
  };
}
