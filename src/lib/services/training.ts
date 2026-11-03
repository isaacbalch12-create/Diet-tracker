/**
 * Strength training: exercises, workouts, templates and every statistic derived
 * from logged sets. Statistics are always recomputed from the sets, so editing
 * or deleting history immediately corrects records, trends and goals.
 *
 * There is intentionally no time tracking here: no durations, timers or rest
 * periods. Progress is judged by sets, reps and weight.
 */
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "../db";
import {
  exercises,
  workoutExercises,
  workoutSets,
  workoutTemplates,
  workouts,
  type Exercise,
  type Settings,
  type TemplateItem,
  type Workout,
  type WorkoutSet,
} from "../db/schema";
import { AppError, badRequest, notFound } from "../errors";
import { newId } from "../ids";
import { addDays, dayOfWeek, formatLocalDate, type LocalDate } from "../time";
import { DAY_MS, dateToMs, msToDate } from "../training/aggregate";
import { compareWeeks, computeTotals, mostTrainedExercises } from "../training/dashboard";
import { computeExerciseStats } from "../training/exerciseStats";
import { buildFacts, groupByExercise, summarizeWorkouts } from "../training/facts";
import { e1rmTrend, muscleVolume, periodChange, plateauCheck, relativeStrength } from "../training/insights";
import { BUILT_IN_EXERCISES } from "../training/library";
import { CELEBRATED_TYPES, computeRecordEvents, RECORD_LABEL, type RecordEvent } from "../training/records";
import { buildSessions, type CalcOptions } from "../training/sessions";
import { maxRepsSeries, periodVolumeSeries, sessionsPerPeriod, sessionVolumeSeries, strengthSeries, weightsUsed } from "../training/series";
import { computeStreaks } from "../training/streaks";
import { CATEGORIES, EQUIPMENT, MUSCLE_GROUPS, type ResolvedRange, type SetFact } from "../training/types";
import { localDateSchema } from "../validation";

// ---------------------------------------------------------------------------
// Validation

const idSchema = z.string().trim().min(1).max(100);

export const exerciseInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  primaryMuscle: z.enum(MUSCLE_GROUPS as [string, ...string[]]),
  secondaryMuscles: z.array(z.enum(MUSCLE_GROUPS as [string, ...string[]])).max(13).default([]),
  equipment: z.enum(EQUIPMENT as [string, ...string[]]),
  category: z.enum(CATEGORIES as [string, ...string[]]),
  instructions: z.string().max(4000).default(""),
});

/** Partial update: no defaults, so omitted fields are left unchanged (zod's .partial() would keep defaults). */
export const exercisePatchSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
  primaryMuscle: z.enum(MUSCLE_GROUPS as [string, ...string[]]).optional(),
  secondaryMuscles: z.array(z.enum(MUSCLE_GROUPS as [string, ...string[]])).max(13).optional(),
  equipment: z.enum(EQUIPMENT as [string, ...string[]]).optional(),
  category: z.enum(CATEGORIES as [string, ...string[]]).optional(),
  instructions: z.string().max(4000).optional(),
  isFavorite: z.boolean().optional(),
  archived: z.boolean().optional(),
});

const setDocSchema = z.object({
  id: idSchema,
  setNumber: z.number().int().min(1).max(999),
  manualSetNumber: z.boolean().default(false),
  weightKg: z.number().min(0).max(1000).nullable(),
  reps: z.number().int().min(0).max(10_000).nullable(),
  rpe: z.number().min(1).max(10).nullable().default(null),
  notes: z.string().max(1000).default(""),
  kind: z.enum(["working", "warmup"]).default("working"),
  completed: z.boolean(),
  targetWeightKg: z.number().min(0).max(1000).nullable().default(null),
  targetReps: z.number().int().min(0).max(10_000).nullable().default(null),
});

export const workoutDocSchema = z.object({
  name: z.string().trim().min(1).max(200),
  localDate: localDateSchema,
  notes: z.string().max(4000).default(""),
  unit: z.enum(["kg", "lb"]),
  exercises: z
    .array(
      z.object({
        id: idSchema,
        exerciseId: idSchema,
        notes: z.string().max(2000).default(""),
        sets: z.array(setDocSchema).max(100),
      }),
    )
    .max(60),
  celebratedRecordKeys: z.array(z.string().max(300)).max(2000).optional(),
});
export type WorkoutDoc = z.infer<typeof workoutDocSchema>;

export const createWorkoutSchema = z.object({
  clientRequestId: z.string().min(8).max(100).optional(),
  localDate: localDateSchema.optional(),
  name: z.string().trim().max(200).optional(),
  templateId: idSchema.optional(),
  repeatWorkoutId: idSchema.optional(),
});

export const templateInputSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(200),
  notes: z.string().max(2000).default(""),
  items: z
    .array(
      z.object({
        id: idSchema.optional(),
        exerciseId: idSchema,
        targetSets: z.number().int().min(1).max(50),
        targetReps: z.number().int().min(1).max(1000).nullable().default(null),
        targetWeightKg: z.number().min(0).max(1000).nullable().default(null),
        notes: z.string().max(1000).default(""),
      }),
    )
    .min(1, "Add at least one exercise")
    .max(60),
});

// ---------------------------------------------------------------------------
// Exercises

let builtInsReady: Promise<void> | null = null;
let builtInsDb: unknown = null;

