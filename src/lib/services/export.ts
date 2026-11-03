import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import {
  chatConversations,
  exercises,
  foods,
  goalCheckins,
  goals,
  healthConnections,
  healthDaily,
  journalEntries,
  mealAnalyses,
  mealImages,
  mealItems,
  meals,
  mobilityRoutines,
  routineActivities,
  routineLogs,
  routineTemplates,
  runEntries,
  savedMeals,
  settings,
  userGoals,
  waterLogs,
  weightEntries,
  workoutExercises,
  workoutSets,
  workoutTemplates,
  workouts,
} from "../db/schema";
import { estimate1RM } from "../training/oneRm";
import { fromMeters } from "../running/stats";
import { listHealth, metricByDate } from "./health";
import { loadRoutineData, routineDays } from "./routines";
import { listRuns } from "./running";
import { dailyWater, listWater } from "./water";
import { badRequest } from "../errors";
import { itemGrams, itemNutrients } from "../nutrition/calc";
import { NUTRIENTS } from "../nutrition/nutrients";
import { eachDate, type LocalDate } from "../time";
import { fromKg } from "../units";
import { buildDailyMap } from "../weight/stats";
import { listMeals } from "./meals";
import { listGoals, toGoalVersion } from "./settings";
import { nutritionDaysFromMeals } from "./stats";
import { listWeights } from "./weights";
import { goalForDate, goalTargets } from "../nutrition/goals";

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

const round = (v: number | null | undefined, d = 3) => (v == null ? null : Number(v.toFixed(d)));

export async function weightsCsv(db: Db): Promise<string> {
  const rows = await listWeights(db);
  return toCsv(
    ["date", "period", "measured_at", "timezone", "weight_kg", "weight_lb", "entered_value", "entered_unit", "note"],
    rows.map((w) => [w.localDate, w.period, w.measuredAt, w.timezone, round(w.weightKg, 4), round(fromKg(w.weightKg, "lb"), 3), w.inputValue, w.inputUnit, w.note]),
  );
}

export async function mealItemsCsv(db: Db, range: { start: LocalDate; end: LocalDate }): Promise<string> {
  const list = await listMeals(db, range);
  const header = [
    "date",
    "eaten_at",
    "meal_id",
    "meal_title",
    "category",
    "meal_source",
    "item_name",
    "quantity",
    "unit",
    "grams",
    ...NUTRIENTS.map((n) => `${n.key}_${n.unit === "µg" ? "ug" : n.unit}`),
    "nutrient_source",
    "quantity_source",
    "confidence",
    "database_ref",
    "original_description",
  ];
  const rows: unknown[][] = [];
  for (const m of list) {
    for (const i of m.items) {
      const n = itemNutrients(i);
      rows.push([
        m.localDate,
        m.eatenAt,
        m.id,
        m.title,
        m.category,
        m.source,
        i.name,
        i.quantity,
        i.unit,
        round(itemGrams(i), 2),
        ...NUTRIENTS.map((d) => round(n[d.key] ?? null, 3)),
        i.nutrientSource,
        i.quantitySource,
        i.confidence,
        i.sourceRef ? `${i.sourceRef.provider}:${i.sourceRef.fdcId ?? ""} ${i.sourceRef.description}` : null,
        m.description,
      ]);
    }
  }
  return toCsv(header, rows);
}

