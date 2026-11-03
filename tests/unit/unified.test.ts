import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/lib/db";
import type { Settings } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { createMeal } from "@/lib/services/meals";
import { getSettings, setGoals, updateSettings } from "@/lib/services/settings";
import { createWeight } from "@/lib/services/weights";
import {
  createWorkout,
  createWorkoutSchema,
  exerciseDetail,
  finishWorkout,
  getWorkout,
  listWorkouts,
  saveTemplate,
  saveWorkout,
  templateFromWorkout,
  templateInputSchema,
  trainingOverview,
  trainingRecords,
  workoutDocSchema,
  type WorkoutDoc,
} from "@/lib/services/training";
import { importLiftlog } from "@/lib/services/liftlog-import";
import { createRun, dayOffSchema, runInputSchema, runningOverview, setDayOff } from "@/lib/services/running";
import { authenticateIngest, connectionInputSchema, createConnection, healthOverview, ingestHealth, revokeConnection, saveManualHealth } from "@/lib/services/health";
import { ensureDefaults } from "@/lib/services/defaults";
import { applyRoutineTemplate, getRoutineDay, logActivity, routineStats, saveJournal, saveRoutineTemplate, journalInputSchema, createActivity, activityInputSchema } from "@/lib/services/routines";
import { createGoal, goalInputSchema, goalsWithProgress, saveCheckin, updateGoal } from "@/lib/services/goals";
import { addWater } from "@/lib/services/water";
import { todayOverview } from "@/lib/services/today";
import { computeInsights } from "@/lib/services/insights";
import { createMealSchema } from "@/lib/validation";
import { addDays } from "@/lib/time";

let db: Db;
let s: Settings;
const TODAY = "2026-11-02"; // Monday

beforeEach(async () => {
  db = await createMemoryDb();
  s = await updateSettings(db, { timezone: "America/New_York", weightUnit: "lb", weekStartsOn: 1, onboarded: true });
});

let seq = 0;
const id = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

function doc(over: Partial<WorkoutDoc> & { sets?: { w: number; r: number; done?: boolean }[]; exerciseId?: string } = {}): WorkoutDoc {
  const { sets = [{ w: 100, r: 5 }], exerciseId = "bi-barbell-bench-press", ...rest } = over;
  return workoutDocSchema.parse({
    name: "Push",
    localDate: TODAY,
    unit: "kg",
    exercises: [{ id: id("we"), exerciseId, sets: sets.map((x, i) => ({ id: id("s"), setNumber: i + 1, weightKg: x.w, reps: x.r, completed: x.done ?? true })) }],
    ...rest,
  });
}

async function logWorkout(date: string, sets: { w: number; r: number; done?: boolean }[], exerciseId = "bi-barbell-bench-press") {
  const { workout } = await createWorkout(db, createWorkoutSchema.parse({ localDate: date }), s, TODAY);
  await saveWorkout(db, workout.id, doc({ localDate: date, sets, exerciseId }), TODAY);
  await finishWorkout(db, workout.id, "discard");
  return workout.id;
}

describe("training (merged LiftLog)", () => {
  it("logs a workout without any time fields and derives records", async () => {
    const w1 = await logWorkout("2026-10-26", [{ w: 100, r: 5 }, { w: 100, r: 5 }]);
    const w2 = await logWorkout("2026-11-02", [{ w: 105, r: 5 }, { w: 90, r: 3, done: false }]);
    const detail = await getWorkout(db, w2, s);
    expect(detail.exercises[0].sets).toHaveLength(1); // unticked set discarded on finish
    expect(detail.exercises[0].previous?.workoutId).toBe(w1);
    expect(detail.records.map((r) => r.type)).toEqual(expect.arrayContaining(["weight", "e1rm"]));
    expect(Object.keys(detail)).not.toContain("startedAt");
    expect(Object.keys(detail)).not.toContain("endedAt");
    const list = await listWorkouts(db, s);
    expect(list.map((x) => x.id)).toEqual([w2, w1]);
    expect(list[0].volumeKg).toBe(525);
    const ex = await exerciseDetail(db, "bi-barbell-bench-press", s, TODAY);
    expect(ex.stats.sessionCount).toBe(2);
    expect(ex.history[0].workoutId).toBe(w2);
    const rec = await trainingRecords(db, s, null);
    expect(rec.bests[0].allTime?.heaviestKg).toBe(105);
  });

  it("allows only one workout in progress and is idempotent per request id", async () => {
    const a = await createWorkout(db, createWorkoutSchema.parse({ clientRequestId: "req-12345678" }), s, TODAY);
    const again = await createWorkout(db, createWorkoutSchema.parse({ clientRequestId: "req-12345678" }), s, TODAY);
    expect(again.workout.id).toBe(a.workout.id);
    expect(again.created).toBe(false);
    await expect(createWorkout(db, createWorkoutSchema.parse({}), s, TODAY)).rejects.toMatchObject({ code: "workout_in_progress" });
  });

  it("builds templates from workouts and starts workouts from templates", async () => {
    const w = await logWorkout("2026-10-30", [{ w: 60, r: 8 }, { w: 70, r: 6 }]);
    const t = await templateFromWorkout(db, w);
    expect(t.items[0]).toMatchObject({ exerciseId: "bi-barbell-bench-press", targetSets: 2, targetWeightKg: 70, targetReps: 6 });
    const { workout } = await createWorkout(db, createWorkoutSchema.parse({ templateId: t.id }), s, TODAY);
    const d = await getWorkout(db, workout.id, s);
    expect(d.exercises[0].sets).toHaveLength(2);
    expect(d.exercises[0].sets[0].targetWeightKg).toBe(70);
    await expect(saveTemplate(db, templateInputSchema.parse({ name: "Bad", items: [{ exerciseId: "nope", targetSets: 3 }] }))).rejects.toBeInstanceOf(AppError);
  });

  it("overview reports week totals and a week streak", async () => {
    await logWorkout("2026-10-20", [{ w: 80, r: 5 }]);
    await logWorkout("2026-10-27", [{ w: 82, r: 5 }]);
    await logWorkout("2026-11-02", [{ w: 85, r: 5 }]);
    const o = await trainingOverview(db, s, TODAY);
    expect(o.week.thisWeek.workouts).toBe(1);
    expect(o.streak.currentWeeks).toBe(3);
    expect(o.totals.workouts).toBe(3);
  });
});