/** Install built-in exercises that are missing (never overwrites the user's edits). */
export async function ensureBuiltInExercises(db: DbOrTx): Promise<void> {
  if (builtInsDb !== db || !builtInsReady) {
    builtInsDb = db;
    builtInsReady = (async () => {
      const existing = new Set((await db.select({ id: exercises.id }).from(exercises)).map((r) => r.id));
      const missing = BUILT_IN_EXERCISES.filter((e) => !existing.has(e.id));
      if (missing.length) await db.insert(exercises).values(missing).onConflictDoNothing();
    })().catch((err) => {
      builtInsReady = null;
      throw err;
    });
  }
  return builtInsReady;
}

export async function listExercises(db: DbOrTx): Promise<(Exercise & { setCount: number; lastDate: string | null })[]> {
  await ensureBuiltInExercises(db);
  const [rows, usage] = await Promise.all([
    db.select().from(exercises).orderBy(asc(exercises.name)),
    db
      .select({ exerciseId: workoutSets.exerciseId, localDate: workouts.localDate, completed: workoutSets.completed, kind: workoutSets.kind, reps: workoutSets.reps, weightKg: workoutSets.weightKg })
      .from(workoutSets)
      .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId)),
  ]);
  const stats = new Map<string, { setCount: number; lastDate: string | null }>();
  for (const u of usage) {
    // Same rule as statistics (isCountableSet): completed working sets with reps and a weight.
    if (!u.completed || u.kind !== "working" || !u.reps || u.weightKg == null) continue;
    const s = stats.get(u.exerciseId) ?? { setCount: 0, lastDate: null };
    s.setCount += 1;
    if (!s.lastDate || u.localDate > s.lastDate) s.lastDate = u.localDate;
    stats.set(u.exerciseId, s);
  }
  return rows.map((r) => ({ ...r, ...(stats.get(r.id) ?? { setCount: 0, lastDate: null }) }));
}

async function assertUniqueName(db: DbOrTx, name: string, exceptId?: string) {
  const all = await db.select({ id: exercises.id, name: exercises.name, archived: exercises.archived }).from(exercises);
  const lower = name.trim().toLowerCase();
  const clash = all.find((e) => e.name.trim().toLowerCase() === lower && e.id !== exceptId);
  if (clash) throw new AppError(409, "exercise_exists", `An exercise named “${clash.name}” already exists${clash.archived ? " (archived)" : ""}.`);
}

export async function createExercise(db: DbOrTx, input: z.infer<typeof exerciseInputSchema>): Promise<Exercise> {
  await ensureBuiltInExercises(db);
  await assertUniqueName(db, input.name);
  const [row] = await db
    .insert(exercises)
    .values({
      id: newId("cx"),
      name: input.name.trim(),
      primaryMuscle: input.primaryMuscle as Exercise["primaryMuscle"],
      secondaryMuscles: input.secondaryMuscles.filter((m) => m !== input.primaryMuscle) as Exercise["secondaryMuscles"],
      equipment: input.equipment as Exercise["equipment"],
      category: input.category as Exercise["category"],
      instructions: input.instructions,
      isCustom: true,
    })
    .returning();
  return row;
}

export async function updateExercise(db: DbOrTx, id: string, input: z.infer<typeof exercisePatchSchema>): Promise<Exercise> {
  const [cur] = await db.select().from(exercises).where(eq(exercises.id, id));
  if (!cur) throw notFound("Exercise");
  if (input.name) await assertUniqueName(db, input.name, id);
  const patch: Partial<typeof exercises.$inferInsert> = {};
  if (input.name) patch.name = input.name.trim();
  if (input.primaryMuscle) patch.primaryMuscle = input.primaryMuscle as Exercise["primaryMuscle"];
  if (input.secondaryMuscles) patch.secondaryMuscles = input.secondaryMuscles.filter((m) => m !== (input.primaryMuscle ?? cur.primaryMuscle)) as Exercise["secondaryMuscles"];
  if (input.equipment) patch.equipment = input.equipment as Exercise["equipment"];
  if (input.category) patch.category = input.category as Exercise["category"];
  if (input.instructions !== undefined) patch.instructions = input.instructions;
  if (input.isFavorite !== undefined) patch.isFavorite = input.isFavorite;
  if (input.archived !== undefined) patch.archived = input.archived;
  const [row] = await db.update(exercises).set(patch).where(eq(exercises.id, id)).returning();
  return row;
}

/** Delete an unused custom exercise; anything with history or template references is archived instead. */
export async function deleteExercise(db: DbOrTx, id: string): Promise<"deleted" | "archived"> {
  const [cur] = await db.select().from(exercises).where(eq(exercises.id, id));
  if (!cur) throw notFound("Exercise");
  const [used] = await db.select({ id: workoutExercises.id }).from(workoutExercises).where(eq(workoutExercises.exerciseId, id)).limit(1);
  const templates = await db.select({ items: workoutTemplates.items }).from(workoutTemplates);
  const inTemplate = templates.some((t) => t.items.some((i) => i.exerciseId === id));
  if (used || inTemplate || !cur.isCustom) {
    await db.update(exercises).set({ archived: true }).where(eq(exercises.id, id));
    return "archived";
  }
  await db.delete(exercises).where(eq(exercises.id, id));
  return "deleted";
}

// ---------------------------------------------------------------------------
// Loading training data

export interface TrainingData {
  workouts: Workout[];
  sets: WorkoutSet[];
  exercises: Exercise[];
  facts: SetFact[];
  calc: CalcOptions;
}

export function calcOptions(s: Pick<Settings, "oneRmFormula" | "maxRepsFor1rm">): CalcOptions {
  return { formula: s.oneRmFormula, maxRepsFor1RM: s.maxRepsFor1rm };
}