export async function dailyCsv(db: Db, range: { start: LocalDate; end: LocalDate }): Promise<string> {
  const [list, weights, goalRows, water, runs, health, routineData, ws, sets] = await Promise.all([
    listMeals(db, range),
    listWeights(db, range),
    listGoals(db),
    listWater(db, range),
    listRuns(db, range),
    listHealth(db, range),
    loadRoutineData(db, range),
    db.select().from(workouts),
    db.select().from(workoutSets),
  ]);
  const waterByDay = dailyWater(water);
  const steps = metricByDate(health, "steps");
  const sleep = metricByDate(health, "sleep");
  const routines = new Map(routineDays(routineData, range).map((r) => [r.date, r]));
  const wDate = new Map(ws.map((w) => [w.id, w.localDate]));
  const train = new Map<string, { workouts: Set<string>; sets: number; volume: number }>();
  for (const x of sets) {
    if (!x.completed || x.kind !== "working" || !x.reps || x.weightKg == null) continue;
    const d = wDate.get(x.workoutId);
    if (!d || d < range.start || d > range.end) continue;
    const t = train.get(d) ?? { workouts: new Set<string>(), sets: 0, volume: 0 };
    t.workouts.add(x.workoutId);
    t.sets += 1;
    t.volume += x.weightKg * x.reps;
    train.set(d, t);
  }
  const days = new Map(nutritionDaysFromMeals(list).map((d) => [d.date, d]));
  const wmap = buildDailyMap(weights.map((w) => ({ localDate: w.localDate, period: w.period, weightKg: w.weightKg })));
  const versions = goalRows.map(toGoalVersion);
  const header = ["date", "meals_logged", ...NUTRIENTS.map((n) => `${n.key}_${n.unit === "µg" ? "ug" : n.unit}`), "goal_calories", "goal_protein_g", "goal_carbs_g", "goal_fat_g", "morning_kg", "night_kg", "daily_avg_kg", "water_ml", "workouts", "working_sets", "volume_kg", "run_day", "run_distance_m", "steps", "sleep_min", "morning_routine_pct", "night_routine_pct", "journaled"];
  const rows = eachDate(range.start, range.end).map((date) => {
    const d = days.get(date);
    const w = wmap.get(date);
    const g = goalTargets(goalForDate(versions, date));
    return [
      date,
      d?.mealCount ?? 0,
      ...NUTRIENTS.map((n) => (d ? round(d.totals.values[n.key], 3) : null)),
      g.calories ?? null,
      g.protein ?? null,
      g.carbs ?? null,
      g.fat ?? null,
      round(w?.morning ?? null, 4),
      round(w?.night ?? null, 4),
      round(w?.average ?? null, 4),
      round(waterByDay.get(date) ?? null, 1),
      train.get(date)?.workouts.size ?? 0,
      train.get(date)?.sets ?? 0,
      round(train.get(date)?.volume ?? null, 2),
      runs.some((r) => r.localDate === date && r.kind === "run") ? "run" : (runs.find((r) => r.localDate === date)?.kind ?? null),
      round(runs.filter((r) => r.localDate === date && r.kind === "run").reduce((a, r) => a + (r.distanceM ?? 0), 0) || null, 1),
      steps.get(date) ?? null,
      round(sleep.get(date) ?? null, 1),
      routines.get(date)?.morning.pct != null ? round(routines.get(date)!.morning.pct! * 100, 1) : null,
      routines.get(date)?.night.pct != null ? round(routines.get(date)!.night.pct! * 100, 1) : null,
      routines.get(date) ? (routines.get(date)!.journaled.morning || routines.get(date)!.journaled.night ? "yes" : "no") : null,
    ];
  });
  return toCsv(header, rows);
}

/** One row per logged set (the LiftLog CSV format, without times). */
export async function setsCsv(db: Db, unit: "kg" | "lb", formula: "epley" | "brzycki"): Promise<string> {
  const [ws, wes, sets, exs] = await Promise.all([db.select().from(workouts), db.select().from(workoutExercises), db.select().from(workoutSets), db.select().from(exercises)]);
  const wById = new Map(ws.map((w) => [w.id, w]));
  const weById = new Map(wes.map((w) => [w.id, w]));
  const exById = new Map(exs.map((e) => [e.id, e]));
  const conv = (kg: number) => fromKg(kg, unit);
  const rows = sets
    .map((x) => ({ x, w: wById.get(x.workoutId), we: weById.get(x.workoutExerciseId) }))
    .filter((r) => r.w)
    .sort((a, b) => a.w!.localDate.localeCompare(b.w!.localDate) || (a.we?.position ?? 0) - (b.we?.position ?? 0) || a.x.position - b.x.position)
    .map(({ x, w, we }) => {
      const e1 = x.weightKg != null && x.reps != null ? estimate1RM(x.weightKg, x.reps, formula) : null;
      return [
        w!.localDate,
        w!.name,
        exById.get(x.exerciseId)?.name ?? x.exerciseId,
        (we?.position ?? 0) + 1,
        x.setNumber,
        x.kind,
        x.completed ? "yes" : "no",
        x.weightKg != null ? round(conv(x.weightKg), 2) : null,
        x.reps,
        x.rpe,
        x.weightKg != null && x.reps != null ? Math.round(conv(x.weightKg * x.reps)) : null,
        e1 != null ? round(conv(e1), 1) : null,
        x.notes,
        w!.notes,
      ];
    });
  return toCsv(["date", "workout", "exercise", "exercise_order", "set_number", "set_type", "completed", `weight_${unit}`, "reps", "rpe", `volume_${unit}`, `estimated_1rm_${unit}`, "set_notes", "workout_notes"], rows);
}

