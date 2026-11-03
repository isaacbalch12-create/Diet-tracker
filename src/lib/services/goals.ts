/**
 * Goals: CRUD plus live evaluation against the underlying records.
 *
 * Two kinds of goals appear together:
 * - user goals (table user_goals), any number per category;
 * - linked goals derived from settings that other screens already own: the
 *   daily nutrition targets (versioned, so past days keep the targets they had)
 *   and the target body weight. They are edited where they live and shown here
 *   so every goal can be tracked in one place.
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db";
import { exercises, goalCheckins, userGoals, type GoalCategory, type GoalComparator, type GoalPeriod, type GoalStatus, type GoalTargetVersion, type Settings, type UserGoal } from "../db/schema";
import { badRequest, notFound } from "../errors";
import { type Aggregation, defaultAggregation, goalUnit, isNutrientKey, METRIC_BY_KEY, type CanonicalUnit } from "../goals/catalog";
import { evaluateGoal, progressRatio, type EvalContext, type GoalEvaluation, type GoalSpec } from "../goals/engine";
import { TARGET_TOLERANCE } from "../nutrition/goals";
import { NUTRIENT_BY_KEY, type NutrientKey } from "../nutrition/nutrients";
import { classifyDays, type RunDay } from "../running/stats";
import { addDays, diffDays, eachDate, type LocalDate } from "../time";
import { CELEBRATED_TYPES, computeRecordEvents } from "../training/records";
import { eligible1RM } from "../training/oneRm";
import { localDateSchema } from "../validation";
import { buildDailyMap, rollingAverage } from "../weight/stats";
import { metricByDate, listHealth } from "./health";
import { earliestMealDate } from "./meals";
import { loadRoutineData, routineDays } from "./routines";
import { listRuns, toRunLike } from "./running";
import { listGoals as listNutritionVersions } from "./settings";
import { nutritionDays } from "./stats";
import { ensureBuiltInExercises, loadTrainingData } from "./training";
import { dailyWater, listWater } from "./water";
import { listWeights } from "./weights";

const paramsSchema = z
  .object({
    nutrient: z.string().optional(),
    exerciseId: z.string().max(100).nullable().optional(),
    slot: z.enum(["morning", "night", "both", "any"]).optional(),
    weighIn: z.enum(["morning", "night", "both", "any"]).optional(),
    reps: z.number().int().min(1).max(100).optional(),
    minDistanceM: z.number().min(0).max(200_000).nullable().optional(),
    unitLabel: z.string().max(30).optional(),
    agg: z.enum(["sum", "avg", "count", "level", "pct", "rate"]).optional(),
    dailyThreshold: z.number().min(0).max(1_000_000).nullable().optional(),
    dailyComparator: z.enum(["at_least", "at_most"]).optional(),
  })
  .strict();

const goalBase = z.object({
  title: z.string().trim().min(1).max(120),
  metric: z.string().refine((m) => !!METRIC_BY_KEY[m], "Unknown metric"),
  params: paramsSchema.default({}),
  comparator: z.enum(["at_least", "at_most", "range"]),
  targetValue: z.number().finite().min(-1000).max(10_000_000),
  targetMax: z.number().finite().min(-1000).max(10_000_000).nullable().default(null),
  period: z.enum(["daily", "weekly", "monthly", "custom"]),
  periodDays: z.number().int().min(2).max(365).nullable().default(null),
  startDate: localDateSchema.optional(),
  endDate: localDateSchema.nullable().default(null),
  showOnDashboard: z.boolean().default(true),
  notes: z.string().max(1000).nullable().default(null),
});

function checkGoal(g: z.infer<typeof goalBase>, ctx: z.RefinementCtx) {
  const def = METRIC_BY_KEY[g.metric];
  if (!def) return;
  if (!def.periods.includes(g.period)) ctx.addIssue({ code: "custom", path: ["period"], message: `${def.label} goals can be ${def.periods.join(", ")}` });
  if (!def.comparators.includes(g.comparator)) ctx.addIssue({ code: "custom", path: ["comparator"], message: `Not a valid comparison for ${def.label}` });
  if (g.comparator === "range" && g.targetMax == null) ctx.addIssue({ code: "custom", path: ["targetMax"], message: "A range needs a maximum" });
  if (g.period === "custom" && !g.periodDays) ctx.addIssue({ code: "custom", path: ["periodDays"], message: "Choose how many days a custom period lasts" });
  for (const p of def.params) {
    const v = (g.params as Record<string, unknown>)[p.key];
    if (p.required && (v === undefined || v === null || v === "")) ctx.addIssue({ code: "custom", path: ["params", p.key], message: `${p.label} is required` });
  }
  if (g.metric === "nutrient" && !isNutrientKey(g.params.nutrient)) ctx.addIssue({ code: "custom", path: ["params", "nutrient"], message: "Choose a nutrient" });
  if (g.params.agg && !def.aggregations.includes(g.params.agg)) ctx.addIssue({ code: "custom", path: ["params", "agg"], message: "Not a valid way to combine days for this metric" });
  if (g.endDate && g.startDate && g.endDate < g.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after the start date" });
}

export const goalInputSchema = goalBase.superRefine(checkGoal);
export const goalPatchSchema = goalBase
  .partial()
  .extend({ status: z.enum(["active", "paused", "completed", "archived"]).optional(), position: z.number().int().min(0).max(10_000).optional() });

export const checkinSchema = z.object({ localDate: localDateSchema, value: z.number().min(0).max(1_000_000).nullable(), note: z.string().max(500).nullable().default(null) });

// ---------------------------------------------------------------------------
// Views

export interface GoalView {
  id: string;
  linked: null | "nutrition" | "target_weight";
  title: string;
  category: GoalCategory;
  metric: string;
  params: Record<string, unknown>;
  comparator: GoalComparator;
  targetValue: number;
  targetMax: number | null;
  /** For ±10% nutrition targets: the target itself. */
  center: number | null;
  unit: CanonicalUnit;
  unitLabel: string | null;
  aggregation: Aggregation;
  period: GoalPeriod;
  periodDays: number | null;
  startDate: LocalDate;
  endDate: LocalDate | null;
  status: GoalStatus;
  showOnDashboard: boolean;
  position: number;
  notes: string | null;
  subject: string | null;
  current: GoalEvaluation["current"];
  progress: number | null;
  streak: GoalEvaluation["streak"];
  successRate: number | null;
  judged: number;
  met: number;
  recent: GoalEvaluation["periods"];
  targetHistory: GoalTargetVersion[];
}