/** All completed and in-progress workouts with their sets. Records and trends need full history. */
export async function loadTrainingData(db: DbOrTx, s: Settings): Promise<TrainingData> {
  await ensureBuiltInExercises(db);
  const [ws, sets, exs] = await Promise.all([db.select().from(workouts), db.select().from(workoutSets), db.select().from(exercises)]);
  return { workouts: ws, sets, exercises: exs, facts: buildFacts({ workouts: ws, sets }), calc: calcOptions(s) };
}

const dayMs = (d: LocalDate) => dateToMs(d);

// ---------------------------------------------------------------------------
// Workouts

export interface WorkoutDetail extends Workout {
  exercises: {
    id: string;
    exerciseId: string;
    position: number;
    notes: string;
    exercise: Pick<Exercise, "id" | "name" | "primaryMuscle" | "equipment" | "archived">;
    sets: WorkoutSet[];
    /** The most recent earlier session of this exercise, shown beside each set. */
    previous: { workoutId: string; localDate: string; sets: { weightKg: number | null; reps: number | null; kind: string }[] } | null;
  }[];
  records: (RecordEvent & { label: string; exerciseName: string | null })[];
}

export async function getWorkout(db: DbOrTx, id: string, s: Settings): Promise<WorkoutDetail> {
  const [w] = await db.select().from(workouts).where(eq(workouts.id, id));
  if (!w) throw notFound("Workout");
  const data = await loadTrainingData(db, s);
  const exById = new Map(data.exercises.map((e) => [e.id, e]));
  const wes = await db.select().from(workoutExercises).where(eq(workoutExercises.workoutId, id)).orderBy(asc(workoutExercises.position));
  const sets = data.sets.filter((x) => x.workoutId === id).sort((a, b) => a.position - b.position);
  const wById = new Map(data.workouts.map((x) => [x.id, x]));

  const previousFor = (exerciseId: string): WorkoutDetail["exercises"][number]["previous"] => {
    const candidates = data.sets.filter((x) => x.exerciseId === exerciseId && x.workoutId !== id && x.completed);
    let best: Workout | null = null;
    for (const c of candidates) {
      const cw = wById.get(c.workoutId);
      // Strictly earlier: an earlier day, or the same day but created before this workout.
      if (!cw || cw.localDate > w.localDate || (cw.localDate === w.localDate && cw.createdAt >= w.createdAt)) continue;
      if (!best || cw.localDate > best.localDate || (cw.localDate === best.localDate && cw.createdAt > best.createdAt)) best = cw;
    }
    if (!best) return null;
    const bw = best;
    const prevSets = candidates.filter((c) => c.workoutId === bw.id).sort((a, b) => a.position - b.position);
    return { workoutId: bw.id, localDate: bw.localDate, sets: prevSets.map((p) => ({ weightKg: p.weightKg, reps: p.reps, kind: p.kind })) };
  };

  const events = computeRecordEvents(data.facts, data.calc, s.weightUnit)
    .filter((e) => e.workoutId === id && CELEBRATED_TYPES.includes(e.type))
    .map((e) => ({ ...e, label: RECORD_LABEL[e.type], exerciseName: e.exerciseId ? (exById.get(e.exerciseId)?.name ?? null) : null }));

  return {
    ...w,
    exercises: wes.map((we) => {
      const ex = exById.get(we.exerciseId);
      return {
        id: we.id,
        exerciseId: we.exerciseId,
        position: we.position,
        notes: we.notes,
        exercise: ex
          ? { id: ex.id, name: ex.name, primaryMuscle: ex.primaryMuscle, equipment: ex.equipment, archived: ex.archived }
          : { id: we.exerciseId, name: "Unknown exercise", primaryMuscle: "full body", equipment: "other", archived: true },
        sets: sets.filter((x) => x.workoutExerciseId === we.id),
        previous: previousFor(we.exerciseId),
      };
    }),
    records: events,
  };
}

export async function inProgressWorkout(db: DbOrTx): Promise<Workout | null> {
  const [w] = await db.select().from(workouts).where(eq(workouts.status, "in_progress")).orderBy(desc(workouts.updatedAt)).limit(1);
  return w ?? null;
}

function defaultWorkoutName(date: LocalDate): string {
  return `${formatLocalDate(date, { weekday: "long" })} Workout`;
}

/**
 * Start a workout (empty, from a template, or repeating an earlier one). Only one
 * workout can be in progress; a retried request with the same clientRequestId
 * returns the workout it already created.
 */
