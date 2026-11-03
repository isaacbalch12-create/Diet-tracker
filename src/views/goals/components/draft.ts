/**
 * The create/edit form model: a draft of display-unit strings, plus conversion
 * to the API payload (canonical units), validation and title suggestions.
 */
import type { GoalJ2 } from "@/lib/client/types";
import { displayUnit, fromDisplay, toDisplay, type UnitPrefs } from "@/lib/client/units";
import type { GoalComparator, GoalPeriod } from "@/lib/db/schema";
import { goalUnit, METRIC_BY_KEY, type Aggregation, type CanonicalUnit, type MetricDef } from "@/lib/goals/catalog";
import { NUTRIENT_BY_KEY, type NutrientKey } from "@/lib/nutrition/nutrients";
import { periodWord, valueUnit } from "./labels";

export type Slot = "morning" | "night" | "both" | "any";

export interface Draft {
  metric: string;
  title: string;
  titleTouched: boolean;
  nutrient: string;
  exerciseId: string;
  exerciseName: string;
  slot: Slot;
  weighIn: Slot;
  reps: string;
  minDistance: string;
  unitLabel: string;
  comparator: GoalComparator;
  target: string;
  targetMax: string;
  period: GoalPeriod;
  periodDays: string;
  /** "" = the metric's default way of combining days. */
  agg: Aggregation | "";
  dailyThreshold: string;
  dailyComparator: "at_least" | "at_most";
  startDate: string;
  endDate: string;
  notes: string;
  showOnDashboard: boolean;
}

export interface GoalPayload {
  title: string;
  metric: string;
  params: Record<string, unknown>;
  comparator: GoalComparator;
  targetValue: number;
  targetMax: number | null;
  period: GoalPeriod;
  periodDays: number | null;
  startDate: string;
  endDate: string | null;
  showOnDashboard: boolean;
  notes: string | null;
}

export type FieldErrors = Partial<Record<string, string>>;