function specOf(g: Pick<UserGoal, "metric" | "comparator" | "targetValue" | "targetMax" | "period" | "periodDays" | "startDate" | "endDate" | "pauses" | "targetHistory" | "params">): GoalSpec {
  const p = g.params as Record<string, unknown>;
  const def = METRIC_BY_KEY[g.metric];
  const agg = (g.period === "daily" && def?.aggregations.includes("level") ? "level" : (p.agg as Aggregation | undefined)) ?? defaultAggregation(g.metric);
  return {
    metric: g.metric,
    comparator: g.comparator,
    targetValue: g.targetValue,
    targetMax: g.targetMax,
    period: g.period,
    periodDays: g.periodDays,
    startDate: g.startDate,
    endDate: g.endDate,
    pauses: g.pauses,
    targetHistory: g.targetHistory.length ? g.targetHistory : [{ from: g.startDate, value: g.targetValue, max: g.targetMax }],
    aggregation: agg,
    dailyThreshold: typeof p.dailyThreshold === "number" ? p.dailyThreshold : null,
    dailyComparator: p.dailyComparator === "at_most" ? "at_most" : "at_least",
  };
}

// ---------------------------------------------------------------------------
// Data context: everything goals need, loaded once per request.

interface GoalData {
  today: LocalDate;
  range: { start: LocalDate; end: LocalDate };
  settings: Settings;
  nutrition?: Map<LocalDate, Partial<Record<NutrientKey, number | null>>>;
  water?: Map<LocalDate, number>;
  weights?: { map: ReturnType<typeof buildDailyMap>; rolling: Map<LocalDate, number | null> };
  training?: Awaited<ReturnType<typeof loadTrainingData>> & { recordsByDay: Map<string, number> };
  runs?: Awaited<ReturnType<typeof listRuns>>;
  health?: Awaited<ReturnType<typeof listHealth>>;
  routines?: ReturnType<typeof routineDays>;
  checkins?: Map<string, Map<LocalDate, number>>;
}