export async function createWorkout(db: Db, input: z.infer<typeof createWorkoutSchema>, s: Settings, today: LocalDate): Promise<{ workout: Workout; created: boolean }> {
  await ensureBuiltInExercises(db);
  if (input.clientRequestId) {
    const [dup] = await db.select().from(workouts).where(eq(workouts.clientRequestId, input.clientRequestId));
    if (dup) return { workout: dup, created: false };
  }
  const active = await inProgressWorkout(db);
  if (active) throw new AppError(409, "workout_in_progress", `“${active.name}” is still in progress. Finish it before starting another.`, { workoutId: active.id });
  const localDate = input.localDate ?? today;
  if (localDate > addDays(today, 1)) throw badRequest("Workouts can't be logged in the future.");

  const id = newId("w");
  const wesRows: (typeof workoutExercises.$inferInsert)[] = [];
  const setRows: (typeof workoutSets.$inferInsert)[] = [];
  let name = input.name?.trim() || defaultWorkoutName(localDate);
  let templateId: string | null = null;

  const blank = (weId: string, exerciseId: string, position: number, patch: Partial<typeof workoutSets.$inferInsert> = {}) => ({
    id: newId("s"),
    workoutId: id,
    workoutExerciseId: weId,
    exerciseId,
    position,
    setNumber: position + 1,
    completed: false,
    ...patch,
  });

  if (input.templateId) {
    const [t] = await db.select().from(workoutTemplates).where(eq(workoutTemplates.id, input.templateId));
    if (!t) throw notFound("Template");
    name = input.name?.trim() || t.name;
    templateId = t.id;
    t.items.forEach((item, i) => {
      const weId = newId("we");
      wesRows.push({ id: weId, workoutId: id, exerciseId: item.exerciseId, position: i, notes: item.notes });
      for (let k = 0; k < Math.max(1, item.targetSets); k++) setRows.push(blank(weId, item.exerciseId, k, { targetWeightKg: item.targetWeightKg, targetReps: item.targetReps }));
    });
  } else if (input.repeatWorkoutId) {
    const [src] = await db.select().from(workouts).where(eq(workouts.id, input.repeatWorkoutId));
    if (!src) throw notFound("Workout");
    name = input.name?.trim() || src.name;
    templateId = src.templateId;
    const srcWes = await db.select().from(workoutExercises).where(eq(workoutExercises.workoutId, src.id)).orderBy(asc(workoutExercises.position));
    const srcSets = await db.select().from(workoutSets).where(eq(workoutSets.workoutId, src.id));
    srcWes.forEach((swe, i) => {
      const weId = newId("we");
      wesRows.push({ id: weId, workoutId: id, exerciseId: swe.exerciseId, position: i, notes: "" });
      const exSets = srcSets.filter((x) => x.workoutExerciseId === swe.id && (x.completed || x.weightKg != null || x.reps != null)).sort((a, b) => a.position - b.position);
      if (!exSets.length) setRows.push(blank(weId, swe.exerciseId, 0));
      exSets.forEach((x, k) => setRows.push(blank(weId, swe.exerciseId, k, { kind: x.kind, targetWeightKg: x.weightKg, targetReps: x.reps })));
    });
  }

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(workouts)
      .values({ id, localDate, name, status: "in_progress", unit: s.weightUnit, templateId, clientRequestId: input.clientRequestId ?? null })
      .onConflictDoNothing({ target: workouts.clientRequestId })
      .returning();
    if (!inserted.length) return null;
    if (wesRows.length) await tx.insert(workoutExercises).values(wesRows);
    if (setRows.length) await tx.insert(workoutSets).values(setRows);
    if (templateId && input.templateId) await tx.update(workoutTemplates).set({ lastUsedAt: new Date() }).where(eq(workoutTemplates.id, templateId));
    return inserted[0];
  });
  if (!created) {
    const [dup] = await db.select().from(workouts).where(eq(workouts.clientRequestId, input.clientRequestId!));
    return { workout: dup, created: false };
  }
  return { workout: created, created: true };
}

/**
 * Save the complete contents of a workout (the editor autosaves this document).
 * Exercises and sets are replaced atomically; ids come from the client so saves
 * are idempotent and set identity is stable across edits.
 */
export async function saveWorkout(db: Db, id: string, doc: WorkoutDoc, today: LocalDate): Promise<Workout> {
  const [w] = await db.select().from(workouts).where(eq(workouts.id, id));
  if (!w) throw notFound("Workout");
  if (doc.localDate > addDays(today, 1)) throw badRequest("Workouts can't be logged in the future.");
  const exIds = [...new Set(doc.exercises.map((e) => e.exerciseId))];
  if (exIds.length) {
    const found = await db.select({ id: exercises.id }).from(exercises).where(inArray(exercises.id, exIds));
    const missing = exIds.filter((x) => !found.some((f) => f.id === x));
    if (missing.length) throw badRequest(`Unknown exercise: ${missing.join(", ")}`);
  }
  const weIds = doc.exercises.map((e) => e.id);
  const setIds = doc.exercises.flatMap((e) => e.sets.map((x) => x.id));
  if (new Set(weIds).size !== weIds.length || new Set(setIds).size !== setIds.length) throw badRequest("Duplicate ids in workout document");

  return db.transaction(async (tx) => {
    // Ids must not belong to another workout.
    if (setIds.length) {
      const clash = await tx.select({ id: workoutSets.id }).from(workoutSets).where(and(inArray(workoutSets.id, setIds), ne(workoutSets.workoutId, id))).limit(1);
      if (clash.length) throw badRequest("Set id belongs to another workout");
    }
    await tx.delete(workoutSets).where(eq(workoutSets.workoutId, id));
    await tx.delete(workoutExercises).where(eq(workoutExercises.workoutId, id));
    if (doc.exercises.length) {
      await tx.insert(workoutExercises).values(doc.exercises.map((e, i) => ({ id: e.id, workoutId: id, exerciseId: e.exerciseId, position: i, notes: e.notes })));
      const rows = doc.exercises.flatMap((e) =>
        e.sets.map((x, k) => ({
          id: x.id,
          workoutId: id,
          workoutExerciseId: e.id,
          exerciseId: e.exerciseId,
          position: k,
          setNumber: x.manualSetNumber ? x.setNumber : k + 1,
          manualSetNumber: x.manualSetNumber,
          weightKg: x.weightKg,
          reps: x.reps,
          rpe: x.rpe,
          notes: x.notes,
          kind: x.kind,
          completed: x.completed,
          targetWeightKg: x.targetWeightKg,
          targetReps: x.targetReps,
        })),
      );
      if (rows.length) await tx.insert(workoutSets).values(rows);
    }
    const [row] = await tx
      .update(workouts)
      .set({
        name: doc.name,
        localDate: doc.localDate,
        notes: doc.notes,
        unit: doc.unit,
        celebratedRecordKeys: doc.celebratedRecordKeys ? [...new Set([...w.celebratedRecordKeys, ...doc.celebratedRecordKeys])] : w.celebratedRecordKeys,
        updatedAt: new Date(),
      })
      .where(eq(workouts.id, id))
      .returning();
    return row;
  });
}

