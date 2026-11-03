/** One-tap goal presets. Each fills the form; everything stays editable before saving. */
import type { SettingsResponse } from "@/lib/client/types";
import type { UnitPrefs } from "@/lib/client/units";
import type { GoalCategory } from "@/lib/db/schema";
import { draftForMetric, type Draft } from "./draft";

export interface PresetCtx {
  prefs: UnitPrefs;
  settings: SettingsResponse;
}

export interface Preset {
  id: string;
  category: GoalCategory;
  label: (ctx: PresetCtx) => string;
  hint: string;
  /** Pre-filled search for the exercise picker. */
  exerciseQuery?: string;
  apply: (base: Draft, ctx: PresetCtx) => Draft;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

function proteinTarget(ctx: PresetCtx): number {
  return Math.round(ctx.settings.goals?.protein ?? 140);
}

function calorieRange(ctx: PresetCtx): [number, number] {
  const c = ctx.settings.goals?.calories;
  return c ? [round(c * 0.9, 10), round(c * 1.1, 10)] : [1800, 2200];
}

const weeklyRun = (p: UnitPrefs) => (p.distanceUnit === "mi" ? 15 : 25);
const waterAmount = (p: UnitPrefs) => (p.waterUnit === "oz" ? "80 oz" : "2.5 L");

export const PRESETS: Preset[] = [
  {
    id: "run-daily",
    category: "running",
    label: () => "Run every day",
    hint: "Rest and recovery days are excused",
    apply: (b, { prefs }) => draftForMetric(b, "run_completed", prefs),
  },
  {
    id: "run-weekly",
    category: "running",
    label: ({ prefs }) => `Run ${weeklyRun(prefs)} ${prefs.distanceUnit} per week`,
    hint: "Weekly distance",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "run_distance", prefs), period: "weekly", target: String(weeklyRun(prefs)) }),
  },
  {
    id: "protein",
    category: "nutrition",
    label: (ctx) => `Protein ≥ ${proteinTarget(ctx)} g daily`,
    hint: "From logged meals",
    apply: (b, ctx) => ({ ...draftForMetric({ ...b, nutrient: "protein" }, "nutrient", ctx.prefs), nutrient: "protein", comparator: "at_least", period: "daily", target: String(proteinTarget(ctx)) }),
  },
  {
    id: "calories-range",
    category: "nutrition",
    label: () => "Calories within a range",
    hint: "Daily lower and upper bound",
    apply: (b, ctx) => {
      const [lo, hi] = calorieRange(ctx);
      return { ...draftForMetric({ ...b, nutrient: "calories" }, "nutrient", ctx.prefs), nutrient: "calories", comparator: "range", period: "daily", target: String(lo), targetMax: String(hi) };
    },
  },
  {
    id: "water",
    category: "nutrition",
    label: ({ prefs }) => `Water ${waterAmount(prefs)} daily`,
    hint: "Logged water",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "water", prefs), period: "daily", target: prefs.waterUnit === "oz" ? "80" : "2500" }),
  },
  {
    id: "steps",
    category: "health",
    label: () => "8,000 steps daily",
    hint: "Synced from your phone",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "steps", prefs), period: "daily", target: "8000" }),
  },
  {
    id: "sleep",
    category: "health",
    label: () => "Sleep 7.5 h nightly",
    hint: "From your phone or watch",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "sleep_duration", prefs), period: "daily", target: "7.5" }),
  },
  {
    id: "workouts",
    category: "exercise",
    label: () => "3 workouts per week",
    hint: "Strength sessions",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "workouts", prefs), period: "weekly", target: "3" }),
  },
  {
    id: "lift",
    category: "exercise",
    label: ({ prefs }) => `Bench ${prefs.weightUnit === "lb" ? "225 lb" : "100 kg"} × 5`,
    hint: "Any lift, weight × reps",
    exerciseQuery: "bench",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "exercise_weight_reps", prefs), reps: "5", target: prefs.weightUnit === "lb" ? "225" : "100" }),
  },
  {
    id: "morning",
    category: "routine",
    label: () => "Morning routine daily",
    hint: "Every required activity",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "routine_completion", prefs), slot: "morning", target: "100" }),
  },
  {
    id: "night",
    category: "routine",
    label: () => "Nightly routine daily",
    hint: "Every required activity",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "routine_completion", prefs), slot: "night", target: "100" }),
  },
  {
    id: "read",
    category: "routine",
    label: () => "Read 20 pages daily",
    hint: "From routine reading",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "reading", prefs), period: "daily", target: "20" }),
  },
  {
    id: "journal",
    category: "routine",
    label: () => "Journal 7× per week",
    hint: "Days with an entry",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "journal_days", prefs), period: "weekly", target: "7" }),
  },
  {
    id: "mobility",
    category: "routine",
    label: () => "Mobility 6× per week",
    hint: "Stretching & mobility days",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "mobility_days", prefs), period: "weekly", target: "6" }),
  },
  {
    id: "weigh-in",
    category: "body",
    label: () => "Weigh in every morning",
    hint: "Morning weigh-in streak",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "weigh_ins", prefs), weighIn: "morning", period: "daily" }),
  },
  {
    id: "lose",
    category: "body",
    label: ({ prefs }) => `Lose 0.25–0.5 ${prefs.weightUnit} per week`,
    hint: "Fitted weight trend",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "weight_rate", prefs), comparator: "range", period: "weekly", target: "-0.5", targetMax: "-0.25" }),
  },
  {
    id: "custom",
    category: "custom",
    label: () => "Custom habit",
    hint: "Check in by hand",
    apply: (b, { prefs }) => ({ ...draftForMetric(b, "custom", prefs), period: "daily", target: "1" }),
  },
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p])) as Record<string, Preset>;