function liftlogBackup(over: { updatedAt?: string; reps?: number } = {}) {
  const t = "2026-09-01T10:00:00.000Z";
  return {
    format: "liftlog-backup",
    version: 1,
    exportedAt: "2026-10-01T00:00:00.000Z",
    data: {
      exercises: [
        { id: "bi-barbell-back-squat", name: "Barbell Back Squat", primaryMuscle: "quads", secondaryMuscles: ["glutes"], equipment: "barbell", category: "compound", instructions: "", isCustom: false, isFavorite: true, archived: false, createdAt: t, updatedAt: "2026-09-05T10:00:00.000Z" },
        { id: "cx-landmine", name: "Landmine Press", primaryMuscle: "shoulders", secondaryMuscles: [], equipment: "barbell", category: "compound", instructions: "", isCustom: true, isFavorite: false, archived: false, createdAt: t, updatedAt: t },
      ],
      workouts: [
        { id: "w-ll-1", name: "Leg day", status: "completed", startedAt: "2026-09-10T22:30:00.000Z", endedAt: "2026-09-10T23:40:00.000Z", notes: "felt good", templateId: null, unit: "lb", celebratedRecordKeys: [], createdAt: t, updatedAt: over.updatedAt ?? "2026-09-10T23:40:00.000Z" },
        { id: "w-ll-2", name: "Press", status: "completed", startedAt: "2026-09-12T15:00:00.000Z", endedAt: null, notes: "", templateId: null, unit: "lb", celebratedRecordKeys: [], createdAt: t, updatedAt: "2026-09-12T16:00:00.000Z" },
      ],
      workoutExercises: [
        { id: "we-ll-1", workoutId: "w-ll-1", exerciseId: "bi-barbell-back-squat", position: 0, notes: "", restSeconds: 180 },
        { id: "we-ll-2", workoutId: "w-ll-2", exerciseId: "cx-landmine", position: 0, notes: "", restSeconds: null },
        { id: "we-orphan", workoutId: "w-missing", exerciseId: "cx-landmine", position: 0, notes: "", restSeconds: null },
      ],
      sets: [
        { id: "s-ll-1", workoutId: "w-ll-1", workoutExerciseId: "we-ll-1", exerciseId: "bi-barbell-back-squat", position: 0, setNumber: 1, manualSetNumber: false, weightKg: 100, reps: over.reps ?? 5, rpe: 8, notes: "", kind: "working", completed: true, completedAt: "2026-09-10T22:40:00.000Z", targetWeightKg: null, targetReps: null, createdAt: t, updatedAt: t },
        { id: "s-ll-2", workoutId: "w-ll-1", workoutExerciseId: "we-ll-1", exerciseId: "bi-barbell-back-squat", position: 1, setNumber: 2, manualSetNumber: false, weightKg: 60, reps: 5, rpe: null, notes: "", kind: "warmup", completed: true, completedAt: null, targetWeightKg: null, targetReps: null, createdAt: t, updatedAt: t },
        { id: "s-ll-3", workoutId: "w-ll-2", workoutExerciseId: "we-ll-2", exerciseId: "cx-landmine", position: 0, setNumber: 1, manualSetNumber: false, weightKg: 30, reps: 10, rpe: null, notes: "", kind: "working", completed: true, completedAt: null, targetWeightKg: null, targetReps: null, createdAt: t, updatedAt: t },
      ],
      templates: [{ id: "t-ll-1", name: "Legs", notes: "", items: [{ id: "ti-1", exerciseId: "bi-barbell-back-squat", targetSets: 3, targetReps: 5, targetWeightKg: 100, restSeconds: 180, notes: "" }], lastUsedAt: null, createdAt: t, updatedAt: t }],
      settings: { id: "settings", unit: "lb", theme: "dark", weekStartsOn: 1, oneRmFormula: "brzycki", maxRepsFor1RM: 10, defaultRestSeconds: 120, autoStartRest: true, restSound: true, restVibrate: true, weightStepKg: 2.5, weightStepLb: 5, weeklyTarget: 4, showRpe: true, createdAt: t, updatedAt: t },
    },
  };
}