/**
 * Finish a workout. Unticked sets are discarded, or marked complete when they
 * have weight and reps; empty exercises are removed and sets renumbered.
 */
export async function finishWorkout(db: Db, id: string, incomplete: "discard" | "complete"): Promise<Workout> {
  const [w] = await db.select().from(workouts).where(eq(workouts.id, id));
  if (!w) throw notFound("Workout");
  return db.transaction(async (tx) => {
    const sets = await tx.select().from(workoutSets).where(eq(workoutSets.workoutId, id));
    for (const x of sets) {
      if (x.completed) continue;
      if (incomplete === "complete" && x.weightKg != null && x.reps != null && x.reps > 0) {
        await tx.update(workoutSets).set({ completed: true }).where(eq(workoutSets.id, x.id));
      } else {
        await tx.delete(workoutSets).where(eq(workoutSets.id, x.id));
      }
    }
    const wes = await tx.select().from(workoutExercises).where(eq(workoutExercises.workoutId, id)).orderBy(asc(workoutExercises.position));
    const remaining = await tx.select().from(workoutSets).where(eq(workoutSets.workoutId, id));
    let pos = 0;
    for (const we of wes) {
      const mine = remaining.filter((x) => x.workoutExerciseId === we.id).sort((a, b) => a.position - b.position);
      if (!mine.length) {
        await tx.delete(workoutExercises).where(eq(workoutExercises.id, we.id));
        continue;
      }
      if (we.position !== pos) await tx.update(workoutExercises).set({ position: pos }).where(eq(workoutExercises.id, we.id));
      pos += 1;
      for (const [i, x] of mine.entries()) {
        const patch: Partial<WorkoutSet> = {};
        if (x.position !== i) patch.position = i;
        if (!x.manualSetNumber && x.setNumber !== i + 1) patch.setNumber = i + 1;
        if (Object.keys(patch).length) await tx.update(workoutSets).set(patch).where(eq(workoutSets.id, x.id));
      }
    }
    const [row] = await tx.update(workouts).set({ status: "completed", updatedAt: new Date() }).where(eq(workouts.id, id)).returning();
    return row;
  });
}

export async function reopenWorkout(db: DbOrTx, id: string): Promise<Workout> {
  const active = await inProgressWorkout(db);
  if (active && active.id !== id) throw new AppError(409, "workout_in_progress", `Finish “${active.name}” before reopening another workout.`, { workoutId: active.id });
  const [row] = await db.update(workouts).set({ status: "in_progress", updatedAt: new Date() }).where(eq(workouts.id, id)).returning();
  if (!row) throw notFound("Workout");
  return row;
}

export async function deleteWorkout(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(workouts).where(eq(workouts.id, id)).returning({ id: workouts.id });
  if (!rows.length) throw notFound("Workout");
}

export interface WorkoutSummaryRow {
  id: string;
  localDate: string;
  name: string;
  status: Workout["status"];
  notes: string;
  exerciseNames: string[];
  setCount: number;
  totalReps: number;
  volumeKg: number;
  recordCount: number;
  source: Workout["source"];
}

export async function listWorkouts(db: DbOrTx, s: Settings, filter: { start?: LocalDate; end?: LocalDate; exerciseId?: string; q?: string; limit?: number } = {}): Promise<WorkoutSummaryRow[]> {
  const data = await loadTrainingData(db, s);
  const exById = new Map(data.exercises.map((e) => [e.id, e]));
  const summaries = new Map(summarizeWorkouts(data.facts).map((x) => [x.workoutId, x]));
  const events = computeRecordEvents(data.facts, data.calc, s.weightUnit).filter((e) => CELEBRATED_TYPES.includes(e.type));
  const recordCount = new Map<string, number>();
  for (const e of events) recordCount.set(e.workoutId, (recordCount.get(e.workoutId) ?? 0) + 1);
  const exercisesByWorkout = new Map<string, string[]>();
  for (const x of [...data.sets].sort((a, b) => a.position - b.position)) {
    const list = exercisesByWorkout.get(x.workoutId) ?? [];
    if (!list.includes(x.exerciseId)) list.push(x.exerciseId);
    exercisesByWorkout.set(x.workoutId, list);
  }
  const q = filter.q?.trim().toLowerCase();
  let rows = data.workouts
    .filter((w) => (!filter.start || w.localDate >= filter.start) && (!filter.end || w.localDate <= filter.end))
    .filter((w) => !filter.exerciseId || (exercisesByWorkout.get(w.id) ?? []).includes(filter.exerciseId))
    .map((w) => {
      const sum = summaries.get(w.id);
      const names = (exercisesByWorkout.get(w.id) ?? []).map((x) => exById.get(x)?.name ?? x);
      return {
        id: w.id,
        localDate: w.localDate,
        name: w.name,
        status: w.status,
        notes: w.notes,
        exerciseNames: names,
        setCount: sum?.setCount ?? 0,
        totalReps: sum?.totalReps ?? 0,
        volumeKg: sum?.volumeKg ?? 0,
        recordCount: recordCount.get(w.id) ?? 0,
        source: w.source,
        createdAt: w.createdAt,
      };
    })
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q) || r.exerciseNames.some((n) => n.toLowerCase().includes(q)))
    .sort((a, b) => b.localDate.localeCompare(a.localDate) || b.createdAt.getTime() - a.createdAt.getTime())
    .map(({ createdAt: _c, ...r }) => {
      void _c;
      return r;
    });
  if (filter.limit) rows = rows.slice(0, filter.limit);
  return rows;
}

// ---------------------------------------------------------------------------
// Templates