export async function runsCsv(db: Db, distanceUnit: "mi" | "km"): Promise<string> {
  const rows = await listRuns(db);
  return toCsv(
    ["date", "kind", `distance_${distanceUnit}`, "distance_m", "entered_value", "entered_unit", "run_type", "effort", "notes"],
    rows.map((r) => [r.localDate, r.kind, r.distanceM != null ? round(fromMeters(r.distanceM, distanceUnit), 3) : null, round(r.distanceM, 1), r.inputDistance, r.inputUnit, r.runType, r.effort, r.notes]),
  );
}

export async function healthCsv(db: Db): Promise<string> {
  const rows = await db.select().from(healthDaily);
  rows.sort((a, b) => a.localDate.localeCompare(b.localDate) || a.metric.localeCompare(b.metric));
  return toCsv(
    ["date", "metric", "value", "unit", "source", "origin", "synced_at", "details"],
    rows.map((r) => [r.localDate, r.metric, r.value, r.unit, r.sourceLabel, r.origin, r.syncedAt, r.details ? JSON.stringify(r.details) : null]),
  );
}

export const BACKUP_VERSION = 2;
/** Older backups (diet tracker only) can still be restored; they replace only the tables they contain. */
const SUPPORTED_VERSIONS = [1, 2];

export async function fullBackup(db: Db, opts: { includeImages: boolean }) {
  const [s, g, w, m, mi, sm, cf, an] = await Promise.all([
    db.select().from(settings),
    db.select().from(goals),
    db.select().from(weightEntries),
    db.select().from(meals),
    db.select().from(mealItems),
    db.select().from(savedMeals),
    db.select().from(foods).where(eq(foods.source, "custom")),
    db.select().from(mealAnalyses),
  ]);
  const imgs = await db.select().from(mealImages);
  const [ex, wo, wex, wse, wt, ru, wa, hc, hd, ra, mr, rl, rt, je, ug, gc] = await Promise.all([
    db.select().from(exercises),
    db.select().from(workouts),
    db.select().from(workoutExercises),
    db.select().from(workoutSets),
    db.select().from(workoutTemplates),
    db.select().from(runEntries),
    db.select().from(waterLogs),
    db.select().from(healthConnections),
    db.select().from(healthDaily),
    db.select().from(routineActivities),
    db.select().from(mobilityRoutines),
    db.select().from(routineLogs),
    db.select().from(routineTemplates),
    db.select().from(journalEntries),
    db.select().from(userGoals),
    db.select().from(goalCheckins),
  ]);
  return {
    app: "diet-tracker",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: s,
    goals: g,
    weightEntries: w,
    meals: m,
    mealItems: mi,
    savedMeals: sm,
    customFoods: cf.map(({ searchVector: _sv, ...rest }) => {
      void _sv;
      return rest;
    }),
    mealAnalyses: an,
    images: imgs.map(({ data, ...meta }) => ({ ...meta, data: opts.includeImages && data ? data.toString("base64") : null })),
    exercises: ex,
    workouts: wo,
    workoutExercises: wex,
    workoutSets: wse,
    workoutTemplates: wt,
    runEntries: ru,
    waterLogs: wa,
    healthConnections: hc,
    healthDaily: hd,
    routineActivities: ra,
    mobilityRoutines: mr,
    routineLogs: rl,
    routineTemplates: rt,
    journalEntries: je,
    userGoals: ug,
    goalCheckins: gc,
  };
}

type Backup = Awaited<ReturnType<typeof fullBackup>>;

const reviveDates = <T extends Record<string, unknown>>(row: T, keys: string[]): T => {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) if (typeof out[k] === "string") out[k] = new Date(out[k] as string);
  return out as T;
};

/**
 * Replace all personal data with the contents of a backup (one transaction —
 * either everything is restored or nothing changes). Reference USDA foods are kept.
 */