describe("LiftLog import", () => {
  it("imports history, drops time features, and never duplicates on re-import", async () => {
    const first = await importLiftlog(db, liftlogBackup(), s, TODAY);
    expect(first).toMatchObject({ workoutsAdded: 2, sets: 3, exercisesAdded: 1, templatesAdded: 1, skippedOrphans: 1, weeklyGoalCreated: true });
    expect(first.notes.join(" ")).toMatch(/durations and rest timers/);
    const list = await listWorkouts(db, await getSettings(db));
    // 22:30 UTC on Sep 10 is 18:30 in New York → Sep 10.
    expect(list.find((w) => w.id === "w-ll-1")?.localDate).toBe("2026-09-10");
    const second = await importLiftlog(db, liftlogBackup(), s, TODAY);
    expect(second).toMatchObject({ workoutsAdded: 0, workoutsUpdated: 0, workoutsUnchanged: 2, exercisesAdded: 0, templatesAdded: 0, weeklyGoalCreated: false });
    expect((await listWorkouts(db, s)).length).toBe(2);
    const s2 = await getSettings(db);
    expect(s2.oneRmFormula).toBe("brzycki");
    expect(s2.showRpe).toBe(true);
    const goals = await goalsWithProgress(db, s2, TODAY, { includeLinked: false });
    expect(goals.find((g) => g.metric === "workouts")?.targetValue).toBe(4);
  });

  it("updates workouts edited later in LiftLog, but not ones edited here since", async () => {
    await importLiftlog(db, liftlogBackup(), s, TODAY);
    const newer = await importLiftlog(db, liftlogBackup({ updatedAt: "2026-09-20T00:00:00.000Z", reps: 7 }), s, TODAY);
    expect(newer.workoutsUpdated).toBe(1);
    const d = await getWorkout(db, "w-ll-1", s);
    expect(d.exercises[0].sets.find((x) => x.id === "s-ll-1")?.reps).toBe(7);
    // Edit here, then re-import an older copy: the edit wins.
    await saveWorkout(db, "w-ll-1", { ...doc({ localDate: "2026-09-10", sets: [{ w: 120, r: 3 }] }), name: "Edited here" }, TODAY);
    const older = await importLiftlog(db, liftlogBackup({ updatedAt: "2026-09-25T00:00:00.000Z" }), s, TODAY);
    expect(older.workoutsUpdated).toBe(0);
    expect((await getWorkout(db, "w-ll-1", s)).name).toBe("Edited here");
  });

  it("rejects files that aren't LiftLog backups", async () => {
    await expect(importLiftlog(db, { app: "diet-tracker" }, s, TODAY)).rejects.toBeInstanceOf(AppError);
  });
});

describe("running", () => {
  it("tracks streaks with rest days excused and replaces a rest marker when you run", async () => {
    const run = (localDate: string, value: number | null = 3) => createRun(db, runInputSchema.parse({ localDate, distance: value == null ? null : { value, unit: "mi" } }), TODAY);
    await run("2026-10-29");
    await setDayOff(db, dayOffSchema.parse({ localDate: "2026-10-30", kind: "recovery" }));
    await run("2026-10-31", null); // completed without distance
    await run("2026-11-01", 2);
    const o = await runningOverview(db, { start: "2026-10-27", end: TODAY }, s, TODAY);
    expect(o.streaks.current).toBe(3);
    expect(o.days.find((d) => d.date === "2026-10-30")?.status).toBe("recovery");
    expect(o.days.find((d) => d.date === TODAY)?.status).toBe("pending");
    expect(o.consistency.pct).toBe(1);
    expect(o.totals.distanceM).toBeCloseTo(5 * 1609.344, 3);
    await expect(setDayOff(db, dayOffSchema.parse({ localDate: "2026-11-01", kind: "rest" }))).rejects.toMatchObject({ code: "run_logged" });
    await setDayOff(db, dayOffSchema.parse({ localDate: TODAY, kind: "rest" }));
    await run(TODAY);
    const after = await runningOverview(db, { start: TODAY, end: TODAY }, s, TODAY);
    expect(after.days[0].status).toBe("done");
    expect(after.entries.filter((e) => e.kind !== "run")).toHaveLength(0);
  });

  it("is idempotent per client request id", async () => {
    const input = runInputSchema.parse({ clientRequestId: "run-req-0001", localDate: TODAY, distance: { value: 5, unit: "km" } });
    const a = await createRun(db, input, TODAY);
    const b = await createRun(db, input, TODAY);
    expect(b.run.id).toBe(a.run.id);
    expect(b.created).toBe(false);
  });
});

