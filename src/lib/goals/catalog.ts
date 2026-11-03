/**
 * Every metric a goal can track. Values are stored in canonical units
 * (kg, meters, ml, minutes, fractions) and converted for display in the UI.
 */
import type { GoalCategory, GoalComparator, GoalPeriod } from "../db/schema";
import { NUTRIENT_BY_KEY, NUTRIENT_KEYS, type NutrientKey } from "../nutrition/nutrients";

/**
 * How daily values combine over a period:
 * - sum:   total (distance, steps, workouts, pages)
 * - avg:   average of days with data (calories, sleep)
 * - count: number of days that qualify (run days, journal days, weigh-ins)
 * - level: the latest value in the period (body weight, best lift so far)
 * - pct:   share of eligible days that qualified (running consistency)
 * - rate:  trend per week, fitted over the 3 weeks ending with the period (weight change)
 */
export type Aggregation = "sum" | "avg" | "count" | "level" | "pct" | "rate";

export type CanonicalUnit = "kcal" | "g" | "mg" | "µg" | "ml" | "kg" | "kg_per_week" | "m" | "steps" | "min" | "score" | "bpm" | "ms" | "workouts" | "sets" | "reps" | "days" | "fraction" | "records" | "pages" | "sessions" | "count" | "custom";

export interface ParamDef {
  key: "nutrient" | "exerciseId" | "slot" | "weighIn" | "reps" | "minDistanceM" | "unitLabel";
  label: string;
  required: boolean;
}

export interface MetricDef {
  key: string;
  category: GoalCategory;
  label: string;
  description: string;
  unit: CanonicalUnit;
  periods: GoalPeriod[];
  defaultPeriod: GoalPeriod;
  comparators: GoalComparator[];
  defaultComparator: GoalComparator;
  /** Aggregation for multi-day periods (daily periods use the day's value). Some metrics let the user choose. */
  aggregations: Aggregation[];
  params: ParamDef[];
  /** Suggested target in canonical units. */
  suggestion?: number;
  /** Daily goals on this metric skip planned rest/recovery days. */
  restDaysExcused?: boolean;
}

const ALL_PERIODS: GoalPeriod[] = ["daily", "weekly", "monthly", "custom"];
const MULTI: GoalPeriod[] = ["weekly", "monthly", "custom"];