export function num(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const INPUT_DECIMALS: Partial<Record<CanonicalUnit, number>> = { kg: 1, kg_per_week: 2, m: 2, ml: 0, min: 2, fraction: 0 };

/** Canonical value → string for an input in display units. */
export function toInput(v: number | null | undefined, unit: CanonicalUnit, prefs: UnitPrefs): string {
  if (v == null || !Number.isFinite(v)) return "";
  const d = toDisplay(v, unit, prefs);
  const dec = unit === "ml" && prefs.waterUnit === "oz" ? 1 : (INPUT_DECIMALS[unit] ?? 2);
  return String(Number(d.toFixed(dec)));
}

/** Label next to an input ("lb", "hours", "%", "days"). */
export function inputUnitLabel(unit: CanonicalUnit, prefs: UnitPrefs, custom?: string | null): string {
  if (unit === "custom") return custom?.trim() || "";
  return displayUnit(unit, prefs, custom);
}

export function metricDef(d: Pick<Draft, "metric">): MetricDef | undefined {
  return METRIC_BY_KEY[d.metric];
}

/** The aggregation the server will use for this draft. */
export function effectiveAgg(d: Pick<Draft, "metric" | "period" | "agg">): Aggregation {
  const def = METRIC_BY_KEY[d.metric];
  if (!def) return "sum";
  if (d.period === "daily") return def.aggregations.includes("level") ? "level" : def.aggregations[0];
  return d.agg && def.aggregations.includes(d.agg) ? d.agg : def.aggregations[0];
}

/** Canonical unit of the metric itself (nutrients use the nutrient's unit). */
export function metricUnit(d: Pick<Draft, "metric" | "nutrient">): CanonicalUnit {
  return goalUnit(d.metric, d.nutrient ? { nutrient: d.nutrient } : {});
}

/** Unit of the target: days for "days meeting a daily target", else the metric unit. */
export function targetUnit(d: Pick<Draft, "metric" | "nutrient" | "period" | "agg">): CanonicalUnit {
  return valueUnit({ aggregation: effectiveAgg(d), unit: metricUnit(d) });
}

/** Daily yes/no goals have a fixed target of one day. */
export function isFixedDaily(d: Pick<Draft, "metric" | "nutrient" | "period" | "agg">): boolean {
  return d.period === "daily" && targetUnit(d) === "days";
}

export function needsThreshold(d: Pick<Draft, "metric" | "nutrient" | "period" | "agg">): boolean {
  return effectiveAgg(d) === "count" && metricUnit(d) !== "days";
}

export function blankDraft(today: string): Draft {
  return {
    metric: "",
    title: "",
    titleTouched: false,
    nutrient: "",
    exerciseId: "",
    exerciseName: "",
    slot: "any",
    weighIn: "any",
    reps: "5",
    minDistance: "",
    unitLabel: "",
    comparator: "at_least",
    target: "",
    targetMax: "",
    period: "daily",
    periodDays: "7",
    agg: "",
    dailyThreshold: "",
    dailyComparator: "at_least",
    startDate: today,
    endDate: "",
    notes: "",
    showOnDashboard: true,
  };
}

/** Defaults for a freshly chosen metric (keeps dates, notes and dashboard choice). */
export function draftForMetric(prev: Draft, metric: string, prefs: UnitPrefs): Draft {
  const def = METRIC_BY_KEY[metric];
  if (!def) return prev;
  const requiredSlot = def.params.some((p) => p.key === "slot" && p.required);
  const base: Draft = {
    ...prev,
    metric,
    titleTouched: false,
    title: "",
    nutrient: def.params.some((p) => p.key === "nutrient") ? prev.nutrient || "protein" : "",
    exerciseId: "",
    exerciseName: "",
    slot: requiredSlot ? "morning" : "any",
    weighIn: metric === "weigh_ins" ? "morning" : "any",
    reps: "5",
    minDistance: "",
    unitLabel: "",
    comparator: def.defaultComparator,
    period: def.defaultPeriod,
    periodDays: "7",
    agg: "",
    dailyThreshold: "",
    dailyComparator: "at_least",
    target: "",
    targetMax: "",
  };
  if (metric === "nutrient") return { ...base, ...nutrientDefaults(base.nutrient) };
  const unit = targetUnit(base);
  base.target = def.suggestion != null ? toInput(def.suggestion, unit, prefs) : "";
  if (base.comparator === "range" && metric === "weight_rate") {
    // "Lose 0.25–0.5 per week" in the user's own weight unit.
    base.target = "-0.5";
    base.targetMax = "-0.25";
  }
  return base;
}

function nutrientSuggestion(key: string): number | undefined {
  const s: Partial<Record<NutrientKey, number>> = { calories: 2000, protein: 140, carbs: 220, fat: 70, fiber: 30, sugar: 50, sodium: 2300, saturatedFat: 20, transFat: 2, cholesterol: 300 };
  return s[key as NutrientKey];
}

/** Comparison and target that suit a nutrient: protein "at least", sodium "at most", calories a range. */
export function nutrientDefaults(key: string): Pick<Draft, "nutrient" | "comparator" | "target" | "targetMax"> {
  const def = NUTRIENT_BY_KEY[key as NutrientKey];
  const s = nutrientSuggestion(key);
  if (!def) return { nutrient: key, comparator: "at_least", target: "", targetMax: "" };
  if (def.goalType === "target") {
    return { nutrient: key, comparator: "range", target: s ? String(Math.round(s * 0.9)) : "", targetMax: s ? String(Math.round(s * 1.1)) : "" };
  }
  return { nutrient: key, comparator: def.goalType === "max" ? "at_most" : "at_least", target: s != null ? String(s) : "", targetMax: "" };
}

export function draftFromGoal(g: GoalJ2, prefs: UnitPrefs): Draft {
  const p = g.params;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const slot = (v: unknown, fallback: Slot): Slot => (v === "morning" || v === "night" || v === "both" || v === "any" ? v : fallback);
  const vu = valueUnit(g);
  const agg = typeof p.agg === "string" ? (p.agg as Aggregation) : "";
  return {
    metric: g.metric,
    title: g.title,
    titleTouched: true,
    nutrient: str(p.nutrient),
    exerciseId: str(p.exerciseId),
    exerciseName: g.subject && str(p.exerciseId) ? g.subject : "",
    slot: slot(p.slot, "any"),
    weighIn: slot(p.weighIn, "any"),
    reps: typeof p.reps === "number" ? String(p.reps) : "5",
    minDistance: typeof p.minDistanceM === "number" ? toInput(p.minDistanceM, "m", prefs) : "",
    unitLabel: str(p.unitLabel),
    comparator: g.comparator,
    target: toInput(g.targetValue, vu, prefs),
    targetMax: toInput(g.targetMax, vu, prefs),
    period: g.period,
    periodDays: String(g.periodDays ?? 7),
    agg,
    dailyThreshold: typeof p.dailyThreshold === "number" ? toInput(p.dailyThreshold, g.unit, prefs) : "",
    dailyComparator: p.dailyComparator === "at_most" ? "at_most" : "at_least",
    startDate: g.startDate,
    endDate: g.endDate ?? "",
    notes: g.notes ?? "",
    showOnDashboard: g.showOnDashboard,
  };
}

export function validateDraft(d: Draft): FieldErrors {
  const e: FieldErrors = {};
  const def = METRIC_BY_KEY[d.metric];
  if (!def) return { metric: "Choose what to track" };
  for (const p of def.params) {
    if (!p.required) continue;
    if (p.key === "nutrient" && !d.nutrient) e["params.nutrient"] = "Choose a nutrient";
    if (p.key === "exerciseId" && !d.exerciseId) e["params.exerciseId"] = "Choose an exercise";
  }
  if (def.params.some((p) => p.key === "reps")) {
    const r = num(d.reps);
    if (r == null || Number.isNaN(r) || !Number.isInteger(r) || r < 1 || r > 100) e["params.reps"] = "Reps must be a whole number from 1 to 100";
  }
  if (def.params.some((p) => p.key === "minDistanceM") && d.minDistance.trim()) {
    const m = num(d.minDistance);
    if (m == null || Number.isNaN(m) || m < 0) e["params.minDistanceM"] = "Enter a distance, or leave blank";
  }
  if (!isFixedDaily(d)) {
    const t = num(d.target);
    if (t == null || Number.isNaN(t)) e.targetValue = "Enter a target";
    else if (t < 0 && metricUnit(d) !== "kg_per_week") e.targetValue = "Target can't be negative";
    if (d.comparator === "range") {
      const m = num(d.targetMax);
      if (m == null || Number.isNaN(m)) e.targetMax = "Enter the top of the range";
      else if (t != null && !Number.isNaN(t) && m === t) e.targetMax = "Use a different number for the top of the range";
    }
  }
  if (d.period === "custom") {
    const n = num(d.periodDays);
    if (n == null || Number.isNaN(n) || !Number.isInteger(n) || n < 2 || n > 365) e.periodDays = "A custom period lasts 2–365 days";
  }
  if (needsThreshold(d) && d.dailyThreshold.trim()) {
    const n = num(d.dailyThreshold);
    if (n == null || Number.isNaN(n) || n < 0) e["params.dailyThreshold"] = "Enter a daily amount, or leave blank";
  }
  if (!d.startDate) e.startDate = "Choose a start date";
  if (d.endDate && d.startDate && d.endDate < d.startDate) e.endDate = "End date must be on or after the start date";
  return e;
}

export function buildParams(d: Draft, prefs: UnitPrefs): Record<string, unknown> {
  const def = METRIC_BY_KEY[d.metric];
  const params: Record<string, unknown> = {};
  if (!def) return params;
  for (const p of def.params) {
    if (p.key === "nutrient" && d.nutrient) params.nutrient = d.nutrient;
    if (p.key === "exerciseId" && d.exerciseId) params.exerciseId = d.exerciseId;
    if (p.key === "slot") params.slot = d.slot;
    if (p.key === "weighIn") params.weighIn = d.weighIn;
    if (p.key === "reps") params.reps = Math.round(num(d.reps) ?? 1);
    if (p.key === "minDistanceM") {
      const m = num(d.minDistance);
      if (m != null && !Number.isNaN(m) && m > 0) params.minDistanceM = Math.round(fromDisplay(m, "m", prefs));
    }
    if (p.key === "unitLabel" && d.unitLabel.trim()) params.unitLabel = d.unitLabel.trim();
  }
  if (d.period !== "daily" && def.aggregations.length > 1 && d.agg) params.agg = d.agg;
  if (needsThreshold(d)) {
    const t = num(d.dailyThreshold);
    if (t != null && !Number.isNaN(t)) params.dailyThreshold = fromDisplay(t, metricUnit(d), prefs);
    params.dailyComparator = d.dailyComparator;
  }
  return params;
}

/**
 * Full payload. `keepTarget` reuses the stored canonical numbers when the
 * target inputs were not touched, so unit rounding never creates a new target version.
 */
export function toPayload(d: Draft, prefs: UnitPrefs, title: string, keepTarget?: { targetValue: number; targetMax: number | null }): GoalPayload {
  const unit = targetUnit(d);
  let targetValue: number;
  let targetMax: number | null = null;
  if (keepTarget) {
    targetValue = keepTarget.targetValue;
    targetMax = d.comparator === "range" ? keepTarget.targetMax : null;
  } else if (isFixedDaily(d)) {
    targetValue = 1;
  } else {
    const a = fromDisplay(num(d.target) ?? 0, unit, prefs);
    if (d.comparator === "range") {
      const b = fromDisplay(num(d.targetMax) ?? 0, unit, prefs);
      targetValue = Math.min(a, b);
      targetMax = Math.max(a, b);
    } else targetValue = a;
  }
  return {
    title: title.trim(),
    metric: d.metric,
    params: buildParams(d, prefs),
    comparator: d.comparator,
    targetValue,
    targetMax,
    period: d.period,
    periodDays: d.period === "custom" ? Math.round(num(d.periodDays) ?? 7) : null,
    startDate: d.startDate,
    endDate: d.endDate || null,
    showOnDashboard: d.showOnDashboard,
    notes: d.notes.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Title suggestions

function n2(s: string): string {
  const v = num(s);
  if (v == null || Number.isNaN(v)) return "?";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function withUnit(s: string, unit: CanonicalUnit, prefs: UnitPrefs, custom?: string): string {
  const v = n2(s);
  if (unit === "fraction") return `${v}%`;
  if (unit === "min") return `${v} h`;
  const label = inputUnitLabel(unit, prefs, custom);
  if (v === "1" && /^(days|workouts|sets|reps|records|pages|sessions|steps)$/.test(label)) return `1 ${label.slice(0, -1)}`;
  return label ? `${v} ${label}` : v;
}

function cmpText(d: Draft, unit: CanonicalUnit, prefs: UnitPrefs, symbols = true): string {
  if (d.comparator === "range") {
    const a = num(d.target) ?? 0;
    const b = num(d.targetMax) ?? 0;
    const [lo, hi] = a <= b ? [d.target, d.targetMax] : [d.targetMax, d.target];
    const right = withUnit(hi, unit, prefs, d.unitLabel);
    return `${n2(lo)}–${right}`;
  }
  const v = withUnit(d.target, unit, prefs, d.unitLabel);
  if (!symbols) return v;
  return d.comparator === "at_most" ? `≤ ${v}` : `≥ ${v}`;
}

function slotName(s: Slot): string {
  return s === "morning" ? "Morning routine" : s === "night" ? "Nightly routine" : "Morning + nightly routines";
}

/** A readable default title for the current choices. */
export function suggestTitle(d: Draft, prefs: UnitPrefs): string {
  const def = METRIC_BY_KEY[d.metric];
  if (!def) return "";
  const tu = targetUnit(d);
  const mu = metricUnit(d);
  const pw = periodWord(d.period, num(d.periodDays));
  const t = n2(d.target);
  const ex = d.exerciseName || null;
  const agg = effectiveAgg(d);
  const counted = needsThreshold(d);
  const daysPart = () => {
    const thr = d.dailyThreshold.trim() ? ` ${d.dailyComparator === "at_most" ? "≤" : "≥"} ${withUnit(d.dailyThreshold, mu, prefs, d.unitLabel)}` : "";
    const days = d.comparator === "range" ? `${n2(d.target)}–${n2(d.targetMax)}` : d.comparator === "at_most" ? `≤ ${t}` : `${t}+`;
    return `${thr} on ${days} days ${pw}`;
  };
  switch (d.metric) {
    case "nutrient": {
      const label = d.nutrient ? NUTRIENT_BY_KEY[d.nutrient as NutrientKey]?.label ?? "Nutrient" : "Nutrient";
      if (counted) return `${label}${daysPart()}`;
      return `${label} ${cmpText(d, tu, prefs)}${agg === "avg" && d.period !== "daily" ? " avg" : ""} ${pw}`;
    }
    case "water":
      if (counted) return `Water${daysPart()}`;
      return `Drink ${cmpText(d, tu, prefs, d.comparator !== "at_least")} ${pw}`;
    case "meals_logged":
      return `Log meals ${t} days ${pw}`;
    case "weight_target":
      return `Reach ${withUnit(d.target, tu, prefs)}`;
    case "weight_rate": {
      const unit = inputUnitLabel("kg", prefs);
      const a = num(d.target) ?? 0;
      const b = num(d.targetMax) ?? 0;
      if (d.comparator === "range") {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (hi <= 0) return `Lose ${n2(String(-hi))}–${n2(String(-lo))} ${unit} per week`;
        if (lo >= 0) return `Gain ${n2(String(lo))}–${n2(String(hi))} ${unit} per week`;
        return `Keep weight within ${n2(String(lo))} to ${n2(String(hi))} ${unit} per week`;
      }
      if (d.comparator === "at_most" && a < 0) return `Lose at least ${n2(String(-a))} ${unit} per week`;
      if (d.comparator === "at_least" && a > 0) return `Gain at least ${n2(String(a))} ${unit} per week`;
      return `Weight trend ${cmpText(d, tu, prefs)}`;
    }
    case "weigh_ins":
      if (d.period === "daily") return d.weighIn === "morning" ? "Weigh in every morning" : d.weighIn === "night" ? "Weigh in every night" : d.weighIn === "both" ? "Weigh in morning and night" : "Weigh in every day";
      return `Weigh in ${t}× ${pw}`;
    case "workouts":
      return `${cmpText(d, "workouts", prefs, d.comparator !== "at_least")} ${pw}`;
    case "exercise_e1rm":
      return `${ex ?? "Lift"} e1RM ${withUnit(d.target, tu, prefs)}`;
    case "exercise_weight_reps":
      return `${ex ?? "Lift"} ${withUnit(d.target, tu, prefs)} × ${n2(d.reps)}`;
    case "exercise_sets":
      return `${cmpText(d, "sets", prefs, d.comparator !== "at_least")}${ex ? ` of ${ex}` : ""} ${pw}`;
    case "exercise_reps":
      return `${cmpText(d, "reps", prefs, false)}${ex ? ` of ${ex}` : ""} ${pw}`;
    case "exercise_volume":
      return `${ex ?? "Training"} volume ${cmpText(d, tu, prefs)} ${pw}`;
    case "exercise_sessions":
      return `${ex ?? "Exercise"} ${t}× ${pw}`;
    case "prs":
      return `${t} ${ex ? `${ex} ` : ""}PR${t === "1" ? "" : "s"} ${pw}`;
    case "run_completed": {
      const m = num(d.minDistance);
      return m && !Number.isNaN(m) ? `Run every day (${n2(d.minDistance)} ${prefs.distanceUnit}+)` : "Run every day";
    }
    case "run_distance":
      return `Run ${cmpText(d, tu, prefs, d.comparator !== "at_least")} ${pw}`;
    case "run_days":
      return `Run ${t} days ${pw}`;
    case "run_consistency":
      return `Run on ${t}% of days ${pw}`;
    case "steps":
      if (counted) return d.dailyThreshold.trim() && d.dailyComparator === "at_least" ? `${n2(d.dailyThreshold)}+ steps on ${d.comparator === "at_most" ? `≤ ${t}` : `${t}+`} days ${pw}` : `Steps${daysPart()}`;
      if (d.period === "daily") return `${cmpText(d, "steps", prefs, false)} daily`;
      return agg === "avg" ? `Average ${cmpText(d, "steps", prefs, false)} a day ${pw}` : `${cmpText(d, "steps", prefs, false)} ${pw}`;
    case "sleep_duration":
      if (counted) return `Sleep${daysPart()}`;
      return d.period === "daily" ? `Sleep ${cmpText(d, tu, prefs, d.comparator !== "at_least")} nightly` : `Sleep ${cmpText(d, tu, prefs, d.comparator !== "at_least")} avg ${pw}`;
    case "sleep_score":
      if (counted) return `Sleep score${daysPart()}`;
      return `Sleep score ${cmpText(d, tu, prefs)} ${pw}`;
    case "resting_hr":
      return `Resting HR ${cmpText(d, tu, prefs)} ${pw}`;
    case "hrv":
      return `HRV ${cmpText(d, tu, prefs)} ${pw}`;
    case "active_energy":
      return `Active energy ${cmpText(d, tu, prefs)} ${pw}`;
    case "routine_completion": {
      const pct = num(d.target);
      return `${slotName(d.slot)} daily${pct != null && !Number.isNaN(pct) && pct < 100 ? ` (${n2(d.target)}%)` : ""}`;
    }
    case "routine_days":
      return `${slotName(d.slot)} complete ${t} days ${pw}`;
    case "reading":
      if (counted) return `Read${daysPart()}`;
      return `Read ${cmpText(d, tu, prefs, d.comparator !== "at_least")} ${pw}`;
    case "journal_days":
      return d.period === "daily" ? "Journal daily" : `Journal ${t}× ${pw}`;
    case "mobility_days":
      return d.period === "daily" ? "Stretch / mobility daily" : `Mobility ${t}× ${pw}`;
    case "custom":
      if (!d.unitLabel.trim()) return "";
      if (counted) return `${d.unitLabel.trim()}${daysPart()}`;
      return `${cmpText(d, tu, prefs, d.comparator !== "at_least")} ${pw}`;
  }
  return `${def.label} ${cmpText(d, tu, prefs)} ${pw}`;
}
