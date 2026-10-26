import type { DbOrTx } from "../db";
import type { Settings } from "../db/schema";
import { type DayNutrition, summarizeNutrition } from "../analytics/nutrition";
import { analyzeRelationship } from "../analytics/relationship";
import { mergeTotals } from "../nutrition/calc";
import { evaluateGoal, goalForDate, goalTargets, type GoalEvaluation } from "../nutrition/goals";
import { NUTRIENT_KEYS, type NutrientKey } from "../nutrition/nutrients";
import { addDays, eachDate, type LocalDate } from "../time";
import { formatWeight } from "../units";
import { buildDailyMap, dailySeries, rollingAverage } from "../weight/stats";
import { listMeals, mealTotalsRaw, totalsView, type MealView, type TotalsView } from "./meals";
import { listGoals, toGoalVersion } from "./settings";
import { listWeights } from "./weights";

export function nutritionDaysFromMeals(list: MealView[]): DayNutrition[] {
  const byDate = new Map<LocalDate, MealView[]>();
  for (const m of list) {
    if (!byDate.has(m.localDate)) byDate.set(m.localDate, []);
    byDate.get(m.localDate)!.push(m);
  }
  return [...byDate.entries()].map(([date, ms]) => {
    const byCategory: DayNutrition["byCategory"] = {};
    for (const cat of new Set(ms.map((m) => m.category))) {
      const cms = ms.filter((m) => m.category === cat);
      byCategory[cat] = { ...mergeTotals(cms.map((m) => mealTotalsRaw(m.items))), meals: cms.length };
    }
    return { date, mealCount: ms.length, totals: mergeTotals(ms.map((m) => mealTotalsRaw(m.items))), byCategory };
  });
}

export async function nutritionDays(db: DbOrTx, range: { start: LocalDate; end: LocalDate }): Promise<DayNutrition[]> {
  return nutritionDaysFromMeals(await listMeals(db, range));
}

export interface DaySummary {
  date: LocalDate;
  meals: MealView[];
  totals: TotalsView;
  goals: Partial<Record<NutrientKey, number>>;
  evaluations: Partial<Record<NutrientKey, GoalEvaluation>>;
  topContributors: {
    calories: { mealId: string; title: string; value: number; share: number }[];
    protein: { mealId: string; title: string; value: number; share: number }[];
  };
  weights: { morning: { id: string; weightKg: number; measuredAt: Date } | null; night: { id: string; weightKg: number; measuredAt: Date } | null };
}

export async function daySummary(db: DbOrTx, date: LocalDate): Promise<DaySummary> {
  const [meals, goalRows, weights] = await Promise.all([listMeals(db, { start: date, end: date }), listGoals(db), listWeights(db, { start: date, end: date })]);
  meals.sort((a, b) => a.eatenAt.getTime() - b.eatenAt.getTime());
  const raw = mergeTotals(meals.map((m) => mealTotalsRaw(m.items)));
  const totals = totalsView(raw);
  const goals = goalTargets(goalForDate(goalRows.map(toGoalVersion), date));
  const evaluations: DaySummary["evaluations"] = {};
  for (const [k, target] of Object.entries(goals) as [NutrientKey, number][]) {
    evaluations[k] = evaluateGoal(k, totals.values[k] ?? 0, target);
  }
  const contrib = (key: "calories" | "protein") => {
    const total = totals.values[key] ?? 0;
    return meals
      .map((m) => ({ mealId: m.id, title: m.title, value: m.totals.values[key] ?? 0 }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map((c) => ({ ...c, share: total > 0 ? c.value / total : 0 }));
  };
  const w = (p: "morning" | "night") => {
    const e = weights.find((x) => x.period === p);
    return e ? { id: e.id, weightKg: e.weightKg, measuredAt: e.measuredAt } : null;
  };
  return {
    date,
    meals,
    totals,
    goals,
    evaluations,
    topContributors: { calories: contrib("calories"), protein: contrib("protein") },
    weights: { morning: w("morning"), night: w("night") },
  };
}

/** Full analytics payload for a range: nutrition summary, weight series and relationship. */
export async function analyticsOverview(db: DbOrTx, range: { start: LocalDate; end: LocalDate }, s: Settings) {
  // Include a week of lookback so rolling averages are complete at the start of the range.
  const lookback = addDays(range.start, -7);
  const [days, goalRows, weights] = await Promise.all([
    nutritionDays(db, { start: lookback, end: range.end }),
    listGoals(db),
    listWeights(db, { start: lookback, end: range.end }),
  ]);
  const goals = goalRows.map(toGoalVersion);
  const summary = summarizeNutrition(days, range, goals, { weekStartsOn: s.weekStartsOn });
  const readings = weights.map((w) => ({ localDate: w.localDate, period: w.period, weightKg: w.weightKg }));
  const weightDays = dailySeries(readings, range.start, range.end);
  const map = buildDailyMap(readings);
  const rolling = rollingAverage(map, eachDate(range.start, range.end));
  const relationship = analyzeRelationship(days, weightDays, range, {
    weekStartsOn: s.weekStartsOn,
    formatWeight: (kg) => formatWeight(kg, s.weightUnit, 2),
  });
  const weightLoggedDays = weightDays.filter((d) => d.average !== null).length;
  return {
    range,
    nutrition: summary,
    weight: {
      days: weightDays.map((d, i) => ({ date: d.date, average: d.average, rolling7: rolling[i].value })),
      loggedDays: weightLoggedDays,
    },
    relationship,
    nutrientKeys: NUTRIENT_KEYS,
  };
}