describe("phone health ingest", () => {
  it("accepts the app's JSON, merges overlapping sleep samples, and never invents a sleep score", async () => {
    const { connection, token } = await createConnection(db, connectionInputSchema.parse({ name: "iPhone", platform: "ios_shortcut", scopes: ["steps", "sleep", "sleep_score"] }));
    const conn = await authenticateIngest(db, `Bearer ${token}`);
    const payload = {
      steps: [{ date: "2026-11-01", value: "8,120" }],
      days: [{ date: "2026-11-02", steps: 1500, sleepScore: 81 }],
      sleepSamples: [
        { start: "2026-11-01T23:00:00-05:00", end: "2026-11-02T06:30:00-05:00", stage: "In Bed", source: "iPhone" },
        { start: "2026-11-01T23:20:00-05:00", end: "2026-11-02T01:00:00-05:00", stage: "Asleep Core", source: "Apple Watch" },
        { start: "2026-11-02T01:00:00-05:00", end: "2026-11-02T02:00:00-05:00", stage: "Asleep Deep", source: "Apple Watch" },
        { start: "2026-11-02T02:00:00-05:00", end: "2026-11-02T06:00:00-05:00", stage: "Asleep REM", source: "Apple Watch" },
        { start: "2026-11-01T23:30:00-05:00", end: "2026-11-02T05:30:00-05:00", stage: "Asleep", source: "Third-party app" },
      ],
    };
    const r = await ingestHealth(db, conn, payload, s, TODAY);
    expect(r.byMetric).toMatchObject({ steps: 2, sleep: 1 });
    expect(r.ignored.some((i) => /provider/.test(i.reason))).toBe(true); // bare score rejected
    const o = await healthOverview(db, { start: "2026-11-01", end: TODAY }, s);
    const sleepDay = o.metrics.sleep.days.find((d) => d.date === TODAY)!;
    expect(sleepDay.value).toBe(400); // union 23:20–06:00, overlap not double counted
    expect((sleepDay as { details: { stages: { deep: number } } }).details.stages.deep).toBe(60);
    expect(o.metrics.steps.days.find((d) => d.date === "2026-11-01")?.value).toBe(8120);
    // A later sync for the same day replaces (no duplicates).
    await ingestHealth(db, conn, { steps: [{ date: TODAY, value: 4000 }] }, s, TODAY);
    const o2 = await healthOverview(db, { start: TODAY, end: TODAY }, s);
    expect(o2.metrics.steps.days[0].value).toBe(4000);
    expect(o2.metrics.steps.loggedDays).toBe(1);
    // A score with a named provider is stored with its source.
    await ingestHealth(db, conn, { days: [{ date: TODAY, sleepScore: { value: 84, provider: "Oura" } }] }, s, TODAY);
    const o3 = await healthOverview(db, { start: TODAY, end: TODAY }, s);
    expect(o3.metrics.sleep_score.days[0]).toMatchObject({ value: 84, origin: "Oura" });
    await revokeConnection(db, connection.id);
    await expect(authenticateIngest(db, `Bearer ${token}`)).rejects.toMatchObject({ code: "revoked_token" });
  });

  it("parses Health Auto Export payloads and enforces connection scopes", async () => {
    const { token } = await createConnection(db, connectionInputSchema.parse({ name: "HAE", platform: "health_auto_export", scopes: ["steps", "sleep"] }));
    const conn = await authenticateIngest(db, `Bearer ${token}`);
    const payload = {
      data: {
        metrics: [
          { name: "step_count", units: "count", data: [{ qty: 4000, date: "2026-11-01 08:00:00 -0500", source: "iPhone" }, { qty: 3000, date: "2026-11-01 17:00:00 -0500", source: "iPhone" }] },
          { name: "sleep_analysis", units: "hr", data: [{ date: "2026-11-02 00:00:00 -0500", totalSleep: 7.5, core: 4, deep: 1.25, rem: 2.25, awake: 0.25, inBed: 8, sleepStart: "2026-11-01 22:45:00 -0500", sleepEnd: "2026-11-02 06:45:00 -0500", source: "Apple Watch" }] },
          { name: "resting_heart_rate", units: "count/min", data: [{ qty: 52, date: "2026-11-02 00:00:00 -0500" }] },
          { name: "walking_speed", units: "mi/hr", data: [] },
        ],
      },
    };
    const r = await ingestHealth(db, conn, payload, s, TODAY);
    expect(r.format).toBe("health_auto_export");
    expect(r.byMetric).toMatchObject({ steps: 1, sleep: 1 });
    expect(r.ignored.some((i) => /not allowed/.test(i.reason))).toBe(true); // resting HR not in scope
    const o = await healthOverview(db, { start: "2026-11-01", end: TODAY }, s);
    expect(o.metrics.steps.days[0].value).toBe(7000);
    expect(o.metrics.sleep.days[1].value).toBe(450);
    expect(o.metrics.resting_hr.loggedDays).toBe(0);
  });

  it("stores manual entries separately and rejects implausible values", async () => {
    await saveManualHealth(db, { localDate: TODAY, metric: "steps", value: 9000 }, TODAY);
    await expect(saveManualHealth(db, { localDate: TODAY, metric: "sleep", value: 5000 }, TODAY)).rejects.toBeInstanceOf(AppError);
    const o = await healthOverview(db, { start: TODAY, end: TODAY }, s);
    expect(o.metrics.steps.days[0]).toMatchObject({ value: 9000, source: "manual" });
  });
});

