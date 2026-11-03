/**
 * Demo data for the unified tracker areas: workouts with progressive overload,
 * daily runs with planned rest days, synced steps & sleep, routine check-offs,
 * journal entries, water and a set of goals. Used by scripts/seed-demo.ts only;
 * it writes to whatever database it is given, so never call it on real data.
 */
import type { Db } from "../src/lib/db";
import type { Settings } from "../src/lib/db/schema";
import type { LocalDate } from "../src/lib/time";

export async function seedUnified(db: Db, s: Settings, start: LocalDate, today: LocalDate, rand: () => number): Promise<string> {
  const [{ addDays, dayOfWeek, zonedToInstant }, training, running, health, routines, goals, water, defaults] = await Promise.all([
    import("../src/lib/time"),
    import("../src/lib/services/training"),
    import("../src/lib/services/running"),
    import("../src/lib/services/health"),
    import("../src/lib/services/routines"),
    import("../src/lib/services/goals"),
    import("../src/lib/services/water"),
    import("../src/lib/services/defaults"),
  ]);
  const { randomUUID } = await import("node:crypto");
  const between = (a: number, b: number) => a + rand() * (b - a);
  const lbToKg = (lb: number) => lb * 0.45359237;
  const round5 = (lb: number) => Math.round(lb / 5) * 5;

  await defaults.ensureDefaults(db, s, start);

  // --- Training: push / pull / legs, 3–4 days a week, slow progressive overload.
  type Plan = { name: string; lifts: [exerciseId: string, startLb: number, perWeekLb: number, reps: number, sets: number][] };
  const PLANS: Plan[] = [
    { name: "Push", lifts: [["bi-barbell-bench-press", 175, 2.5, 5, 4], ["bi-overhead-press", 105, 1.25, 6, 3], ["bi-incline-dumbbell-bench-press", 55, 1, 10, 3], ["bi-triceps-pushdown", 50, 1, 12, 3]] },
    { name: "Pull", lifts: [["bi-deadlift", 275, 5, 5, 3], ["bi-barbell-row", 145, 2.5, 8, 3], ["bi-lat-pulldown", 120, 2, 10, 3], ["bi-barbell-curl", 65, 1, 10, 3]] },
    { name: "Legs", lifts: [["bi-barbell-back-squat", 225, 5, 5, 4], ["bi-romanian-deadlift", 185, 2.5, 8, 3], ["bi-leg-press", 270, 5, 10, 3], ["bi-standing-calf-raise", 135, 2.5, 12, 3]] },
  ];
  const known = new Set((await training.listExercises(db)).map((e) => e.id));
  let workouts = 0;
  let planIdx = 0;
  for (let i = 0; i <= 90; i++) {
    const date = addDays(start, i);
    const dow = dayOfWeek(date);
    if (![1, 3, 5].includes(dow) && !(dow === 6 && rand() < 0.4)) continue;
    if (rand() < 0.08) continue; // skipped session
    const plan = PLANS[planIdx++ % PLANS.length];
    const week = i / 7;
    const { workout } = await training.createWorkout(db, { localDate: date, name: plan.name, clientRequestId: `demo-w-${date}` }, s, today);
    const exercises = plan.lifts
      .filter(([id]) => known.has(id))
      .map(([exerciseId, startLb, perWeek, reps, sets]) => {
        // Occasional stall weeks make plateaus and trends realistic.
        const lb = round5(startLb + perWeek * week * (rand() < 0.15 ? 0.6 : 1));
        return {
          id: `we-${randomUUID()}`,
          exerciseId,
          notes: "",
          sets: [
            { id: `s-${randomUUID()}`, setNumber: 1, manualSetNumber: false, weightKg: lbToKg(round5(lb * 0.6)), reps: 8, rpe: null, notes: "", kind: "warmup" as const, completed: true, targetWeightKg: null, targetReps: null },
            ...Array.from({ length: sets }, (_, k) => ({
              id: `s-${randomUUID()}`,
              setNumber: k + 2,
              manualSetNumber: false,
              weightKg: lbToKg(lb),
              reps: Math.max(1, reps - (k === sets - 1 && rand() < 0.4 ? 1 : 0) + (rand() < 0.15 ? 1 : 0)),
              rpe: null,
              notes: "",
              kind: "working" as const,
              completed: true,
              targetWeightKg: null,
              targetReps: null,
            })),
          ],
        };
      });
    if (i === 90) {
      // Today's workout is still in progress.
      await training.saveWorkout(db, workout.id, { name: plan.name, localDate: date, notes: "", unit: "lb", exercises: exercises.slice(0, 2) }, today);
    } else {
      await training.saveWorkout(db, workout.id, { name: plan.name, localDate: date, notes: "", unit: "lb", exercises }, today);
      await training.finishWorkout(db, workout.id, "discard");
    }
    workouts++;
  }
  const tpl = await training.saveTemplate(db, {
    name: "Push day",
    notes: "Bench focus",
    items: PLANS[0].lifts.filter(([id]) => known.has(id)).map(([exerciseId, startLb, , reps, sets]) => ({ exerciseId, targetSets: sets, targetReps: reps, targetWeightKg: lbToKg(startLb + 25), notes: "" })),
  });
  void tpl;

  // --- Running: most days, one planned rest/recovery day a week.
  let runs = 0;
  for (let i = 0; i <= 90; i++) {
    const date = addDays(start, i);
    if (date === today) continue;
    const dow = dayOfWeek(date);
    if (dow === 0) {
      await running.setDayOff(db, { localDate: date, kind: rand() < 0.5 ? "rest" : "recovery", notes: null });
      continue;
    }
    if (rand() < 0.06) continue; // missed
    const type = dow === 6 ? "Long" : rand() < 0.15 ? "Tempo" : rand() < 0.1 ? "Intervals" : "Easy";
    const miles = type === "Long" ? between(5, 7.5) : type === "Easy" ? between(2, 3.8) : between(3, 5);
    await running.createRun(db, { clientRequestId: `demo-r-${date}`, localDate: date, distance: { value: Number(miles.toFixed(2)), unit: "mi" }, runType: type, effort: type === "Easy" ? 3 + Math.floor(rand() * 3) : 6 + Math.floor(rand() * 3), notes: null }, today);
    runs++;
  }

  // --- Phone health via a demo connection (same path as a real phone sync).
  const { connection } = await health.createConnection(db, { name: "Demo iPhone", platform: "ios_shortcut", scopes: ["steps", "sleep", "resting_hr"] });
  const conn = (await health.listConnections(db)).find((c) => c.id === connection.id)!;
  const days: Record<string, unknown>[] = [];
  const sleepSamples: Record<string, unknown>[] = [];
  for (let i = 0; i <= 90; i++) {
    const date = addDays(start, i);
    if (rand() < 0.05) continue; // phone not synced that day
    days.push({ date, steps: Math.round(between(6000, 13500) * (dayOfWeek(date) === 0 ? 0.7 : 1)), restingHeartRate: Math.round(between(52, 59) - i * 0.02) });
    if (rand() < 0.08) continue;
    const bed = zonedToInstant(addDays(date, -1), `${22 + Math.floor(rand() * 2)}:${String(Math.floor(rand() * 59)).padStart(2, "0")}`, s.timezone);
    let t = bed.getTime() + 15 * 60_000;
    const end = t + between(6.2, 8.3) * 3600_000;
    sleepSamples.push({ start: bed.toISOString(), end: new Date(end + 10 * 60_000).toISOString(), stage: "In Bed", source: "Demo iPhone" });
    while (t < end) {
      const stage = rand() < 0.15 ? "Asleep Deep" : rand() < 0.3 ? "Asleep REM" : rand() < 0.07 ? "Awake" : "Asleep Core";
      const len = between(20, 55) * 60_000;
      sleepSamples.push({ start: new Date(t).toISOString(), end: new Date(Math.min(end, t + len)).toISOString(), stage, source: "Demo Watch" });
      t += len;
    }
  }
  await health.ingestHealth(db, { ...conn, tokenHash: "" }, { days, sleepSamples }, s, today);

  // --- Routines and journal.
  let routineLogs = 0;
  let journals = 0;
  for (let i = 0; i <= 90; i++) {
    const date = addDays(start, i);
    for (const slot of ["morning", "night"] as const) {
      if (date === today && slot === "night") continue;
      const day = await routines.getRoutineDay(db, slot, date);
      const p = slot === "morning" ? 0.82 : 0.68;
      for (const a of day.activities) {
        if (rand() > p) continue;
        if (a.kind === "journal") {
          const prompts = a.config.prompts?.filter((x) => x.enabled) ?? [];
          await routines.saveJournal(
            db,
            {
              localDate: date,
              slot,
              body: rand() < 0.5 ? "Felt good today. Kept things simple and consistent." : "",
              answers: prompts.slice(0, 2 + Math.floor(rand() * 2)).map((x) => ({ promptId: x.id, prompt: x.text, answer: slot === "morning" ? "Coffee, a quiet start, and a plan for the day." : "Got my run in and stayed on top of meals." })),
            },
            today,
          );
          journals++;
        } else if (a.kind === "reading") {
          await routines.logActivity(db, { localDate: date, activityId: a.id, completed: false, value: Math.round(between(6, 25)), details: { title: slot === "morning" ? "Atomic Habits" : "The Hobbit" } }, today);
        } else if (a.kind === "mobility") {
          await routines.logActivity(db, { localDate: date, activityId: a.id, completed: true, details: { done: a.mobility?.items.map((x) => x.id) ?? [] } }, today);
        } else {
          await routines.logActivity(db, { localDate: date, activityId: a.id, completed: true }, today);
        }
        routineLogs++;
      }
    }
    if (rand() < 0.7) await water.addWater(db, { value: Math.round(between(48, 100)), unit: "oz", localDate: date }, s, today);
  }

  // --- Goals beyond the defaults.
  const add = (input: Record<string, unknown>) => goals.createGoal(db, goals.goalInputSchema.parse({ startDate: start, ...input }), today);
  await add({ title: "8,000 steps a day", metric: "steps", comparator: "at_least", targetValue: 8000, period: "daily" });
  await add({ title: "Sleep 7.5 hours", metric: "sleep_duration", comparator: "at_least", targetValue: 450, period: "daily" });
  await add({ title: "Lift 3× a week", metric: "workouts", comparator: "at_least", targetValue: 3, period: "weekly" });
  if (known.has("bi-barbell-bench-press")) await add({ title: "Bench 225 × 5", metric: "exercise_weight_reps", params: { exerciseId: "bi-barbell-bench-press", reps: 5 }, comparator: "at_least", targetValue: lbToKg(225), period: "daily" });
  await add({ title: "Run 20 miles a week", metric: "run_distance", comparator: "at_least", targetValue: 20 * 1609.344, period: "weekly" });
  await add({ title: "Journal 5× a week", metric: "journal_days", params: { slot: "any" }, comparator: "at_least", targetValue: 5, period: "weekly" });
  await add({ title: "Drink 80 oz of water", metric: "water", comparator: "at_least", targetValue: 80 * 29.5735295625, period: "daily" });
  await add({ title: "Weigh in every morning", metric: "weigh_ins", params: { weighIn: "morning" }, comparator: "at_least", targetValue: 1, period: "daily" });
  return `${workouts} workouts, ${runs} runs, ${days.length} days of steps, ${routineLogs} routine check-offs, ${journals} journal entries, 8 extra goals`;
}