export const METRICS: MetricDef[] = [
  // Nutrition
  { key: "nutrient", category: "nutrition", label: "Nutrient intake", description: "Calories, protein, carbs, fat or any tracked nutrient, from your logged meals.", unit: "g", periods: ALL_PERIODS, defaultPeriod: "daily", comparators: ["at_least", "at_most", "range"], defaultComparator: "at_least", aggregations: ["avg", "sum", "count"], params: [{ key: "nutrient", label: "Nutrient", required: true }] },
  { key: "water", category: "nutrition", label: "Water", description: "Water you log through the day.", unit: "ml", periods: ALL_PERIODS, defaultPeriod: "daily", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["avg", "sum", "count"], params: [], suggestion: 2500 },
  { key: "meals_logged", category: "nutrition", label: "Days with meals logged", description: "Consistency of food logging.", unit: "days", periods: MULTI, defaultPeriod: "weekly", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["count"], params: [], suggestion: 7 },

  // Body
  { key: "weight_target", category: "body", label: "Target body weight", description: "Your 7-day average weight compared with a target.", unit: "kg", periods: ["daily"], defaultPeriod: "daily", comparators: ["at_most", "at_least"], defaultComparator: "at_most", aggregations: ["level"], params: [] },
  { key: "weight_rate", category: "body", label: "Weight trend", description: "Rate of weight change per week (fitted over 3 weeks), e.g. lose 0.25–0.5 kg per week.", unit: "kg_per_week", periods: ["weekly"], defaultPeriod: "weekly", comparators: ["range", "at_most", "at_least"], defaultComparator: "range", aggregations: ["rate"], params: [] },
  { key: "weigh_ins", category: "body", label: "Weigh-ins", description: "Days with a morning, night or any weigh-in.", unit: "days", periods: ALL_PERIODS, defaultPeriod: "daily", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["count"], params: [{ key: "weighIn", label: "Which weigh-in", required: true }], suggestion: 1 },

  // Exercise
  { key: "workouts", category: "exercise", label: "Workouts", description: "Strength workouts with at least one completed working set.", unit: "workouts", periods: MULTI, defaultPeriod: "weekly", comparators: ["at_least", "range"], defaultComparator: "at_least", aggregations: ["sum"], params: [], suggestion: 3 },
  { key: "exercise_e1rm", category: "exercise", label: "Estimated 1RM", description: "Best estimated one-rep max reached for an exercise.", unit: "kg", periods: ["daily"], defaultPeriod: "daily", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["level"], params: [{ key: "exerciseId", label: "Exercise", required: true }] },
  { key: "exercise_weight_reps", category: "exercise", label: "Weight for reps", description: "Lift a target weight for a number of reps (e.g. 225 lb × 5).", unit: "kg", periods: ["daily"], defaultPeriod: "daily", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["level"], params: [{ key: "exerciseId", label: "Exercise", required: true }, { key: "reps", label: "Reps", required: true }] },
  { key: "exercise_sets", category: "exercise", label: "Sets of an exercise", description: "Completed working sets of one exercise (or all exercises).", unit: "sets", periods: MULTI, defaultPeriod: "weekly", comparators: ["at_least", "range"], defaultComparator: "at_least", aggregations: ["sum"], params: [{ key: "exerciseId", label: "Exercise (optional)", required: false }], suggestion: 10 },
  { key: "exercise_reps", category: "exercise", label: "Reps of an exercise", description: "Total reps of one exercise (or all exercises).", unit: "reps", periods: ALL_PERIODS, defaultPeriod: "weekly", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["sum"], params: [{ key: "exerciseId", label: "Exercise (optional)", required: false }], suggestion: 100 },
  { key: "exercise_volume", category: "exercise", label: "Training volume", description: "Weight × reps for one exercise or all training.", unit: "kg", periods: MULTI, defaultPeriod: "weekly", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["sum"], params: [{ key: "exerciseId", label: "Exercise (optional)", required: false }] },
  { key: "exercise_sessions", category: "exercise", label: "Sessions of an exercise", description: "How often you train a specific exercise.", unit: "sessions", periods: MULTI, defaultPeriod: "weekly", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["sum"], params: [{ key: "exerciseId", label: "Exercise", required: true }], suggestion: 2 },
  { key: "prs", category: "exercise", label: "Personal records", description: "Records broken (heaviest weight, best e1RM, rep and volume records).", unit: "records", periods: MULTI, defaultPeriod: "monthly", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["sum"], params: [{ key: "exerciseId", label: "Exercise (optional)", required: false }], suggestion: 2 },

  // Running
  { key: "run_completed", category: "running", label: "Run every day", description: "A run logged each day (meeting your minimum distance, if set). Planned rest and recovery days are excused.", unit: "days", periods: ["daily"], defaultPeriod: "daily", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["count"], params: [{ key: "minDistanceM", label: "Minimum distance (optional)", required: false }], suggestion: 1, restDaysExcused: true },
  { key: "run_distance", category: "running", label: "Running distance", description: "Distance run per day, week or month.", unit: "m", periods: ALL_PERIODS, defaultPeriod: "weekly", comparators: ["at_least", "range"], defaultComparator: "at_least", aggregations: ["sum"], params: [], suggestion: 20_000, restDaysExcused: true },
  { key: "run_days", category: "running", label: "Run days", description: "Days with a run in the period.", unit: "days", periods: MULTI, defaultPeriod: "weekly", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["count"], params: [], suggestion: 5 },
  { key: "run_consistency", category: "running", label: "Running consistency", description: "Share of days you ran, not counting planned rest and recovery days.", unit: "fraction", periods: MULTI, defaultPeriod: "monthly", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["pct"], params: [], suggestion: 0.9 },

  // Health
  { key: "steps", category: "health", label: "Steps", description: "Daily steps synced from your phone (or entered by hand).", unit: "steps", periods: ALL_PERIODS, defaultPeriod: "daily", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["avg", "sum", "count"], params: [], suggestion: 8000 },
  { key: "sleep_duration", category: "health", label: "Sleep duration", description: "Time asleep per night from your phone or watch.", unit: "min", periods: ALL_PERIODS, defaultPeriod: "daily", comparators: ["at_least", "range"], defaultComparator: "at_least", aggregations: ["avg", "count"], params: [], suggestion: 450 },
  { key: "sleep_score", category: "health", label: "Sleep score", description: "Only available when a connected device or app provides its own score.", unit: "score", periods: ALL_PERIODS, defaultPeriod: "daily", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["avg", "count"], params: [], suggestion: 80 },
  { key: "resting_hr", category: "health", label: "Resting heart rate", description: "Resting heart rate from your watch.", unit: "bpm", periods: ALL_PERIODS, defaultPeriod: "weekly", comparators: ["at_most", "range"], defaultComparator: "at_most", aggregations: ["avg"], params: [] },
  { key: "hrv", category: "health", label: "Heart rate variability", description: "HRV from your watch.", unit: "ms", periods: ALL_PERIODS, defaultPeriod: "weekly", comparators: ["at_least", "range"], defaultComparator: "at_least", aggregations: ["avg"], params: [] },
  { key: "active_energy", category: "health", label: "Active energy", description: "Active calories estimated by your device.", unit: "kcal", periods: ALL_PERIODS, defaultPeriod: "daily", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["avg", "sum"], params: [] },

  // Routines
  { key: "routine_completion", category: "routine", label: "Routine completion", description: "Share of a routine's required activities completed each day.", unit: "fraction", periods: ["daily"], defaultPeriod: "daily", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["avg"], params: [{ key: "slot", label: "Routine", required: true }], suggestion: 1 },
  { key: "routine_days", category: "routine", label: "Complete routine days", description: "Days the whole routine was completed.", unit: "days", periods: MULTI, defaultPeriod: "weekly", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["count"], params: [{ key: "slot", label: "Routine", required: true }], suggestion: 6 },
  { key: "reading", category: "routine", label: "Reading", description: "Pages (or your chosen unit) recorded in routine reading activities.", unit: "pages", periods: ALL_PERIODS, defaultPeriod: "daily", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["sum", "avg", "count"], params: [{ key: "slot", label: "Routine (optional)", required: false }], suggestion: 20 },
  { key: "journal_days", category: "routine", label: "Journaling", description: "Days with a journal entry.", unit: "days", periods: ALL_PERIODS, defaultPeriod: "weekly", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["count"], params: [{ key: "slot", label: "Routine (optional)", required: false }], suggestion: 7 },
  { key: "mobility_days", category: "routine", label: "Stretching & mobility", description: "Days your mobility activity was completed.", unit: "days", periods: ALL_PERIODS, defaultPeriod: "weekly", comparators: ["at_least"], defaultComparator: "at_least", aggregations: ["count"], params: [{ key: "slot", label: "Routine (optional)", required: false }], suggestion: 7 },

  // Custom
  { key: "custom", category: "custom", label: "Custom (tracked by hand)", description: "Anything else — check in each day with a value (1 = done).", unit: "custom", periods: ALL_PERIODS, defaultPeriod: "daily", comparators: ["at_least", "at_most"], defaultComparator: "at_least", aggregations: ["sum", "count", "avg"], params: [{ key: "unitLabel", label: "Unit label", required: false }], suggestion: 1 },
];

export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<string, MetricDef>;

export function isNutrientKey(v: unknown): v is NutrientKey {
  return typeof v === "string" && (NUTRIENT_KEYS as readonly string[]).includes(v);
}

/** Canonical unit of a goal (nutrient goals use the nutrient's unit). */
export function goalUnit(metric: string, params: Record<string, unknown>): CanonicalUnit {
  if (metric === "nutrient" && isNutrientKey(params.nutrient)) return NUTRIENT_BY_KEY[params.nutrient].unit as CanonicalUnit;
  return METRIC_BY_KEY[metric]?.unit ?? "count";
}

/** The default aggregation for a metric over multi-day periods. */
export function defaultAggregation(metric: string): Aggregation {
  return METRIC_BY_KEY[metric]?.aggregations[0] ?? "sum";
}