const NEEDS: Record<string, (keyof GoalData)[]> = {
  nutrient: ["nutrition"],
  meals_logged: ["nutrition"],
  water: ["water"],
  weight_target: ["weights"],
  weight_rate: ["weights"],
  weigh_ins: ["weights"],
  workouts: ["training"],
  exercise_e1rm: ["training"],
  exercise_weight_reps: ["training"],
  exercise_sets: ["training"],
  exercise_reps: ["training"],
  exercise_volume: ["training"],
  exercise_sessions: ["training"],
  prs: ["training"],
  run_completed: ["runs"],
  run_distance: ["runs"],
  run_days: ["runs"],
  run_consistency: ["runs"],
  steps: ["health"],
  sleep_duration: ["health"],
  sleep_score: ["health"],
  resting_hr: ["health"],
  hrv: ["health"],
  active_energy: ["health"],
  routine_completion: ["routines"],
  routine_days: ["routines"],
  reading: ["routines"],
  journal_days: ["routines"],
  mobility_days: ["routines"],
  custom: ["checkins"],
};

const HISTORY_DAYS = 366;

async function loadGoalData(db: DbOrTx, metrics: string[], earliestStart: LocalDate, s: Settings, today: LocalDate): Promise<GoalData> {
  const start = addDays(earliestStart > addDays(today, -HISTORY_DAYS) ? earliestStart : addDays(today, -HISTORY_DAYS), -28);
  const range = { start, end: today };
  const needs = new Set(metrics.flatMap((m) => NEEDS[m] ?? []));
  const data: GoalData = { today, range, settings: s };
  const jobs: Promise<void>[] = [];
  if (needs.has("nutrition"))
    jobs.push(
      nutritionDays(db, range).then((days) => {
        data.nutrition = new Map(days.map((d) => [d.date, d.totals.values]));
      }),
    );
  if (needs.has("water")) jobs.push(listWater(db, range).then((rows) => void (data.water = dailyWater(rows))));
  if (needs.has("weights"))
    jobs.push(
      listWeights(db, range).then((rows) => {
        const map = buildDailyMap(rows.map((w) => ({ localDate: w.localDate, period: w.period, weightKg: w.weightKg })));
        const dates = eachDate(range.start, range.end);
        const rolling = rollingAverage(map, dates);
        data.weights = { map, rolling: new Map(dates.map((d, i) => [d, rolling[i].value])) };
      }),
    );
  if (needs.has("training"))
    jobs.push(
      loadTrainingData(db, s).then((t) => {
        const recordsByDay = new Map<string, number>();
        const wDate = new Map(t.workouts.map((w) => [w.id, w.localDate]));
        for (const e of computeRecordEvents(t.facts, t.calc, s.weightUnit)) {
          if (!CELEBRATED_TYPES.includes(e.type)) continue;
          const d = wDate.get(e.workoutId);
          if (!d) continue;
          for (const key of [`${d}|*`, `${d}|${e.exerciseId ?? "-"}`]) recordsByDay.set(key, (recordsByDay.get(key) ?? 0) + 1);
        }
        data.training = { ...t, recordsByDay };
      }),
    );
  if (needs.has("runs")) jobs.push(listRuns(db, { end: today }).then((r) => void (data.runs = r)));
  if (needs.has("health")) jobs.push(listHealth(db, range).then((r) => void (data.health = r)));
  if (needs.has("routines")) jobs.push(loadRoutineData(db, range).then((r) => void (data.routines = routineDays(r, range))));
  if (needs.has("checkins"))
    jobs.push(
      db
        .select()
        .from(goalCheckins)
        .where(and(gte(goalCheckins.localDate, range.start), lte(goalCheckins.localDate, range.end)))
        .then((rows) => {
          const m = new Map<string, Map<LocalDate, number>>();
          for (const r of rows) {
            const inner = m.get(r.goalId) ?? new Map();
            inner.set(r.localDate, r.value);
            m.set(r.goalId, inner);
          }
          data.checkins = m;
        }),
    );
  await Promise.all(jobs);
  return data;
}

