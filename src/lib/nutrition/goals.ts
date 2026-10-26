import type { LocalDate } from "../time";
import { NUTRIENT_BY_KEY, type GoalType, type NutrientKey } from "./nutrients";

export interface GoalVersion {
  effectiveFrom: LocalDate;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  extra: Partial<Record<NutrientKey, number>>;
}

/** Tolerance for "target" style goals (calories, carbs, fat). */
export const TARGET_TOLERANCE = 0.1;

/**
 * The goal version in force on `date`: the latest version effective on or before it.
 * Days before the first version use the first version (so a brand-new user's
 * first logged days are still judged against their goals).
 */
export function goalForDate<T extends GoalVersion>(versions: T[], date: LocalDate): T | null {
  if (versions.length === 0) return null;
  const sorted = [...versions].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  let found: T | null = null;
  for (const v of sorted) {
    if (v.effectiveFrom <= date) found = v;
    else break;
  }
  return found ?? sorted[0];
}

export function goalTargets(goal: GoalVersion | null): Partial<Record<NutrientKey, number>> {
  if (!goal) return {};
  const out: Partial<Record<NutrientKey, number>> = {};
  for (const [k, v] of Object.entries(goal.extra ?? {})) {
    if (typeof v === "number" && v > 0) out[k as NutrientKey] = v;
  }
  if (goal.calories) out.calories = goal.calories;
  if (goal.protein) out.protein = goal.protein;
  if (goal.carbs) out.carbs = goal.carbs;
  if (goal.fat) out.fat = goal.fat;
  return out;
}

export interface GoalEvaluation {
  goalType: GoalType;
  target: number;
  value: number;
  ratio: number;
  /** Positive = room left before the target/limit; negative = over. */
  remaining: number;
  met: boolean;
  status: "under" | "met" | "over";
}

export function evaluateGoal(key: NutrientKey, value: number, target: number): GoalEvaluation {
  const goalType = NUTRIENT_BY_KEY[key].goalType;
  const ratio = target > 0 ? value / target : 0;
  let met: boolean;
  let status: GoalEvaluation["status"];
  if (goalType === "target") {
    met = ratio >= 1 - TARGET_TOLERANCE && ratio <= 1 + TARGET_TOLERANCE;
    status = met ? "met" : ratio < 1 ? "under" : "over";
  } else if (goalType === "min") {
    met = value >= target;
    status = met ? "met" : "under";
  } else {
    met = value <= target;
    status = met ? "met" : "over";
  }
  return { goalType, target, value, ratio, remaining: target - value, met, status };
}

export function describeGoalRule(key: NutrientKey): string {
  const t = NUTRIENT_BY_KEY[key].goalType;
  if (t === "target") return `within ±${TARGET_TOLERANCE * 100}% of target`;
  if (t === "min") return "at or above target";
  return "at or below limit";
}