describe("routines and journal", () => {
  it("seeds editable defaults once and tracks completion against that day's activities", async () => {
    expect(await ensureDefaults(db, { ...s, onboarded: false }, TODAY)).toBe(false); // waits for onboarding
    expect(await ensureDefaults(db, s, TODAY)).toBe(true);
    expect(await ensureDefaults(db, await getSettings(db), TODAY)).toBe(false);
    const morning = await getRoutineDay(db, "morning", TODAY);
    expect(morning.activities.map((a) => a.kind)).toEqual(["mobility", "reading", "journal"]);
    expect(morning.activities[0].mobility?.items.length).toBeGreaterThan(0);
    const night = await getRoutineDay(db, "night", TODAY);
    expect(night.activities[2].config.prompts?.map((p) => p.text)).toContain("What went well today?");
    const [mob, reading] = morning.activities;
    await logActivity(db, { localDate: TODAY, activityId: mob.id, completed: true }, TODAY);
    await logActivity(db, { localDate: TODAY, activityId: reading.id, completed: false, value: 12, details: { title: "Meditations" } }, TODAY);
    // Journaling ticks off the journal activity automatically.
    await saveJournal(db, journalInputSchema.parse({ localDate: TODAY, slot: "morning", answers: [{ promptId: "p", prompt: "Q", answer: "Grateful for coffee" }] }), TODAY);
    const after = await getRoutineDay(db, "morning", TODAY);
    expect(after.progress).toMatchObject({ required: 3, done: 3, complete: true });
    expect((await getRoutineDay(db, "night", TODAY)).progress.done).toBe(0);
  });

  it("keeps history when the routine changes or a template is applied", async () => {
    await ensureDefaults(db, s, "2026-10-30");
    const day = await getRoutineDay(db, "night", "2026-10-30");
    for (const a of day.activities) await logActivity(db, { localDate: "2026-10-30", activityId: a.id, completed: true }, TODAY);
    const t = await saveRoutineTemplate(db, "night", "Standard night");
    await createActivity(db, "night", activityInputSchema.parse({ title: "Lay out clothes", kind: "checklist" }), TODAY);
    await applyRoutineTemplate(db, t.id, TODAY);
    const stats = await routineStats(db, { start: "2026-10-30", end: TODAY }, 1, TODAY);
    expect(stats.days.find((d) => d.date === "2026-10-30")?.night.complete).toBe(true);
    expect((await getRoutineDay(db, "night", TODAY)).activities).toHaveLength(3);
  });
});