export async function listTemplates(db: DbOrTx) {
  // Recently used first; never-used templates after them (Postgres sorts NULLs first for DESC).
  return db.select().from(workoutTemplates).orderBy(sql`${workoutTemplates.lastUsedAt} desc nulls last`, asc(workoutTemplates.name));
}

async function assertExercisesExist(db: DbOrTx, ids: string[]) {
  await ensureBuiltInExercises(db);
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const found = await db.select({ id: exercises.id }).from(exercises).where(inArray(exercises.id, unique));
  if (found.length !== unique.length) throw badRequest("Template references an unknown exercise");
}

export async function saveTemplate(db: DbOrTx, input: z.infer<typeof templateInputSchema>, id?: string) {
  await assertExercisesExist(db, input.items.map((i) => i.exerciseId));
  const items: TemplateItem[] = input.items.map((i) => ({ id: i.id ?? newId("ti"), exerciseId: i.exerciseId, targetSets: i.targetSets, targetReps: i.targetReps, targetWeightKg: i.targetWeightKg, notes: i.notes }));
  if (id) {
    const [row] = await db.update(workoutTemplates).set({ name: input.name, notes: input.notes, items }).where(eq(workoutTemplates.id, id)).returning();
    if (!row) throw notFound("Template");
    return row;
  }
  const [row] = await db.insert(workoutTemplates).values({ id: newId("t"), name: input.name, notes: input.notes, items }).returning();
  return row;
}

export async function deleteTemplate(db: DbOrTx, id: string) {
  const rows = await db.delete(workoutTemplates).where(eq(workoutTemplates.id, id)).returning({ id: workoutTemplates.id });
  if (!rows.length) throw notFound("Template");
}

export async function duplicateTemplate(db: DbOrTx, id: string) {
  const [t] = await db.select().from(workoutTemplates).where(eq(workoutTemplates.id, id));
  if (!t) throw notFound("Template");
  const [row] = await db
    .insert(workoutTemplates)
    .values({ id: newId("t"), name: `${t.name} (copy)`, notes: t.notes, items: t.items.map((i) => ({ ...i, id: newId("ti") })) })
    .returning();
  return row;
}

/** Build a template from a logged workout: exercise order, working-set count, top weight and reps. */
export async function templateFromWorkout(db: DbOrTx, workoutId: string) {
  const [w] = await db.select().from(workouts).where(eq(workouts.id, workoutId));
  if (!w) throw notFound("Workout");
  const wes = await db.select().from(workoutExercises).where(eq(workoutExercises.workoutId, workoutId)).orderBy(asc(workoutExercises.position));
  const sets = await db.select().from(workoutSets).where(eq(workoutSets.workoutId, workoutId));
  const items: z.infer<typeof templateInputSchema>["items"] = [];
  for (const we of wes) {
    const working = sets.filter((x) => x.workoutExerciseId === we.id && x.kind === "working" && x.completed);
    if (!working.length) continue;
    const top = working.reduce((a, b) => ((b.weightKg ?? 0) > (a.weightKg ?? 0) ? b : a));
    items.push({ exerciseId: we.exerciseId, targetSets: working.length, targetReps: top.reps && top.reps > 0 ? top.reps : null, targetWeightKg: top.weightKg, notes: we.notes });
  }
  if (!items.length) throw badRequest("This workout has no completed working sets to build a template from.");
  return saveTemplate(db, { name: w.name, notes: "", items });
}

// ---------------------------------------------------------------------------
// Statistics

function rangeMs(range: { start: LocalDate; end: LocalDate } | null): ResolvedRange {
  if (!range) return { startMs: null, endMs: null };
  return { startMs: dayMs(range.start), endMs: dayMs(range.end) + DAY_MS - 1 };
}

const nowFor = (today: LocalDate) => new Date(dayMs(today) + 12 * 3600_000);

/** Workouts that have at least one countable set, by local date. */
export function workoutDates(data: TrainingData): Map<LocalDate, string[]> {
  const map = new Map<LocalDate, string[]>();
  const counted = new Set(data.facts.map((f) => f.workoutId));
  for (const w of data.workouts) {
    if (!counted.has(w.id)) continue;
    const list = map.get(w.localDate) ?? [];
    list.push(w.id);
    map.set(w.localDate, list);
  }
  return map;
}

export async function trainingOverview(db: DbOrTx, s: Settings, today: LocalDate) {
  const data = await loadTrainingData(db, s);
  const exById = new Map(data.exercises.map((e) => [e.id, e]));
  const now = nowFor(today);
  const top = mostTrainedExercises(data.facts).slice(0, 4);
  const byExercise = groupByExercise(data.facts);
  const keyLifts = top.map((t) => {
    const sessions = buildSessions(byExercise.get(t.exerciseId) ?? [], data.calc);
    const last = sessions[sessions.length - 1];
    return {
      exerciseId: t.exerciseId,
      name: exById.get(t.exerciseId)?.name ?? t.exerciseId,
      sessions: t.sessions,
      lastDate: msToDate(t.lastMs),
      bestE1rmKg: Math.max(0, ...sessions.map((x) => x.bestE1rm ?? 0)) || null,
      latestE1rmKg: last?.bestE1rm ?? null,
      change30: periodChange(sessions, 30, now),
      change90: periodChange(sessions, 90, now),
      series: sessions.slice(-12).map((x) => ({ date: msToDate(x.dateMs), e1rmKg: x.bestE1rm, topKg: x.topWeightKg })),
    };
  });
  const events = computeRecordEvents(data.facts, data.calc, s.weightUnit);
  const wById = new Map(data.workouts.map((w) => [w.id, w]));
  const dates = [...workoutDates(data).entries()].flatMap(([d, ids]) => ids.map(() => dayMs(d)));
  const active = data.workouts.find((w) => w.status === "in_progress") ?? null;
  const todays = data.workouts.filter((w) => w.localDate === today);
  return {
    totals: computeTotals(data.facts),
    week: compareWeeks(data.facts, now, s.weekStartsOn as 0 | 1, data.calc, top.map((t) => t.exerciseId)),
    streak: computeStreaks(dates, now, s.weekStartsOn as 0 | 1, 1),
    inProgress: active ? { id: active.id, name: active.name, localDate: active.localDate } : null,
    today: todays.map((w) => ({ id: w.id, name: w.name, status: w.status })),
    keyLifts,
    recentRecords: events
      .filter((e) => e.type !== "milestone" && e.type !== "beatLast")
      .slice(0, 8)
      .map((e) => ({ ...e, label: RECORD_LABEL[e.type], exerciseName: e.exerciseId ? (exById.get(e.exerciseId)?.name ?? null) : null, date: wById.get(e.workoutId)?.localDate ?? msToDate(e.dateMs) })),
    recentWorkouts: await listWorkouts(db, s, { limit: 6 }),
  };
}

