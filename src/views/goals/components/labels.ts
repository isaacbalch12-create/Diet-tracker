/**
 * Display helpers for goals: category metadata, human labels, and formatting of
 * canonical goal values (kg, m, ml, min, fraction…) in the user's units.
 */
import { Dumbbell, Footprints, HeartPulse, ListChecks, Scale, Sparkles, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { DOMAIN_COLORS } from "@/components/kit";
import type { GoalJ2, SettingsJ } from "@/lib/client/types";
import { displayUnit, fmtGoalValue, type UnitPrefs } from "@/lib/client/units";
import type { GoalCategory, GoalComparator, GoalPeriod, GoalStatus } from "@/lib/db/schema";
import type { Aggregation, CanonicalUnit } from "@/lib/goals/catalog";
import { formatLocalDate } from "@/lib/time";

export type GoalPeriodJ = GoalJ2["recent"][number];

export const CATEGORY_ORDER: GoalCategory[] = ["nutrition", "body", "exercise", "running", "health", "routine", "custom"];

export const CATEGORY_META: Record<GoalCategory, { label: string; icon: LucideIcon; color: string; blurb: string }> = {
  nutrition: { label: "Nutrition", icon: UtensilsCrossed, color: DOMAIN_COLORS.nutrition, blurb: "Calories, macros, water, any nutrient" },
  body: { label: "Body", icon: Scale, color: DOMAIN_COLORS.body, blurb: "Target weight, rate of change, weigh-ins" },
  exercise: { label: "Exercise", icon: Dumbbell, color: DOMAIN_COLORS.exercise, blurb: "Workouts, lifts, sets, reps, PRs" },
  running: { label: "Running", icon: Footprints, color: DOMAIN_COLORS.running, blurb: "Run streaks, distance, consistency" },
  health: { label: "Health", icon: HeartPulse, color: DOMAIN_COLORS.health, blurb: "Steps, sleep, heart rate, HRV, energy" },
  routine: { label: "Routines", icon: ListChecks, color: DOMAIN_COLORS.routine, blurb: "Morning/night routines, reading, journaling, mobility" },
  custom: { label: "Custom", icon: Sparkles, color: DOMAIN_COLORS.custom, blurb: "Any habit you check in by hand" },
};

export const COMPARATOR_LABELS: Record<GoalComparator, string> = { at_least: "At least", at_most: "At most", range: "Between" };

export const PERIOD_LABELS: Record<GoalPeriod, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Custom" };

export const AGG_LABELS: Record<Aggregation, string> = {
  avg: "Average per day",
  sum: "Total",
  count: "Days meeting a daily target",
  level: "Latest value",
  pct: "Share of days",
  rate: "Trend per week",
};

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = { active: "Active", paused: "Paused", completed: "Completed", archived: "Archived" };

export function prefsOf(s: Pick<SettingsJ, "weightUnit" | "distanceUnit" | "waterUnit">): UnitPrefs {
  return { weightUnit: s.weightUnit, distanceUnit: s.distanceUnit, waterUnit: s.waterUnit };
}

type UnitLike = Pick<GoalJ2, "aggregation" | "unit">;

/** "Days meeting a daily target" goals count days, whatever the metric's own unit. */
export function countsDays(g: UnitLike): boolean {
  return g.aggregation === "count" && g.unit !== "days";
}

/** Unit of the goal's period values and targets. */
export function valueUnit(g: UnitLike): CanonicalUnit {
  return countsDays(g) ? "days" : g.unit;
}

const SINGULAR: Partial<Record<CanonicalUnit, string>> = { days: "day", workouts: "workout", sets: "set", reps: "rep", records: "record", pages: "page", sessions: "session", steps: "step" };

/** fmtGoalValue with singular units ("1 day", "1 workout"). */
export function fmtValue(v: number | null | undefined, unit: CanonicalUnit, prefs: UnitPrefs, custom?: string | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = fmtGoalValue(v, unit, prefs, custom);
  if (unit === "score" || unit === "count") return s.replace(/ (score|count)$/, "");
  const one = SINGULAR[unit];
  if (one && s === `1 ${unit}`) return `1 ${one}`;
  return s;
}

/** "2,000–2,400 kcal", "−0.5 to −0.25 lb/week". */
export function fmtRange(lo: number, hi: number, unit: CanonicalUnit, prefs: UnitPrefs, custom?: string | null): string {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  let left = fmtValue(a, unit, prefs, custom);
  const right = fmtValue(b, unit, prefs, custom);
  const label = displayUnit(unit, prefs, custom);
  if (label && unit !== "min" && unit !== "fraction" && left.endsWith(` ${label}`)) left = left.slice(0, -label.length - 1);
  return a < 0 || b < 0 ? `${left} to ${right}` : `${left}–${right}`;
}

type TargetLike = Pick<GoalJ2, "aggregation" | "unit" | "comparator" | "center" | "unitLabel">;

/** "≥ 120 g", "≤ 2,300 mg", "2,000–2,400 kcal", "2,200 kcal ±10%". */
export function fmtTarget(g: TargetLike, target: number, max: number | null, prefs: UnitPrefs): string {
  const unit = valueUnit(g);
  if (g.comparator === "range" && max != null) {
    if (g.center != null) {
      const c = (target + max) / 2;
      const tol = c !== 0 ? Math.round((Math.abs(max - target) / 2 / Math.abs(c)) * 100) : 0;
      return `${fmtValue(c, unit, prefs, g.unitLabel)} ±${tol}%`;
    }
    return fmtRange(target, max, unit, prefs, g.unitLabel);
  }
  const v = fmtValue(target, unit, prefs, g.unitLabel);
  return g.comparator === "at_most" ? `≤ ${v}` : `≥ ${v}`;
}

/** Targets the user reads as a sentence: "at least 120 g". */
export function fmtTargetWords(g: TargetLike, target: number, max: number | null, prefs: UnitPrefs): string {
  const t = fmtTarget(g, target, max, prefs);
  if (g.comparator === "at_least") return `at least ${t.slice(2)}`;
  if (g.comparator === "at_most") return `at most ${t.slice(2)}`;
  return g.center != null ? `${t}` : `between ${t}`;
}

/** Daily yes/no goals (run every day, weigh in every morning, custom "done" habits). */
export function isBinary(g: Pick<GoalJ2, "period" | "aggregation" | "unit" | "metric" | "targetValue" | "comparator">): boolean {
  if (g.period !== "daily" || g.comparator !== "at_least") return false;
  if (valueUnit(g) === "days") return true;
  return g.metric === "custom" && g.targetValue === 1;
}

/** Value as shown on a card: "Done" for yes/no goals, else a formatted value. */
export function fmtPeriodValue(g: GoalJ2, v: number | null | undefined, prefs: UnitPrefs, current = false): string {
  if (isBinary(g)) {
    if (v == null) return current ? "Not yet" : "No data";
    return v >= 1 ? "Done" : current ? "Not yet" : "Not done";
  }
  return fmtValue(v, valueUnit(g), prefs, g.unitLabel);
}

export function shortDay(d: string): string {
  return formatLocalDate(d, { month: "short", day: "numeric" });
}

/** "Mon, Nov 3" or "Nov 1 – Nov 7". */
export function rangeLabel(p: { start: string; end: string }): string {
  if (p.start === p.end) return formatLocalDate(p.start);
  return `${shortDay(p.start)} – ${shortDay(p.end)}`;
}

/** Label for the current period: "Today", "This week", "This month", or "Nov 1 – Nov 7". */
export function periodLabel(g: Pick<GoalJ2, "period">, p: { start: string; end: string } | null, today: string): string {
  if (!p) return "";
  const current = p.start <= today && p.end >= today;
  if (g.period === "daily") return p.start === today ? "Today" : formatLocalDate(p.start);
  if (current && g.period === "weekly") return "This week";
  if (current && g.period === "monthly") return "This month";
  return rangeLabel(p);
}

/** "daily", "per week", "per month", "every 10 days". */
export function periodWord(period: GoalPeriod, periodDays: number | null): string {
  if (period === "daily") return "daily";
  if (period === "weekly") return "per week";
  if (period === "monthly") return "per month";
  return `every ${periodDays ?? 7} days`;
}

/** "Daily", "Weekly", "Monthly", "Every 10 days". */
export function scheduleLabel(period: GoalPeriod, periodDays: number | null): string {
  return period === "custom" ? `Every ${periodDays ?? 7} days` : PERIOD_LABELS[period];
}

export function plural(n: number, unit: string): string {
  const one = unit.replace(/s$/, "");
  return `${n} ${n === 1 ? one : unit}`;
}

/** "Met 18 of 21 days". */
export function successText(g: Pick<GoalJ2, "met" | "judged" | "streak">): string {
  if (!g.judged) return "No finished periods yet";
  const unit = g.streak.unit;
  return `Met ${g.met} of ${plural(g.judged, unit)}`;
}

/** Whether the current value is on the right side of the target. */
export function onTrackText(g: GoalJ2): string | null {
  const c = g.current;
  if (!c || c.value == null || c.status !== "in_progress") return null;
  if (c.meetsNow) return g.comparator === "at_least" ? "On target" : "On track";
  if (g.comparator === "at_most") return "Over the limit";
  if (g.comparator === "range") {
    const lo = Math.min(c.target, c.targetMax ?? c.target);
    return c.value < lo ? "Below range" : "Above range";
  }
  return "Below target";
}

export function sectionHref(g: Pick<GoalJ2, "linked">): string | null {
  if (g.linked === "nutrition") return "/goals#nutrition-targets";
  if (g.linked === "target_weight") return "/goals#weight-goals";
  return null;
}

export function linkedSectionLabel(g: Pick<GoalJ2, "linked">): string {
  return g.linked === "nutrition" ? "Edit nutrition targets" : "Edit weight goals";
}

/** Bring a section on the goals page into view and record it in the URL hash. */
export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  if (window.location.hash !== `#${id}`) window.history.replaceState(window.history.state, "", `#${id}`);
  return true;
}