describe("goals", () => {
  it("updates automatically from meals, workouts, runs and water; linked nutrition targets appear", async () => {
    await setGoals(db, { calories: 2200, protein: 150 }, TODAY);
    const mk = async (input: Record<string, unknown>) => createGoal(db, goalInputSchema.parse({ startDate: "2026-10-27", ...input }), TODAY);
    await mk({ title: "Protein 5 days a week", metric: "nutrient", params: { nutrient: "protein", agg: "count", dailyThreshold: 100 }, comparator: "at_least", targetValue: 5, period: "weekly" });
    await mk({ title: "Train 3x", metric: "workouts", comparator: "at_least", targetValue: 3, period: "weekly" });
    await mk({ title: "Bench 100x5", metric: "exercise_weight_reps", params: { exerciseId: "bi-barbell-bench-press", reps: 5 }, comparator: "at_least", targetValue: 100, period: "daily" });
    await mk({ title: "Water", metric: "water", comparator: "at_least", targetValue: 2000, period: "daily" });
    await mk({ title: "Run 10 km a week", metric: "run_distance", comparator: "at_least", targetValue: 10_000, period: "weekly" });
    const before = await goalsWithProgress(db, s, TODAY);
    expect(before.find((g) => g.id === "nutrition:calories")?.comparator).toBe("range");
    expect(before.find((g) => g.title === "Train 3x")?.current?.value).toBe(0);

    await createMeal(db, createMealSchema.parse({ eatenAt: "2026-11-02T13:00:00Z", category: "Lunch", title: "Chicken", source: "manual", items: [{ name: "Chicken", quantity: 1, unit: "g", gramsPerUnit: 400, nutrientsPer100g: { calories: 165, protein: 31 }, nutrientSource: "database", quantitySource: "manual" }] }), s);
    await logWorkout(TODAY, [{ w: 100, r: 5 }]);
    await addWater(db, { value: 2100, unit: "ml", localDate: TODAY }, s, TODAY);
    await createRun(db, runInputSchema.parse({ localDate: TODAY, distance: { value: 6, unit: "km" } }), TODAY);

    const after = await goalsWithProgress(db, s, TODAY);
    const g = (t: string) => after.find((x) => x.title === t)!;
    expect(after.find((x) => x.id === "nutrition:protein")?.current).toMatchObject({ value: 124, status: "in_progress" });
    expect(g("Protein 5 days a week").current?.value).toBe(1);
    expect(g("Train 3x").current?.value).toBe(1);
    expect(g("Bench 100x5").current?.status).toBe("met");
    expect(g("Water").current?.status).toBe("met");
    expect(g("Run 10 km a week").current?.value).toBe(6000);
    expect(g("Run 10 km a week").current?.projected).toBeGreaterThan(6000);
  });

  it("excuses rest days and paused spans; target changes don't rewrite history", async () => {
    const goal = await createGoal(db, goalInputSchema.parse({ title: "Run daily", metric: "run_completed", comparator: "at_least", targetValue: 1, period: "daily", startDate: "2026-10-27" }), TODAY);
    for (const d of ["2026-10-27", "2026-10-28", "2026-10-30", "2026-10-31"]) await createRun(db, runInputSchema.parse({ localDate: d }), TODAY);
    await setDayOff(db, dayOffSchema.parse({ localDate: "2026-10-29", kind: "rest" }));
    let [v] = await goalsWithProgress(db, s, TODAY, { onlyId: goal.id, full: true, includeLinked: false });
    expect(v.recent.find((p) => p.start === "2026-10-29")?.status).toBe("excused");
    expect(v.recent.find((p) => p.start === "2026-11-01")?.status).toBe("missed");
    expect(v.streak.current).toBe(0);
    expect(v.streak.best).toBe(4);
    expect(v.current?.status).toBe("in_progress");

    const steps = await createGoal(db, goalInputSchema.parse({ title: "Steps", metric: "steps", comparator: "at_least", targetValue: 8000, period: "daily", startDate: "2026-10-31" }), TODAY);
    await saveManualHealth(db, { localDate: "2026-10-31", metric: "steps", value: 9000 }, TODAY);
    await saveManualHealth(db, { localDate: "2026-11-01", metric: "steps", value: 9000 }, TODAY);
    await updateGoal(db, steps.id, { targetValue: 10_000 }, TODAY);
    [v] = await goalsWithProgress(db, s, TODAY, { onlyId: steps.id, full: true, includeLinked: false });
    expect(v.recent.filter((p) => p.status === "met").map((p) => p.start)).toEqual(["2026-10-31", "2026-11-01"]);
    expect(v.current?.target).toBe(10_000);

    await updateGoal(db, goal.id, { status: "paused" }, "2026-11-01");
    [v] = await goalsWithProgress(db, s, TODAY, { onlyId: goal.id, full: true, includeLinked: false });
    expect(v.recent.find((p) => p.start === "2026-11-01")?.status).toBe("paused");
    expect(v.streak.current).toBe(4); // paused days are skipped, not failed
  });

  it("supports custom goals with manual check-ins", async () => {
    const g = await createGoal(db, goalInputSchema.parse({ title: "Meditate", metric: "custom", params: { unitLabel: "sessions" }, comparator: "at_least", targetValue: 1, period: "daily", startDate: addDays(TODAY, -1) }), TODAY);
    await saveCheckin(db, g.id, { localDate: TODAY, value: 1, note: null }, TODAY);
    const [v] = await goalsWithProgress(db, s, TODAY, { onlyId: g.id, full: true, includeLinked: false });
    expect(v.current?.status).toBe("met");
    expect(v.recent[0].status).toBe("missed");
  });
});

