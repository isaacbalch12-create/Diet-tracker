/**
 * Import a LiftLog (the original workout tracker) JSON backup.
 *
 * LiftLog stored everything in the phone's browser, so its history reaches this
 * app through its "Backup (JSON)" file. The import is a merge keyed by LiftLog's
 * own ids, so:
 * - importing the same file twice changes nothing (no duplicates);
 * - importing a newer backup updates only workouts edited since (newest copy wins,
 *   compared by `updatedAt`); a workout edited here afterwards is never overwritten
 *   by an older LiftLog copy.
 *
 * Time-based data is not carried over as features: workout durations, rest timers
 * and set completion times are dropped. The original start/end timestamps are kept
 * in `workouts.legacy` for provenance only.
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { exercises, settings as settingsTable, userGoals, workoutExercises, workoutSets, workoutTemplates, workouts, type Settings } from "../db/schema";
import { badRequest } from "../errors";
import { logicalDate, type LocalDate } from "../time";
import { CATEGORIES, EQUIPMENT, MUSCLE_GROUPS } from "../training/types";
import { ensureBuiltInExercises } from "./training";

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");
const nullableNum = z.number().finite().nullable();
const muscle = z.enum(MUSCLE_GROUPS as [string, ...string[]]);

const exerciseSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  primaryMuscle: muscle,
  secondaryMuscles: z.array(muscle).default([]),
  equipment: z.enum(EQUIPMENT as [string, ...string[]]),
  category: z.enum(CATEGORIES as [string, ...string[]]),
  instructions: z.string().max(4000).default(""),
  isCustom: z.boolean(),
  isFavorite: z.boolean().default(false),
  archived: z.boolean().default(false),
  createdAt: iso,
  updatedAt: iso,
});

const workoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(200),
  status: z.enum(["active", "completed"]),
  startedAt: iso,
  endedAt: iso.nullable(),
  notes: z.string().default(""),
  templateId: z.string().nullable().default(null),
  unit: z.enum(["kg", "lb"]),
  celebratedRecordKeys: z.array(z.string()).default([]),
  createdAt: iso,
  updatedAt: iso,
});

const workoutExerciseSchema = z.object({
  id: z.string().min(1),
  workoutId: z.string().min(1),
  exerciseId: z.string().min(1),
  position: z.number().int(),
  notes: z.string().default(""),
  restSeconds: z.number().int().min(0).nullable().default(null),
});

const setSchema = z.object({
  id: z.string().min(1),
  workoutId: z.string().min(1),
  workoutExerciseId: z.string().min(1),
  exerciseId: z.string().min(1),
  position: z.number().int(),
  setNumber: z.number().int().min(1).max(999),
  manualSetNumber: z.boolean().default(false),
  weightKg: nullableNum.refine((v) => v == null || v >= 0, "Weight cannot be negative"),
  reps: z.number().int().min(0).max(10000).nullable(),
  rpe: z.number().min(1).max(10).nullable().default(null),
  notes: z.string().default(""),
  kind: z.enum(["working", "warmup"]).default("working"),
  completed: z.boolean(),
  completedAt: iso.nullable().default(null),
  targetWeightKg: nullableNum.default(null),
  targetReps: z.number().int().nullable().default(null),
  createdAt: iso,
  updatedAt: iso,
});

const templateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  notes: z.string().default(""),
  items: z.array(
    z.object({
      id: z.string().min(1),
      exerciseId: z.string().min(1),
      targetSets: z.number().int().min(1).max(50),
      targetReps: z.number().int().min(1).max(1000).nullable(),
      targetWeightKg: nullableNum,
      restSeconds: z.number().int().min(0).nullable(),
      notes: z.string().default(""),
    }),
  ),
  lastUsedAt: iso.nullable().default(null),
  createdAt: iso,
  updatedAt: iso,
});

const settingsSchema = z
  .object({
    unit: z.enum(["kg", "lb"]),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
    oneRmFormula: z.enum(["epley", "brzycki"]),
    maxRepsFor1RM: z.number().int().min(1).max(30),
    weeklyTarget: z.number().int().min(1).max(14),
    showRpe: z.boolean(),
  })
  .passthrough();

export const liftlogBackupSchema = z.object({
  format: z.literal("liftlog-backup"),
  version: z.literal(1),
  exportedAt: iso,
  data: z.object({
    exercises: z.array(exerciseSchema),
    workouts: z.array(workoutSchema),
    workoutExercises: z.array(workoutExerciseSchema),
    sets: z.array(setSchema),
    templates: z.array(templateSchema),
    settings: settingsSchema.nullable(),
  }),
});
export type LiftlogBackup = z.infer<typeof liftlogBackupSchema>;

export interface LiftlogImportSummary {
  workoutsAdded: number;
  workoutsUpdated: number;
  workoutsUnchanged: number;
  sets: number;
  exercisesAdded: number;
  exercisesUpdated: number;
  templatesAdded: number;
  templatesUpdated: number;
  skippedOrphans: number;
  placeholders: number;
  weeklyGoalCreated: boolean;
  notes: string[];
}

export function parseLiftlogBackup(raw: unknown): LiftlogBackup {
  const parsed = liftlogBackupSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(`Not a valid LiftLog backup (${issue?.path.join(".") || "root"}: ${issue?.message}).`);
  }
  return parsed.data;
}

const DEFAULT_TRAINING = { oneRmFormula: "epley", maxRepsFor1rm: 12, showRpe: false } as const;

export async function importLiftlog(db: Db, raw: unknown, s: Settings, today: LocalDate): Promise<LiftlogImportSummary> {
  const backup = parseLiftlogBackup(raw);
  const d = backup.data;
  await ensureBuiltInExercises(db);

  const workoutIds = new Set(d.workouts.map((w) => w.id));
  const wes = d.workoutExercises.filter((we) => workoutIds.has(we.workoutId));
  const weIds = new Set(wes.map((we) => we.id));
  const sets = d.sets.filter((x) => workoutIds.has(x.workoutId) && weIds.has(x.workoutExerciseId));
  const summary: LiftlogImportSummary = {
    workoutsAdded: 0,
    workoutsUpdated: 0,
    workoutsUnchanged: 0,
    sets: 0,
    exercisesAdded: 0,
    exercisesUpdated: 0,
    templatesAdded: 0,
    templatesUpdated: 0,
    skippedOrphans: d.workoutExercises.length - wes.length + (d.sets.length - sets.length),
    placeholders: 0,
    weeklyGoalCreated: false,
    notes: [],
  };

  await db.transaction(async (tx) => {
    // --- Exercises -----------------------------------------------------------
    const local = new Map((await tx.select().from(exercises)).map((e) => [e.id, e]));
    const localNames = new Map([...local.values()].map((e) => [e.name.trim().toLowerCase(), e.id]));
    for (const e of d.exercises) {
      const cur = local.get(e.id);
      const incomingUpdated = new Date(e.updatedAt);
      const values = {
        name: e.name.trim(),
        primaryMuscle: e.primaryMuscle as never,
        secondaryMuscles: e.secondaryMuscles.filter((m) => m !== e.primaryMuscle) as never,
        equipment: e.equipment as never,
        category: e.category as never,
        instructions: e.instructions,
        isFavorite: e.isFavorite,
        archived: e.archived,
      };
      if (!cur) {
        let name = values.name;
        const clash = localNames.get(name.toLowerCase());
        if (clash && clash !== e.id) name = `${name} (LiftLog)`;
        await tx.insert(exercises).values({ id: e.id, ...values, name, isCustom: e.isCustom, createdAt: new Date(e.createdAt), updatedAt: incomingUpdated });
        localNames.set(name.toLowerCase(), e.id);
        summary.exercisesAdded += 1;
        continue;
      }
      if (!e.isCustom) {
        // Built-ins: bring over LiftLog edits (favorites, archive, notes) unless the
        // exercise was already edited in this app.
        const editedThere = new Date(e.updatedAt).getTime() > new Date(e.createdAt).getTime() + 1000;
        const editedHere = cur.updatedAt.getTime() > cur.createdAt.getTime() + 1000;
        if (editedThere && !editedHere && (cur.isFavorite !== e.isFavorite || cur.archived !== e.archived || cur.instructions !== e.instructions)) {
          await tx.update(exercises).set({ isFavorite: e.isFavorite, archived: e.archived, instructions: e.instructions, updatedAt: incomingUpdated }).where(eq(exercises.id, e.id));
          summary.exercisesUpdated += 1;
        }
        continue;
      }
      if (incomingUpdated.getTime() > cur.updatedAt.getTime()) {
        await tx.update(exercises).set({ ...values, updatedAt: incomingUpdated }).where(eq(exercises.id, e.id));
        summary.exercisesUpdated += 1;
      }
    }
    // Exercises referenced by sets but missing everywhere get a placeholder, so no set is lost.
    const known = new Set((await tx.select({ id: exercises.id }).from(exercises)).map((r) => r.id));
    const missing = [...new Set([...sets.map((x) => x.exerciseId), ...wes.map((w) => w.exerciseId)])].filter((id) => !known.has(id));
    for (const id of missing) {
      await tx.insert(exercises).values({ id, name: `Restored exercise ${id.slice(-6)}`, primaryMuscle: "full body", secondaryMuscles: [], equipment: "other", category: "compound", isCustom: true });
      summary.placeholders += 1;
    }

    // --- Templates -----------------------------------------------------------
    const localTemplates = new Map((await tx.select().from(workoutTemplates)).map((t) => [t.id, t]));
    for (const t of d.templates) {
      const items = t.items.map((i) => ({ id: i.id, exerciseId: i.exerciseId, targetSets: i.targetSets, targetReps: i.targetReps, targetWeightKg: i.targetWeightKg, notes: i.notes }));
      const cur = localTemplates.get(t.id);
      const updatedAt = new Date(t.updatedAt);
      if (!cur) {
        await tx.insert(workoutTemplates).values({ id: t.id, name: t.name, notes: t.notes, items, lastUsedAt: t.lastUsedAt ? new Date(t.lastUsedAt) : null, createdAt: new Date(t.createdAt), updatedAt });
        summary.templatesAdded += 1;
      } else if (updatedAt.getTime() > cur.updatedAt.getTime()) {
        await tx.update(workoutTemplates).set({ name: t.name, notes: t.notes, items, updatedAt }).where(eq(workoutTemplates.id, t.id));
        summary.templatesUpdated += 1;
      }
    }
    if (d.templates.some((t) => t.items.some((i) => i.restSeconds != null))) summary.notes.push("Template rest times were not imported (this app doesn't track time).");

    // --- Workouts (each taken whole from the newer copy) ---------------------
    const existing = d.workouts.length
      ? new Map((await tx.select().from(workouts).where(inArray(workouts.id, d.workouts.map((w) => w.id)))).map((w) => [w.id, w]))
      : new Map();
    const [activeHere] = await tx.select({ id: workouts.id }).from(workouts).where(eq(workouts.status, "in_progress")).limit(1);
    let allowActive = !activeHere;
    for (const w of [...d.workouts].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
      const cur = existing.get(w.id);
      const updatedAt = new Date(w.updatedAt);
      if (cur && cur.updatedAt.getTime() >= updatedAt.getTime()) {
        summary.workoutsUnchanged += 1;
        continue;
      }
      let status: "in_progress" | "completed" = "completed";
      if (w.status === "active" && (allowActive || cur?.status === "in_progress")) {
        status = "in_progress";
        allowActive = false;
      }
      const row = {
        id: w.id,
        localDate: logicalDate(new Date(w.startedAt), s.timezone, s.dayStartHour),
        name: w.name.trim() || "Workout",
        status,
        notes: w.notes,
        templateId: w.templateId,
        unit: w.unit,
        celebratedRecordKeys: w.celebratedRecordKeys,
        source: "liftlog" as const,
        legacy: { app: "liftlog", startedAt: w.startedAt, endedAt: w.endedAt, updatedAt: w.updatedAt },
        createdAt: new Date(w.createdAt),
        updatedAt,
      };
      if (cur) {
        await tx.delete(workoutSets).where(eq(workoutSets.workoutId, w.id));
        await tx.delete(workoutExercises).where(eq(workoutExercises.workoutId, w.id));
        await tx.update(workouts).set(row).where(eq(workouts.id, w.id));
        summary.workoutsUpdated += 1;
      } else {
        await tx.insert(workouts).values(row);
        summary.workoutsAdded += 1;
      }
      const myWes = wes.filter((we) => we.workoutId === w.id);
      if (myWes.length) await tx.insert(workoutExercises).values(myWes.map((we) => ({ id: we.id, workoutId: w.id, exerciseId: we.exerciseId, position: we.position, notes: we.notes })));
      const mySets = sets.filter((x) => x.workoutId === w.id);
      for (let i = 0; i < mySets.length; i += 500) {
        await tx.insert(workoutSets).values(
          mySets.slice(i, i + 500).map((x) => ({
            id: x.id,
            workoutId: x.workoutId,
            workoutExerciseId: x.workoutExerciseId,
            exerciseId: x.exerciseId,
            position: x.position,
            setNumber: x.setNumber,
            manualSetNumber: x.manualSetNumber,
            weightKg: x.weightKg,
            reps: x.reps,
            rpe: x.rpe,
            notes: x.notes,
            kind: x.kind,
            completed: x.completed,
            targetWeightKg: x.targetWeightKg,
            targetReps: x.targetReps,
            createdAt: new Date(x.createdAt),
            updatedAt: new Date(x.updatedAt),
          })),
        );
      }
      summary.sets += mySets.length;
    }
    if (d.workouts.some((w) => w.status === "active") && !allowActive && activeHere) summary.notes.push("A workout in progress in LiftLog was imported as completed because one is already in progress here.");

    // --- Settings and weekly target -----------------------------------------
    if (d.settings) {
      const ls = d.settings;
      const patch: Partial<typeof settingsTable.$inferInsert> = {};
      if (s.oneRmFormula === DEFAULT_TRAINING.oneRmFormula && ls.oneRmFormula !== s.oneRmFormula) patch.oneRmFormula = ls.oneRmFormula;
      if (s.maxRepsFor1rm === DEFAULT_TRAINING.maxRepsFor1rm && ls.maxRepsFor1RM !== s.maxRepsFor1rm) patch.maxRepsFor1rm = ls.maxRepsFor1RM;
      if (s.showRpe === DEFAULT_TRAINING.showRpe && ls.showRpe !== s.showRpe) patch.showRpe = ls.showRpe;
      if (Object.keys(patch).length) await tx.update(settingsTable).set(patch).where(eq(settingsTable.id, 1));
      const goals = await tx.select({ metric: userGoals.metric }).from(userGoals);
      if (!goals.some((g) => g.metric === "workouts")) {
        await tx.insert(userGoals).values({
          title: `Work out ${ls.weeklyTarget}× per week`,
          category: "exercise",
          metric: "workouts",
          comparator: "at_least",
          targetValue: ls.weeklyTarget,
          unit: "workouts",
          period: "weekly",
          startDate: today,
          targetHistory: [{ from: today, value: ls.weeklyTarget, max: null }],
          notes: "Created from your LiftLog weekly target.",
        });
        summary.weeklyGoalCreated = true;
      }
    }
  });
  if (d.workouts.some((w) => w.endedAt) || d.workoutExercises.some((w) => w.restSeconds != null)) {
    summary.notes.push("Workout durations and rest timers were not imported as features; original start/end times are kept only as import metadata.");
  }
  return summary;
}