export async function restoreBackup(db: Db, raw: unknown): Promise<{ meals: number; weights: number; workouts: number; runs: number }> {
  const b = raw as Backup;
  if (!b || b.app !== "diet-tracker" || !SUPPORTED_VERSIONS.includes(b.version)) throw badRequest("This file is not a backup from this app (or is from an unsupported version).");
  const ts = ["createdAt", "updatedAt"];
  const v2 = b.version >= 2;
  await db.transaction(async (tx) => {
    if (v2) {
      // Children first; every unified table is replaced by the backup's contents.
      for (const t of [goalCheckins, userGoals, journalEntries, routineLogs, routineTemplates, routineActivities, mobilityRoutines, healthDaily, healthConnections, waterLogs, runEntries, workoutSets, workoutExercises, workouts, workoutTemplates, exercises]) await tx.delete(t);
    }
    await tx.delete(chatConversations);
    await tx.delete(mealImages);
    await tx.delete(mealItems);
    await tx.delete(meals);
    await tx.delete(mealAnalyses);
    await tx.delete(weightEntries);
    await tx.delete(goals);
    await tx.delete(savedMeals);
    await tx.delete(foods).where(eq(foods.source, "custom"));
    await tx.delete(settings);
    if (b.settings?.length) await tx.insert(settings).values(b.settings.map((r) => reviveDates(r, ts)));
    if (b.goals?.length) await tx.insert(goals).values(b.goals.map((r) => reviveDates(r, ts)));
    if (b.weightEntries?.length) await tx.insert(weightEntries).values(b.weightEntries.map((r) => reviveDates(r, [...ts, "measuredAt"])));
    if (b.customFoods?.length) await tx.insert(foods).values(b.customFoods.map((r) => reviveDates(r, ts)));
    if (b.meals?.length) await tx.insert(meals).values(b.meals.map((r) => reviveDates(r, [...ts, "eatenAt"])));
    if (b.mealItems?.length) {
      // Food references may point at reference foods that don't exist in this database
      // (e.g. restoring onto a fresh install); the item keeps its USDA id in source_ref.
      const refIds = [...new Set(b.mealItems.map((r) => r.foodId).filter((x): x is string => !!x))];
      const present = new Set<string>();
      for (let i = 0; i < refIds.length; i += 500) {
        const found = await tx.select({ id: foods.id }).from(foods).where(inArray(foods.id, refIds.slice(i, i + 500)));
        found.forEach((f) => present.add(f.id));
      }
      const rows = b.mealItems.map((r) => reviveDates({ ...r, foodId: r.foodId && present.has(r.foodId) ? r.foodId : null }, ts));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(mealItems).values(rows.slice(i, i + 500));
    }
    if (b.savedMeals?.length) await tx.insert(savedMeals).values(b.savedMeals.map((r) => reviveDates(r, [...ts, "lastUsedAt"])));
    if (b.mealAnalyses?.length) await tx.insert(mealAnalyses).values(b.mealAnalyses.map((r) => reviveDates(r, ts)));
    const imgs = (b.images ?? []).filter((i) => i.storage === "s3" || i.data);
    if (imgs.length) {
      await tx.insert(mealImages).values(imgs.map((i) => ({ ...reviveDates(i, ["createdAt"]), data: i.data ? Buffer.from(i.data, "base64") : null })));
    }
    if (v2) {
      const put = async <R extends Record<string, unknown>>(table: Parameters<typeof tx.insert>[0], rows: R[] | undefined, dateKeys: string[] = []) => {
        if (!rows?.length) return;
        const revived = rows.map((r) => reviveDates(r, [...ts, ...dateKeys]));
        for (let i = 0; i < revived.length; i += 500) await tx.insert(table).values(revived.slice(i, i + 500) as never);
      };
      await put(exercises, b.exercises);
      await put(workoutTemplates, b.workoutTemplates, ["lastUsedAt"]);
      await put(workouts, b.workouts);
      await put(workoutExercises, b.workoutExercises);
      await put(workoutSets, b.workoutSets);
      await put(runEntries, b.runEntries, ["loggedAt"]);
      await put(waterLogs, b.waterLogs, ["loggedAt"]);
      await put(healthConnections, b.healthConnections, ["lastUsedAt", "revokedAt"]);
      await put(healthDaily, b.healthDaily, ["syncedAt"]);
      await put(mobilityRoutines, b.mobilityRoutines);
      await put(routineActivities, b.routineActivities);
      await put(routineLogs, b.routineLogs, ["completedAt"]);
      await put(routineTemplates, b.routineTemplates);
      await put(journalEntries, b.journalEntries);
      await put(userGoals, b.userGoals);
      await put(goalCheckins, b.goalCheckins);
    }
  });
  return { meals: b.meals?.length ?? 0, weights: b.weightEntries?.length ?? 0, workouts: b.workouts?.length ?? 0, runs: b.runEntries?.filter((r) => r.kind === "run").length ?? 0 };
}