export async function exerciseDetail(db: DbOrTx, id: string, s: Settings, today: LocalDate) {
  const data = await loadTrainingData(db, s);
  const ex = data.exercises.find((e) => e.id === id);
  if (!ex) throw notFound("Exercise");
  const facts = data.facts.filter((f) => f.exerciseId === id);
  const unit = s.weightUnit;
  const stats = computeExerciseStats(id, facts, data.calc, unit);
  const now = nowFor(today);
  const wById = new Map(data.workouts.map((w) => [w.id, w]));
  const events = computeRecordEvents(data.facts, data.calc, unit).filter((e) => e.exerciseId === id);
  const all: ResolvedRange = { startMs: null, endMs: null };
  return {
    exercise: ex,
    stats: { ...stats, sessions: undefined, comparison: stats.comparison ? { ...stats.comparison, latest: undefined, previous: undefined, latestDate: msToDate(stats.comparison.latest.dateMs), previousDate: msToDate(stats.comparison.previous.dateMs) } : null },
    trend: e1rmTrend(stats.sessions),
    plateau: plateauCheck(stats.sessions, now),
    changes: { d30: periodChange(stats.sessions, 30, now), d90: periodChange(stats.sessions, 90, now), d180: periodChange(stats.sessions, 180, now) },
    relative: relativeStrength(id, stats.sessions, now),
    series: {
      strength: strengthSeries(stats.sessions, unit).map((p) => ({ ...p, date: msToDate(p.x) })),
      sessionVolume: sessionVolumeSeries(stats.sessions, unit).map((p) => ({ ...p, date: msToDate(p.startMs) })),
      weeklyVolume: periodVolumeSeries(facts, "week", s.weekStartsOn as 0 | 1, all, unit, now.getTime()).map((p) => ({ ...p, date: msToDate(p.startMs) })),
      sessionsPerWeek: sessionsPerPeriod(facts, "week", s.weekStartsOn as 0 | 1, all, now.getTime()).map((p) => ({ ...p, date: msToDate(p.startMs) })),
      maxReps: maxRepsSeries(stats.sessions, unit).map((p) => ({ ...p, date: msToDate(p.x) })),
      weightsUsed: weightsUsed(stats.sessions, unit),
      repsByWeight: stats.sessions.map((x) => ({ date: msToDate(x.dateMs), sets: x.sets.map((f) => ({ weightKg: f.weightKg, reps: f.reps })) })),
    },
    records: events.map((e) => ({ ...e, label: RECORD_LABEL[e.type], date: wById.get(e.workoutId)?.localDate ?? msToDate(e.dateMs) })),
    history: [...stats.sessions].reverse().map((x) => ({
      workoutId: x.workoutId,
      workoutName: wById.get(x.workoutId)?.name ?? "Workout",
      date: msToDate(x.dateMs),
      sets: x.sets.map((f) => ({ id: f.id, setNumber: f.setNumber, weightKg: f.weightKg, reps: f.reps, rpe: f.rpe })),
      volumeKg: x.volumeKg,
      bestE1rmKg: x.bestE1rm,
      topWeightKg: x.topWeightKg,
      totalReps: x.totalReps,
    })),
  };
}

export async function trainingRecords(db: DbOrTx, s: Settings, range: { start: LocalDate; end: LocalDate } | null) {
  const data = await loadTrainingData(db, s);
  const exById = new Map(data.exercises.map((e) => [e.id, e]));
  const wById = new Map(data.workouts.map((w) => [w.id, w]));
  const all = computeRecordEvents(data.facts, data.calc, s.weightUnit);
  const r = rangeMs(range);
  const inRange = all.filter((e) => (r.startMs == null || e.dateMs >= r.startMs) && (r.endMs == null || e.dateMs <= r.endMs));
  // Personal bests per exercise (all time, and within the range).
  const bests = [...groupByExercise(data.facts).entries()].map(([exerciseId, facts]) => {
    const life = computeExerciseStats(exerciseId, facts, data.calc, s.weightUnit);
    const rf = facts.filter((f) => (r.startMs == null || f.dateMs >= r.startMs) && (r.endMs == null || f.dateMs <= r.endMs));
    const ranged = rf.length ? computeExerciseStats(exerciseId, rf, data.calc, s.weightUnit) : null;
    const pick = (st: typeof life | null) =>
      st
        ? {
            heaviestKg: st.heaviest?.value ?? null,
            heaviestReps: st.heaviest?.reps ?? null,
            heaviestDate: st.heaviest ? msToDate(st.heaviest.dateMs) : null,
            bestE1rmKg: st.bestE1rm?.value ?? null,
            bestE1rmDate: st.bestE1rm ? msToDate(st.bestE1rm.dateMs) : null,
            bestE1rmSet: st.bestE1rm ? { weightKg: st.bestE1rm.weightKg, reps: st.bestE1rm.reps, confidence: st.bestE1rm.confidence } : null,
            bestSessionVolumeKg: st.bestSessionVolume?.value ?? null,
            mostReps: st.mostReps ? { reps: st.mostReps.value, weightKg: st.mostReps.weightKg } : null,
          }
        : null;
    return { exerciseId, name: exById.get(exerciseId)?.name ?? exerciseId, sessions: life.sessionCount, allTime: pick(life), inRange: pick(ranged) };
  });
  return {
    range,
    events: inRange.map((e) => ({ ...e, label: RECORD_LABEL[e.type], exerciseName: e.exerciseId ? (exById.get(e.exerciseId)?.name ?? null) : null, date: wById.get(e.workoutId)?.localDate ?? msToDate(e.dateMs), workoutName: wById.get(e.workoutId)?.name ?? null })),
    bests: bests.sort((a, b) => b.sessions - a.sessions),
  };
}