describe("today and insights", () => {
  it("combines every domain into one day with a chronological timeline", async () => {
    await createWeight(db, { value: 180, unit: "lb", period: "morning", measuredAt: new Date("2026-11-02T12:00:00Z") }, s);
    await createMeal(db, createMealSchema.parse({ eatenAt: "2026-11-02T13:00:00Z", category: "Breakfast", title: "Oats", source: "manual", items: [{ name: "Oats", quantity: 1, unit: "g", gramsPerUnit: 80, nutrientsPer100g: { calories: 380, protein: 13 }, nutrientSource: "database", quantitySource: "manual" }] }), s);
    await createRun(db, runInputSchema.parse({ localDate: TODAY, distance: { value: 3, unit: "mi" } }), TODAY);
    await saveManualHealth(db, { localDate: TODAY, metric: "sleep", value: 455 }, TODAY);
    const t = await todayOverview(db, await getSettings(db), TODAY, TODAY);
    expect(t.nutrition.totals.values.calories).toBeCloseTo(304, 6);
    expect(t.running.status?.status).toBe("done");
    expect(t.health.sleep?.value).toBe(455);
    expect(t.routines.morning.activities.length).toBe(3);
    expect(t.goals.some((g) => g.metric === "run_completed")).toBe(true);
    expect(t.timeline.map((x) => x.kind)).toEqual(expect.arrayContaining(["weight", "meal", "run"]));
    const sorted = [...t.timeline].sort((a, b) => a.at.localeCompare(b.at));
    expect(t.timeline).toEqual(sorted);
  });

  it("produces labeled insights and summaries without inventing data", async () => {
    const res = await computeInsights(db, s, TODAY, 30);
    expect(res.summaries.weekly.running.runDays).toBe(0);
    expect(res.insights.every((i) => ["measured", "estimate", "observation"].includes(i.kind))).toBe(true);
    for (let i = 0; i < 12; i++) await createRun(db, runInputSchema.parse({ localDate: addDays(TODAY, -i), effort: 9 }), TODAY);
    const res2 = await computeInsights(db, s, TODAY, 30);
    expect(res2.insights.some((i) => i.id === "recovery" && i.tone === "caution")).toBe(true);
    expect(res2.insights[0].tone).toBe("caution");
  });
});

describe("backup", () => {
  it("round-trips every domain through a v2 backup and still restores v1 diet backups", async () => {
    const { fullBackup, restoreBackup } = await import("@/lib/services/export");
    await ensureDefaults(db, s, TODAY);
    await logWorkout(TODAY, [{ w: 100, r: 5 }]);
    await createRun(db, runInputSchema.parse({ localDate: TODAY, distance: { value: 4, unit: "km" } }), TODAY);
    await saveManualHealth(db, { localDate: TODAY, metric: "steps", value: 7000 }, TODAY);
    await saveJournal(db, journalInputSchema.parse({ localDate: TODAY, slot: "night", body: "Good day" }), TODAY);
    const backup = JSON.parse(JSON.stringify(await fullBackup(db, { includeImages: false })));
    expect(backup.version).toBe(2);
    const fresh = await createMemoryDb();
    const res = await restoreBackup(fresh, backup);
    expect(res).toMatchObject({ workouts: 1, runs: 1 });
    const fs = await getSettings(fresh);
    expect((await listWorkouts(fresh, fs)).length).toBe(1);
    expect((await healthOverview(fresh, { start: TODAY, end: TODAY }, fs)).metrics.steps.days[0].value).toBe(7000);
    expect((await getRoutineDay(fresh, "night", TODAY)).journal?.body).toBe("Good day");
    expect((await goalsWithProgress(fresh, fs, TODAY, { includeLinked: false })).length).toBeGreaterThanOrEqual(4);
    // A v1 (diet-only) backup replaces diet data but leaves training data alone.
    const v1 = { ...backup, version: 1 };
    for (const k of ["exercises", "workouts", "workoutExercises", "workoutSets", "workoutTemplates", "runEntries"]) delete v1[k];
    await restoreBackup(fresh, v1);
    expect((await listWorkouts(fresh, fs)).length).toBe(1);
  });
});

describe("assistant tools across areas", () => {
  it("returns grounded summaries for training, running, health, routines, goals and insights", async () => {
    const { runAssistantTool } = await import("@/lib/ai/assistant-tools");
    await ensureDefaults(db, s, TODAY);
    await logWorkout("2026-10-30", [{ w: 100, r: 5 }]);
    await createRun(db, runInputSchema.parse({ localDate: TODAY, distance: { value: 3, unit: "mi" } }), TODAY);
    await saveManualHealth(db, { localDate: TODAY, metric: "sleep", value: 420 }, TODAY);
    const ctx = { db, settings: await getSettings(db), today: TODAY, conversationId: null };
    const range = { start_date: "2026-10-27", end_date: TODAY };
    const training = (await runAssistantTool(ctx, "get_training_summary", range)) as { totals: { workouts: number } };
    expect(training.totals.workouts).toBe(1);
    const ex = (await runAssistantTool(ctx, "get_exercise_history", { exercise_name: "bench" })) as { exercise: string; sessions: number };
    expect(ex).toMatchObject({ exercise: "Barbell Bench Press", sessions: 1 });
    const run = (await runAssistantTool(ctx, "get_running_summary", range)) as { totals: { distance: number } };
    expect(run.totals.distance).toBe(3);
    const health = (await runAssistantTool(ctx, "get_health_summary", range)) as { sleep: { average: number }; sleep_score: string };
    expect(health.sleep.average).toBe(7);
    expect(health.sleep_score).toMatch(/no sleep score/);
    const routines = (await runAssistantTool(ctx, "get_routines_summary", range)) as { morning: { activities: unknown[] } };
    expect(routines.morning.activities.length).toBe(3);
    const goals = (await runAssistantTool(ctx, "get_goals_progress", {})) as { goal: string }[];
    expect(goals.some((g) => g.goal === "Run every day")).toBe(true);
    const insights = (await runAssistantTool(ctx, "get_insights", { days: 30 })) as { summaries: unknown };
    expect(insights.summaries).toBeTruthy();
  });
});