function regressionPerWeek(points: { x: number; y: number }[]): number | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  return sxx === 0 ? null : (sxy / sxx) * 7;
}

/** Build the daily-value functions for one goal from the loaded data. */
function contextFor(goalId: string, spec: GoalSpec, params: Record<string, unknown>, d: GoalData): EvalContext {
  const base: EvalContext = { today: d.today, weekStartsOn: d.settings.weekStartsOn, daily: () => null };
  const slot = (params.slot as string | undefined) ?? "any";
  const slots = slot === "morning" ? (["morning"] as const) : slot === "night" ? (["night"] as const) : (["morning", "night"] as const);
  const exId = typeof params.exerciseId === "string" && params.exerciseId ? params.exerciseId : null;
  switch (spec.metric) {
    case "nutrient": {
      const key = params.nutrient as NutrientKey;
      return { ...base, daily: (date) => d.nutrition?.get(date)?.[key] ?? null };
    }
    case "meals_logged":
      return { ...base, daily: (date) => (d.nutrition?.has(date) ? 1 : 0) };
    case "water":
      return { ...base, daily: (date) => d.water?.get(date) ?? 0 };
    case "weight_target":
      return { ...base, daily: (date) => d.weights?.rolling.get(date) ?? null };
    case "weigh_ins": {
      const which = (params.weighIn as string) ?? "any";
      return {
        ...base,
        daily: (date) => {
          const w = d.weights?.map.get(date);
          if (!w) return 0;
          const ok = which === "morning" ? w.morning != null : which === "night" ? w.night != null : which === "both" ? w.morning != null && w.night != null : w.morning != null || w.night != null;
          return ok ? 1 : 0;
        },
      };
    }
    case "weight_rate":
      return {
        ...base,
        rate: (end) => {
          const pts: { x: number; y: number }[] = [];
          for (const date of eachDate(addDays(end, -20), end)) {
            const v = d.weights?.map.get(date)?.average;
            if (v != null) pts.push({ x: diffDays(addDays(end, -20), date), y: v });
          }
          if (pts.length < 6 || pts[pts.length - 1].x - pts[0].x < 10) return null;
          return regressionPerWeek(pts);
        },
      };
    case "workouts":
    case "exercise_sets":
    case "exercise_reps":
    case "exercise_volume":
    case "exercise_sessions": {
      const t = d.training;
      const byDay = new Map<string, { workouts: Set<string>; sets: number; reps: number; volume: number }>();
      for (const f of t?.facts ?? []) {
        if (exId && f.exerciseId !== exId) continue;
        const v = byDay.get(f.date) ?? { workouts: new Set<string>(), sets: 0, reps: 0, volume: 0 };
        v.workouts.add(f.workoutId);
        v.sets += 1;
        v.reps += f.reps;
        v.volume += f.weightKg * f.reps;
        byDay.set(f.date, v);
      }
      const pick = (v: { workouts: Set<string>; sets: number; reps: number; volume: number }) =>
        spec.metric === "exercise_sets" ? v.sets : spec.metric === "exercise_reps" ? v.reps : spec.metric === "exercise_volume" ? v.volume : v.workouts.size;
      return { ...base, daily: (date) => (byDay.has(date) ? pick(byDay.get(date)!) : 0) };
    }
    case "exercise_e1rm":
    case "exercise_weight_reps": {
      const t = d.training;
      const reps = typeof params.reps === "number" ? params.reps : 1;
      const bestByDate = new Map<LocalDate, number>();
      for (const f of t?.facts ?? []) {
        if (f.exerciseId !== exId) continue;
        const v = spec.metric === "exercise_e1rm" ? eligible1RM(f.weightKg, f.reps, t!.calc.formula, t!.calc.maxRepsFor1RM) : f.reps >= reps ? f.weightKg : null;
        if (v != null) bestByDate.set(f.date, Math.max(bestByDate.get(f.date) ?? 0, v));
      }
      const sorted = [...bestByDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      return {
        ...base,
        // Best ever up to that day.
        daily: (date) => {
          let best: number | null = null;
          for (const [dd, v] of sorted) {
            if (dd > date) break;
            best = best == null ? v : Math.max(best, v);
          }
          return best;
        },
      };
    }
    case "prs":
      return { ...base, daily: (date) => d.training?.recordsByDay.get(`${date}|${exId ?? "*"}`) ?? 0 };
    case "run_completed":
    case "run_distance":
    case "run_days":
    case "run_consistency": {
      const minM = spec.metric === "run_completed" && typeof params.minDistanceM === "number" && params.minDistanceM > 0 ? params.minDistanceM : null;
      const entries = (d.runs ?? []).map(toRunLike);
      const days = classifyDays(entries, d.range.start, d.today, d.today, minM);
      const byDate = new Map<LocalDate, RunDay>(days.map((x) => [x.date, x]));
      const off = (date: LocalDate) => {
        const s = byDate.get(date)?.status;
        return s === "rest" || s === "recovery";
      };
      if (spec.metric === "run_consistency")
        return {
          ...base,
          pct: (start, end) => {
            let done = 0;
            let eligible = 0;
            for (const date of eachDate(start, end)) {
              const st = byDate.get(date)?.status;
              if (!st || st === "rest" || st === "recovery" || st === "pending") continue;
              eligible += 1;
              if (st === "done") done += 1;
            }
            return { value: eligible ? done / eligible : null, eligible };
          },
        };
      const daily = (date: LocalDate) => {
        const x = byDate.get(date);
        if (!x) return 0;
        if (spec.metric === "run_distance") return x.distanceM;
        if (spec.metric === "run_days") return x.status === "done" || x.status === "short" ? 1 : 0;
        return x.status === "done" ? 1 : 0;
      };
      return { ...base, daily, excused: spec.metric === "run_days" ? undefined : off };
    }
    case "steps":
    case "sleep_duration":
    case "sleep_score":
    case "resting_hr":
    case "hrv":
    case "active_energy": {
      const hm = spec.metric === "sleep_duration" ? "sleep" : spec.metric;
      const map = metricByDate(d.health ?? [], hm as never);
      return { ...base, daily: (date) => map.get(date) ?? null };
    }
    case "routine_completion":
    case "routine_days":
    case "reading":
    case "journal_days":
    case "mobility_days": {
      const byDate = new Map((d.routines ?? []).map((r) => [r.date, r]));
      return {
        ...base,
        daily: (date) => {
          const r = byDate.get(date);
          if (!r) return null;
          if (spec.metric === "reading") return r.readingValue;
          if (spec.metric === "journal_days") return slots.some((sl) => r.journaled[sl]) ? 1 : 0;
          if (spec.metric === "mobility_days") return slots.some((sl) => r.mobility[sl]) ? 1 : 0;
          const parts = slots.map((sl) => r[sl]).filter((p) => p.required > 0);
          if (!parts.length) return null;
          if (spec.metric === "routine_days") return parts.every((p) => p.complete) ? 1 : 0;
          return parts.reduce((a, p) => a + (p.pct ?? 0), 0) / parts.length;
        },
      };
    }
    case "custom": {
      const m = d.checkins?.get(goalId);
      return { ...base, daily: (date) => m?.get(date) ?? (spec.aggregation === "count" || spec.aggregation === "sum" ? 0 : null) };
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Linked goals

async function linkedGoals(db: DbOrTx, s: Settings, today: LocalDate): Promise<(Omit<UserGoal, "createdAt" | "updatedAt"> & { linked: "nutrition" | "target_weight"; center: number | null })[]> {
  const versions = await listNutritionVersions(db);
  const out: (Omit<UserGoal, "createdAt" | "updatedAt"> & { linked: "nutrition" | "target_weight"; center: number | null })[] = [];
  const current = versions.filter((v) => v.effectiveFrom <= today).at(-1) ?? versions[0];
  const hidden = new Set(s.dashboard?.hiddenGoalIds ?? []);
  if (current) {
    const firstMeal = await earliestMealDate(db);
    const keys = new Set<NutrientKey>(["calories", "protein", "carbs", "fat"].filter((k) => current[k as "calories"] != null) as NutrientKey[]);
    for (const [k, v] of Object.entries(current.extra ?? {})) if (typeof v === "number" && v > 0) keys.add(k as NutrientKey);
    for (const key of keys) {
      const def = NUTRIENT_BY_KEY[key];
      const valueOf = (v: (typeof versions)[number]) => (key in { calories: 1, protein: 1, carbs: 1, fat: 1 } ? (v[key as "calories"] as number | null) : (v.extra?.[key] ?? null));
      const comparator: GoalComparator = def.goalType === "min" ? "at_least" : def.goalType === "max" ? "at_most" : "range";
      const toVersion = (t: number) => (comparator === "range" ? { value: t * (1 - TARGET_TOLERANCE), max: t * (1 + TARGET_TOLERANCE) } : { value: t, max: null });
      const history = versions.filter((v) => valueOf(v) != null).map((v) => ({ from: v.effectiveFrom, ...toVersion(valueOf(v)!) }));
      const target = valueOf(current)!;
      const startDate = [firstMeal ?? today, current.effectiveFrom === "2000-01-01" ? today : versions.find((v) => valueOf(v) != null)!.effectiveFrom].sort()[0];
      const tv = toVersion(target);
      out.push({
        id: `nutrition:${key}`,
        linked: "nutrition",
        center: comparator === "range" ? target : null,
        title: def.goalType === "min" ? `${def.label}: at least ${Math.round(target)} ${def.unit}` : def.goalType === "max" ? `${def.label}: at most ${Math.round(target)} ${def.unit}` : `${def.label}: ${Math.round(target)} ${def.unit} (±${TARGET_TOLERANCE * 100}%)`,
        category: "nutrition",
        metric: "nutrient",
        params: { nutrient: key, agg: "avg" },
        comparator,
        targetValue: tv.value,
        targetMax: tv.max,
        unit: def.unit,
        period: "daily",
        periodDays: null,
        startDate: startDate < "2000-01-02" ? today : startDate,
        endDate: null,
        status: "active",
        pauses: [],
        targetHistory: history,
        showOnDashboard: !hidden.has(`nutrition:${key}`),
        position: -10 + ["calories", "protein", "carbs", "fat"].indexOf(key),
        notes: "Daily nutrition target. Edit it under Goals → Nutrition targets; past days keep the targets they had.",
      });
    }
  }
  if (s.targetWeightKg) {
    const loss = (s.startingWeightKg ?? s.targetWeightKg + 1) > s.targetWeightKg;
    out.push({
      id: "body:target_weight",
      linked: "target_weight",
      center: null,
      title: "Reach target weight",
      category: "body",
      metric: "weight_target",
      params: {},
      comparator: loss ? "at_most" : "at_least",
      targetValue: s.targetWeightKg,
      targetMax: null,
      unit: "kg",
      period: "daily",
      periodDays: null,
      startDate: s.startingWeightDate ?? addDays(today, -30),
      endDate: null,
      status: "active",
      pauses: [],
      targetHistory: [],
      showOnDashboard: !hidden.has("body:target_weight"),
      position: -5,
      notes: "Uses your 7-day average weight. Edit the target under Weight goals.",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API

export async function listUserGoals(db: DbOrTx): Promise<UserGoal[]> {
  return db.select().from(userGoals).orderBy(asc(userGoals.position), asc(userGoals.createdAt));
}

async function exerciseNames(db: DbOrTx): Promise<Map<string, string>> {
  return new Map((await db.select({ id: exercises.id, name: exercises.name }).from(exercises)).map((e) => [e.id, e.name]));
}

/**
 * All goals with live progress. `includeLinked` adds the nutrition targets and
 * target weight. `historyDays` limits how far back periods are evaluated.
 */
export async function goalsWithProgress(db: DbOrTx, s: Settings, today: LocalDate, opts: { includeLinked?: boolean; recent?: number; onlyId?: string; full?: boolean } = {}): Promise<GoalView[]> {
  const rows = (await listUserGoals(db)).map((g) => ({ ...g, linked: null as GoalView["linked"], center: null as number | null }));
  const linked = opts.includeLinked === false ? [] : await linkedGoals(db, s, today);
  let all = [...linked, ...rows];
  if (opts.onlyId) all = all.filter((g) => g.id === opts.onlyId);
  if (!all.length) return [];
  const evalRows = all.filter((g) => g.status === "active" || g.status === "paused" || opts.onlyId);
  const earliest = evalRows.reduce((m, g) => (g.startDate < m ? g.startDate : m), today);
  const data = await loadGoalData(db, [...new Set(evalRows.map((g) => g.metric))], earliest, s, today);
  const names = all.some((g) => typeof g.params.exerciseId === "string") ? await exerciseNames(db) : new Map<string, string>();
  return all.map((g) => {
    const spec = specOf(g);
    const shouldEval = evalRows.includes(g);
    const ev = shouldEval ? evaluateGoal(spec, contextFor(g.id, spec, g.params, data), HISTORY_DAYS) : null;
    const cur = ev?.current ?? null;
    const subject =
      typeof g.params.exerciseId === "string"
        ? (names.get(g.params.exerciseId) ?? null)
        : typeof g.params.slot === "string" && g.params.slot !== "any"
          ? g.params.slot === "both"
            ? "Morning + night"
            : g.params.slot === "morning"
              ? "Morning routine"
              : "Nightly routine"
          : g.metric === "nutrient" && isNutrientKey(g.params.nutrient)
            ? NUTRIENT_BY_KEY[g.params.nutrient].label
            : null;
    return {
      id: g.id,
      linked: g.linked,
      title: g.title,
      category: g.category,
      metric: g.metric,
      params: g.params,
      comparator: g.comparator,
      targetValue: g.targetValue,
      targetMax: g.targetMax,
      center: g.center,
      unit: goalUnit(g.metric, g.params),
      unitLabel: typeof g.params.unitLabel === "string" ? g.params.unitLabel : null,
      aggregation: spec.aggregation,
      period: g.period,
      periodDays: g.periodDays,
      startDate: g.startDate,
      endDate: g.endDate,
      status: g.status,
      showOnDashboard: g.showOnDashboard,
      position: g.position,
      notes: g.notes,
      subject,
      current: cur,
      progress: cur ? progressRatio(cur.value, g.comparator, cur.target, cur.targetMax) : null,
      streak: ev?.streak ?? { current: 0, best: 0, unit: "days" },
      successRate: ev?.successRate ?? null,
      judged: ev?.judged ?? 0,
      met: ev?.met ?? 0,
      recent: ev ? (opts.full ? ev.periods : ev.periods.slice(-(opts.recent ?? 14))) : [],
      targetHistory: spec.targetHistory,
    };
  });
}

async function validateRefs(db: DbOrTx, metric: string, params: Record<string, unknown>) {
  if (typeof params.exerciseId === "string" && params.exerciseId) {
    await ensureBuiltInExercises(db);
    const [e] = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, params.exerciseId));
    if (!e) throw badRequest("That exercise doesn't exist.");
  }
  if (metric === "nutrient" && !isNutrientKey(params.nutrient)) throw badRequest("Choose a nutrient.");
}

export async function createGoal(db: DbOrTx, input: z.infer<typeof goalInputSchema>, today: LocalDate): Promise<UserGoal> {
  await validateRefs(db, input.metric, input.params);
  const startDate = input.startDate ?? today;
  const existing = await listUserGoals(db);
  const [row] = await db
    .insert(userGoals)
    .values({
      title: input.title,
      category: METRIC_BY_KEY[input.metric].category,
      metric: input.metric,
      params: input.params,
      comparator: input.comparator,
      targetValue: input.targetValue,
      targetMax: input.comparator === "range" ? input.targetMax : null,
      unit: goalUnit(input.metric, input.params),
      period: input.period,
      periodDays: input.period === "custom" ? input.periodDays : null,
      startDate,
      endDate: input.endDate,
      showOnDashboard: input.showOnDashboard,
      notes: input.notes,
      position: existing.length ? Math.max(...existing.map((g) => g.position)) + 1 : 0,
      targetHistory: [{ from: startDate, value: input.targetValue, max: input.comparator === "range" ? input.targetMax : null }],
    })
    .returning();
  return row;
}

/**
 * Update a goal. A new target applies from today; earlier periods keep the
 * target they had. Pausing records a span that is excused from history.
 */
export async function updateGoal(db: DbOrTx, id: string, input: z.infer<typeof goalPatchSchema>, today: LocalDate): Promise<UserGoal> {
  const [cur] = await db.select().from(userGoals).where(eq(userGoals.id, id));
  if (!cur) throw notFound("Goal");
  const merged = { ...cur, ...input, params: input.params ?? cur.params } as UserGoal;
  const parsed = goalInputSchema.safeParse({ ...merged, targetMax: merged.comparator === "range" ? merged.targetMax : null });
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid goal");
  await validateRefs(db, merged.metric, merged.params);
  const patch: Partial<typeof userGoals.$inferInsert> = {};
  for (const k of ["title", "comparator", "period", "periodDays", "startDate", "endDate", "showOnDashboard", "notes", "position"] as const) {
    if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
  }
  if (input.metric && input.metric !== cur.metric) {
    patch.metric = input.metric;
    patch.category = METRIC_BY_KEY[input.metric].category;
  }
  if (input.params) patch.params = input.params;
  patch.unit = goalUnit(merged.metric, merged.params);
  const newValue = input.targetValue ?? cur.targetValue;
  const newMax = merged.comparator === "range" ? (input.targetMax !== undefined ? input.targetMax : cur.targetMax) : null;
  if (newValue !== cur.targetValue || newMax !== cur.targetMax) {
    patch.targetValue = newValue;
    patch.targetMax = newMax;
    const history = (cur.targetHistory.length ? cur.targetHistory : [{ from: cur.startDate, value: cur.targetValue, max: cur.targetMax }]).filter((v) => v.from < today);
    const from = today < cur.startDate ? cur.startDate : today;
    patch.targetHistory = [...history, { from, value: newValue, max: newMax }];
  }
  if (input.status && input.status !== cur.status) {
    patch.status = input.status;
    const pauses = [...cur.pauses];
    if (input.status === "paused") pauses.push({ from: today, to: null });
    else if (cur.status === "paused") {
      const open = pauses.findIndex((p) => p.to == null);
      if (open >= 0) {
        const to = addDays(today, -1);
        if (to < pauses[open].from) pauses.splice(open, 1);
        else pauses[open] = { ...pauses[open], to };
      }
    }
    patch.pauses = pauses;
  }
  const [row] = await db.update(userGoals).set(patch).where(eq(userGoals.id, id)).returning();
  return row;
}

export async function deleteGoal(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(userGoals).where(eq(userGoals.id, id)).returning({ id: userGoals.id });
  if (!rows.length) throw notFound("Goal");
}

export async function saveCheckin(db: DbOrTx, goalId: string, input: z.infer<typeof checkinSchema>, today: LocalDate): Promise<void> {
  const [g] = await db.select().from(userGoals).where(eq(userGoals.id, goalId));
  if (!g) throw notFound("Goal");
  if (g.metric !== "custom") throw badRequest("Only custom goals take manual check-ins; other goals update from your logs automatically.");
  if (input.localDate > today) throw badRequest("Check-ins can't be for future days.");
  if (input.value == null) {
    await db.delete(goalCheckins).where(and(eq(goalCheckins.goalId, goalId), eq(goalCheckins.localDate, input.localDate)));
    return;
  }
  await db
    .insert(goalCheckins)
    .values({ goalId, localDate: input.localDate, value: input.value, note: input.note })
    .onConflictDoUpdate({ target: [goalCheckins.goalId, goalCheckins.localDate], set: { value: input.value, note: input.note } });
}

export async function reorderGoals(db: DbOrTx, ids: string[]): Promise<void> {
  for (const [i, id] of ids.entries()) {
    if (id.includes(":")) continue;
    await db.update(userGoals).set({ position: i }).where(eq(userGoals.id, id));
  }
}