export async function trainingAnalytics(db: DbOrTx, s: Settings, range: { start: LocalDate; end: LocalDate }, today: LocalDate) {
  const data = await loadTrainingData(db, s);
  const exById = new Map(data.exercises.map((e) => [e.id, e]));
  const r = rangeMs(range);
  const now = nowFor(today);
  const facts = data.facts.filter((f) => f.dateMs >= r.startMs! && f.dateMs <= r.endMs!);
  const ws = s.weekStartsOn as 0 | 1;
  const unit = s.weightUnit;
  const byExercise = groupByExercise(data.facts);
  const exerciseInsights = [...byExercise.entries()]
    .map(([exerciseId, list]) => {
      const sessions = buildSessions(list, data.calc);
      const inRangeSessions = sessions.filter((x) => x.dateMs >= r.startMs! && x.dateMs <= r.endMs!);
      return {
        exerciseId,
        name: exById.get(exerciseId)?.name ?? exerciseId,
        muscle: exById.get(exerciseId)?.primaryMuscle ?? null,
        sessionsInRange: inRangeSessions.length,
        trend: e1rmTrend(inRangeSessions.length >= 4 ? inRangeSessions : sessions.filter((x) => x.dateMs <= r.endMs!)),
        plateau: plateauCheck(sessions, now),
        relative: relativeStrength(exerciseId, sessions, now),
      };
    })
    .filter((x) => x.sessionsInRange > 0);
  const dailyWorkouts = new Map<string, Set<string>>();
  for (const f of facts) {
    const set = dailyWorkouts.get(f.date) ?? new Set();
    set.add(f.workoutId);
    dailyWorkouts.set(f.date, set);
  }
  return {
    range,
    totals: computeTotals(facts),
    workoutsPerWeek: sessionsPerPeriod(facts, "week", ws, r, now.getTime()).map((p) => ({ ...p, date: msToDate(p.startMs) })),
    workoutsPerMonth: sessionsPerPeriod(facts, "month", ws, r, now.getTime()).map((p) => ({ ...p, date: msToDate(p.startMs) })),
    volumePerWeek: periodVolumeSeries(facts, "week", ws, r, unit, now.getTime()).map((p) => ({ ...p, date: msToDate(p.startMs) })),
    setsPerWeek: aggregateSets(facts, ws, r, now.getTime()),
    muscles: muscleVolume(facts, exById, r, now),
    exercises: exerciseInsights.sort((a, b) => b.sessionsInRange - a.sessionsInRange),
    trainingDays: [...dailyWorkouts.keys()].sort(),
  };
}

function aggregateSets(facts: SetFact[], ws: 0 | 1, r: ResolvedRange, nowMs: number) {
  // Reuse the volume series machinery with value = 1 per set.
  return periodVolumeSeries(
    facts.map((f) => ({ ...f, weightKg: 1, reps: 1 })),
    "week",
    ws,
    r,
    "kg",
    nowMs,
  ).map((p) => ({ startMs: p.startMs, label: p.label, value: p.value, date: msToDate(p.startMs) }));
}

/** Per-day training summary used by the dashboard, goals and insights. */
export function dailyTraining(data: TrainingData): Map<LocalDate, { workouts: number; sets: number; reps: number; volumeKg: number }> {
  const map = new Map<LocalDate, { workouts: Set<string>; sets: number; reps: number; volumeKg: number }>();
  for (const f of data.facts) {
    const d = map.get(f.date) ?? { workouts: new Set<string>(), sets: 0, reps: 0, volumeKg: 0 };
    d.workouts.add(f.workoutId);
    d.sets += 1;
    d.reps += f.reps;
    d.volumeKg += f.weightKg * f.reps;
    map.set(f.date, d);
  }
  return new Map([...map.entries()].map(([k, v]) => [k, { workouts: v.workouts.size, sets: v.sets, reps: v.reps, volumeKg: v.volumeKg }]));
}

export async function earliestWorkoutDate(db: DbOrTx): Promise<LocalDate | null> {
  const [row] = await db.select({ d: workouts.localDate }).from(workouts).orderBy(asc(workouts.localDate)).limit(1);
  return row?.d ?? null;
}

export async function workoutsOn(db: DbOrTx, date: LocalDate) {
  return db.select().from(workouts).where(and(gte(workouts.localDate, date), lte(workouts.localDate, date))).orderBy(asc(workouts.createdAt));
}

export { dayOfWeek };