describe("partial updates", () => {
  it("PATCH schemas never inject defaults, and a bare routine tick keeps logged amounts", async () => {
    const { exercisePatchSchema, updateExercise, listExercises } = await import("@/lib/services/training");
    const { activityPatchSchema, updateActivity } = await import("@/lib/services/routines");
    const { goalPatchSchema } = await import("@/lib/services/goals");
    expect(exercisePatchSchema.parse({ isFavorite: true })).toEqual({ isFavorite: true });
    expect(activityPatchSchema.parse({ title: "Read" })).toEqual({ title: "Read" });
    expect(goalPatchSchema.parse({ status: "paused" })).toEqual({ status: "paused" });

    await listExercises(db);
    const fav = await updateExercise(db, "bi-barbell-bench-press", exercisePatchSchema.parse({ isFavorite: true }));
    expect(fav.secondaryMuscles.length).toBeGreaterThan(0);
    expect(fav.instructions).not.toBe("");

    await ensureDefaults(db, s, TODAY);
    const day = await getRoutineDay(db, "morning", TODAY);
    const reading = day.activities.find((a) => a.kind === "reading")!;
    const edited = await updateActivity(db, reading.id, activityPatchSchema.parse({ title: "Read a book" }));
    expect(edited.targetValue).toBe(10);
    await logActivity(db, { localDate: TODAY, activityId: reading.id, completed: false, value: 6, details: { title: "Dune" } }, TODAY);
    const ticked = await logActivity(db, { localDate: TODAY, activityId: reading.id, completed: true }, TODAY);
    expect(ticked).toMatchObject({ completed: true, value: 6, details: { title: "Dune" } });

    const g = await createGoal(db, goalInputSchema.parse({ title: "Steps", metric: "steps", comparator: "at_least", targetValue: 8000, period: "daily", notes: "keep", showOnDashboard: false }), TODAY);
    const paused = await updateGoal(db, g.id, goalPatchSchema.parse({ status: "paused" }), TODAY);
    expect(paused).toMatchObject({ notes: "keep", showOnDashboard: false, targetHistory: g.targetHistory, status: "paused" });
  });
});

describe("linked goals and reach-goal progress", () => {
  it("keeps nutrition history across target changes and measures progress from the starting level", async () => {
    await createMeal(db, createMealSchema.parse({ eatenAt: "2026-10-20T13:00:00Z", category: "Lunch", title: "Rice", source: "manual", items: [{ name: "Rice", quantity: 1, unit: "g", gramsPerUnit: 300, nutrientsPer100g: { calories: 130, protein: 2.7 }, nutrientSource: "database", quantitySource: "manual" }] }), s);
    await setGoals(db, { calories: 2200, protein: 150 }, "2026-10-01");
    await setGoals(db, { calories: 2000, protein: 160 }, TODAY);
    const linked = (await goalsWithProgress(db, s, TODAY)).find((g) => g.id === "nutrition:protein")!;
    expect(linked.startDate).toBe("2026-10-20");
    expect(linked.targetHistory.map((v) => v.value)).toEqual([150, 160]);

    // Target weight: progress is measured from the first 7-day average toward the target.
    const s2 = await updateSettings(db, { startingWeight: { value: 200, unit: "lb", date: "2026-10-25" }, targetWeight: { value: 190, unit: "lb" } });
    for (const [d, lb] of [["2026-10-25", 200], ["2026-10-26", 200], ["2026-10-27", 200], ["2026-11-01", 195], ["2026-11-02", 195]] as const) {
      await createWeight(db, { value: lb, unit: "lb", period: "morning", localDate: d, measuredAt: new Date(`${d}T12:00:00Z`) }, s2);
    }
    const tw = (await goalsWithProgress(db, s2, TODAY)).find((g) => g.id === "body:target_weight")!;
    expect(tw.progress).toBeGreaterThan(0.2);
    expect(tw.progress).toBeLessThan(0.6);
  });
});
