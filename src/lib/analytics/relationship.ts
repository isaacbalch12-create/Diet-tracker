/**
 * Weight ↔ nutrition relationships. Everything here is descriptive: correlations
 * on small personal datasets are noisy, and energy-balance figures are rough
 * estimates (≈7,700 kcal per kg is an approximation that ignores water,
 * glycogen and measurement error). Observations are worded accordingly.
 */
import { type DailyWeight, linearTrend } from "../weight/stats";
import { addDays, type LocalDate, startOfWeek } from "../time";
import type { DayNutrition } from "./nutrition";

export const KCAL_PER_KG = 7700;

export interface WeekPair {
  weekStart: LocalDate;
  loggedDays: number;
  weightDays: number;
  avgCalories: number | null;
  avgProtein: number | null;
  avgWeight: number | null;
  /** Next week's average weight minus this week's. */
  weightChangeNextWeek: number | null;
}

export interface Observation {
  kind: "info" | "insufficient" | "pattern";
  text: string;
}

export interface Relationship {
  weeks: WeekPair[];
  correlation: { r: number; n: number; strength: string } | null;
  energyBalance: {
    avgCalories: number;
    weightSlopePerWeekKg: number;
    estimatedMaintenance: number;
    loggedDays: number;
    weightDays: number;
  } | null;
  observations: Observation[];
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs) as number;
  const my = mean(ys) as number;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function strength(r: number): string {
  const a = Math.abs(r);
  if (a < 0.2) return "negligible";
  if (a < 0.4) return "weak";
  if (a < 0.6) return "moderate";
  return "strong";
}

/** Minimum data per week for it to be used in comparisons. */
export const MIN_LOGGED_DAYS_PER_WEEK = 4;
export const MIN_WEIGHT_DAYS_PER_WEEK = 3;

export function analyzeRelationship(
  nutritionDays: DayNutrition[],
  weightDays: DailyWeight[],
  range: { start: LocalDate; end: LocalDate },
  opts: { weekStartsOn?: number; formatWeight?: (kg: number) => string } = {},
): Relationship {
  const weekStartsOn = opts.weekStartsOn ?? 1;
  const fmtW = opts.formatWeight ?? ((kg: number) => `${kg.toFixed(2)} kg`);
  const inRange = (d: LocalDate) => d >= range.start && d <= range.end;

  const weeksMap = new Map<LocalDate, { cals: number[]; prots: number[]; weights: number[] }>();
  const bucket = (date: LocalDate) => {
    const ws = startOfWeek(date, weekStartsOn);
    if (!weeksMap.has(ws)) weeksMap.set(ws, { cals: [], prots: [], weights: [] });
    return weeksMap.get(ws)!;
  };
  for (const d of nutritionDays) {
    if (!inRange(d.date) || d.mealCount === 0) continue;
    const b = bucket(d.date);
    if (d.totals.values.calories !== null) b.cals.push(d.totals.values.calories);
    if (d.totals.values.protein !== null) b.prots.push(d.totals.values.protein);
  }
  for (const w of weightDays) {
    if (!inRange(w.date) || w.average === null) continue;
    bucket(w.date).weights.push(w.average);
  }

  const weeks: WeekPair[] = [...weeksMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([weekStart, b]) => ({
      weekStart,
      loggedDays: b.cals.length,
      weightDays: b.weights.length,
      avgCalories: b.cals.length >= MIN_LOGGED_DAYS_PER_WEEK ? mean(b.cals) : null,
      avgProtein: b.prots.length >= MIN_LOGGED_DAYS_PER_WEEK ? mean(b.prots) : null,
      avgWeight: b.weights.length >= MIN_WEIGHT_DAYS_PER_WEEK ? mean(b.weights) : null,
      weightChangeNextWeek: null,
    }));
  for (let i = 0; i < weeks.length - 1; i++) {
    const a = weeks[i];
    const b = weeks[i + 1];
    if (addDays(a.weekStart, 7) === b.weekStart && a.avgWeight !== null && b.avgWeight !== null) {
      a.weightChangeNextWeek = b.avgWeight - a.avgWeight;
    }
  }

  const paired = weeks.filter((w) => w.avgCalories !== null && w.weightChangeNextWeek !== null);
  const r = pearson(
    paired.map((w) => w.avgCalories as number),
    paired.map((w) => w.weightChangeNextWeek as number),
  );
  const correlation = r === null ? null : { r, n: paired.length, strength: strength(r) };

  // Energy balance over the whole range (needs reasonably complete data).
  const loggedCals = nutritionDays
    .filter((d) => inRange(d.date) && d.mealCount > 0 && d.totals.values.calories !== null)
    .map((d) => d.totals.values.calories as number);
  const weightInRange = weightDays.filter((w) => inRange(w.date));
  const trend = linearTrend(weightInRange, 10);
  const avgCalories = mean(loggedCals);
  let energyBalance: Relationship["energyBalance"] = null;
  if (avgCalories !== null && loggedCals.length >= 14 && trend) {
    energyBalance = {
      avgCalories,
      weightSlopePerWeekKg: trend.slopePerWeek,
      estimatedMaintenance: avgCalories - trend.slopePerDay * KCAL_PER_KG,
      loggedDays: loggedCals.length,
      weightDays: trend.n,
    };
  }

  const observations: Observation[] = [];
  const usableWeeks = weeks.filter((w) => w.avgCalories !== null && w.avgWeight !== null).length;
  if (usableWeeks < 2) {
    observations.push({
      kind: "insufficient",
      text: `Not enough overlapping data yet: comparisons need weeks with at least ${MIN_LOGGED_DAYS_PER_WEEK} days of food logs and ${MIN_WEIGHT_DAYS_PER_WEEK} days of weigh-ins (found ${usableWeeks}).`,
    });
  }
  if (correlation) {
    if (correlation.n < 6) {
      observations.push({
        kind: "insufficient",
        text: `Only ${correlation.n} weeks can be paired, so the calorie–weight correlation (r = ${correlation.r.toFixed(2)}) is not reliable yet.`,
      });
    } else {
      const direction = correlation.r > 0 ? "higher-calorie weeks tended to be followed by weight increases" : "higher-calorie weeks tended to be followed by weight decreases";
      observations.push({
        kind: correlation.strength === "negligible" ? "info" : "pattern",
        text:
          correlation.strength === "negligible"
            ? `Across ${correlation.n} paired weeks there is no clear link between weekly calories and next week's weight change (r = ${correlation.r.toFixed(2)}).`
            : `Across ${correlation.n} paired weeks, ${direction} (${correlation.strength} correlation, r = ${correlation.r.toFixed(2)}). This is an association in your data, not proof of cause — water, sodium, and logging gaps also move the scale.`,
      });
    }
  }
  if (energyBalance) {
    const dir = energyBalance.weightSlopePerWeekKg;
    observations.push({
      kind: "info",
      text: `Over this period you averaged ${Math.round(energyBalance.avgCalories).toLocaleString()} kcal on ${energyBalance.loggedDays} logged days while your weight trend moved ${dir >= 0 ? "+" : "−"}${fmtW(Math.abs(dir))}/week. That suggests a very rough maintenance estimate near ${Math.round(energyBalance.estimatedMaintenance / 50) * 50} kcal/day — treat it as a ballpark, since it assumes complete logging and ~7,700 kcal per kg.`,
    });
  } else if (loggedCals.length > 0) {
    observations.push({
      kind: "insufficient",
      text: "A maintenance-calorie estimate needs at least 14 logged days and 10 weigh-in days in the selected range.",
    });
  }
  return { weeks, correlation, energyBalance, observations };
}
