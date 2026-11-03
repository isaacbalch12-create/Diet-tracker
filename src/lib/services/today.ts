/**
 * The unified dashboard payload for one day: nutrition, weight, water, training,
 * running, phone health data, routines, goals and a chronological activity log.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { journalEntries, routineActivities, routineLogs, runEntries, waterLogs, workoutSets, workouts, type Settings } from "../db/schema";
import { classifyDays, runStreaks } from "../running/stats";
import { addDays, type LocalDate } from "../time";
import { ensureDefaults } from "./defaults";
import { goalsWithProgress } from "./goals";
import { listHealth, pickDaily } from "./health";
import { getRoutineDay } from "./routines";
import { dailyRunGoal, listRuns, toRunLike } from "./running";
import { daySummary } from "./stats";

export interface TimelineItem {
  at: string;
  kind: "meal" | "weight" | "water" | "workout" | "run" | "rest" | "routine" | "journal";
  title: string;
  detail: string | null;
  href: string | null;
}

export async function todayOverview(db: Db, s: Settings, today: LocalDate, date: LocalDate) {
  await ensureDefaults(db, s, today);
  const [nutrition, water, dayWorkouts, runsAll, runGoal, health, morning, night, goals, journals] = await Promise.all([
    daySummary(db, date),
    db.select().from(waterLogs).where(eq(waterLogs.localDate, date)).orderBy(asc(waterLogs.loggedAt)),
    db.select().from(workouts).where(eq(workouts.localDate, date)).orderBy(asc(workouts.createdAt)),
    listRuns(db, { end: date }),
    dailyRunGoal(db),
    listHealth(db, { start: addDays(date, -1), end: date }),
    getRoutineDay(db, "morning", date),
    getRoutineDay(db, "night", date),
    goalsWithProgress(db, s, today, { includeLinked: true, recent: 7 }),
    db.select().from(journalEntries).where(eq(journalEntries.localDate, date)),
  ]);

  // Training summary for the day.
  const sets = dayWorkouts.length ? await db.select().from(workoutSets).where(inArray(workoutSets.workoutId, dayWorkouts.map((w) => w.id))) : [];
  const training = dayWorkouts.map((w) => {
    const mine = sets.filter((x) => x.workoutId === w.id && x.completed && x.kind === "working" && (x.reps ?? 0) > 0 && x.weightKg != null);
    return {
      id: w.id,
      name: w.name,
      status: w.status,
      exerciseCount: new Set(sets.filter((x) => x.workoutId === w.id).map((x) => x.exerciseId)).size,
      setCount: mine.length,
      totalReps: mine.reduce((a, x) => a + (x.reps ?? 0), 0),
      volumeKg: mine.reduce((a, x) => a + (x.weightKg ?? 0) * (x.reps ?? 0), 0),
      createdAt: w.createdAt,
    };
  });

  // Running status and streak (through the selected day).
  const runLikes = runsAll.map(toRunLike);
  const first = runLikes[0]?.localDate ?? null;
  const trackingStart = [first, runGoal?.startDate].filter((x): x is string => !!x).sort()[0] ?? date;
  const runDays = trackingStart <= date ? classifyDays(runLikes, trackingStart, date, today, runGoal?.minDistanceM ?? null) : [];
  const dayStatus = runDays.at(-1)?.date === date ? runDays.at(-1)! : classifyDays(runLikes, date, date, today, runGoal?.minDistanceM ?? null)[0];
  const dayRuns = runsAll.filter((r) => r.localDate === date);

  // Health (one value per metric, most recent source).
  const picked = pickDaily(health);
  const h = (metric: string, d: LocalDate = date) => {
    const r = picked.get(`${d}|${metric}`);
    return r ? { value: r.value, sourceLabel: r.sourceLabel, origin: r.origin, syncedAt: r.syncedAt, details: r.details, alternatives: r.alternatives } : null;
  };

  // Chronological activity log.
  const timeline: TimelineItem[] = [];
  for (const m of nutrition.meals) {
    timeline.push({ at: m.eatenAt.toISOString(), kind: "meal", title: m.title, detail: `${m.category} · ${Math.round(m.totals.values.calories ?? 0)} kcal · P ${Math.round(m.totals.values.protein ?? 0)} g`, href: `/meals/${m.id}` });
  }
  for (const p of ["morning", "night"] as const) {
    const w = nutrition.weights[p];
    if (w) timeline.push({ at: w.measuredAt.toISOString(), kind: "weight", title: `${p === "morning" ? "Morning" : "Night"} weigh-in`, detail: null, href: "/weight" });
  }
  for (const w of water) timeline.push({ at: w.loggedAt.toISOString(), kind: "water", title: "Water", detail: `${w.inputValue} ${w.inputUnit}`, href: null });
  for (const w of training) timeline.push({ at: w.createdAt.toISOString(), kind: "workout", title: w.name, detail: `${w.setCount} sets · ${w.status === "in_progress" ? "in progress" : "completed"}`, href: `/training/workouts/${w.id}` });
  for (const r of dayRuns) timeline.push({ at: r.loggedAt.toISOString(), kind: r.kind === "run" ? "run" : "rest", title: r.kind === "run" ? `Run${r.runType ? ` · ${r.runType}` : ""}` : r.kind === "rest" ? "Rest day" : "Recovery day", detail: r.notes, href: "/running" });
  const logRows = await db
    .select({ completedAt: routineLogs.completedAt, slot: routineLogs.slot, title: routineActivities.title, completed: routineLogs.completed })
    .from(routineLogs)
    .innerJoin(routineActivities, eq(routineActivities.id, routineLogs.activityId))
    .where(and(eq(routineLogs.localDate, date), eq(routineLogs.completed, true)));
  for (const l of logRows) if (l.completedAt) timeline.push({ at: l.completedAt.toISOString(), kind: "routine", title: l.title, detail: l.slot === "morning" ? "Morning routine" : "Nightly routine", href: `/routines/${l.slot}` });
  for (const j of journals) if (j.body.trim() || j.answers.length) timeline.push({ at: j.updatedAt.toISOString(), kind: "journal", title: j.slot === "morning" ? "Morning journal" : "Nightly reflection", detail: null, href: `/journal?date=${date}` });
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  const waterGoal = goals.find((g) => g.metric === "water" && g.status === "active" && g.period === "daily");
  return {
    today,
    date,
    nutrition,
    water: { totalMl: water.reduce((a, w) => a + w.amountMl, 0), entries: water, targetMl: waterGoal?.current?.target ?? null },
    training: { workouts: training.map(({ createdAt: _c, ...w }) => { void _c; return w; }) },
    running: {
      status: dayStatus ?? null,
      entries: dayRuns,
      minDistanceM: runGoal?.minDistanceM ?? null,
      hasGoal: !!runGoal,
      streak: runStreaks(runDays),
    },
    health: {
      steps: h("steps"),
      sleep: h("sleep"),
      sleepScore: h("sleep_score"),
      restingHr: h("resting_hr"),
      hrv: h("hrv"),
      activeEnergy: h("active_energy"),
    },
    routines: {
      morning: { progress: morning.progress, activities: morning.activities.map((a) => ({ id: a.id, title: a.title, kind: a.kind, required: a.required, completed: !!a.log?.completed, value: a.log?.value ?? null, targetValue: a.targetValue, targetUnit: a.targetUnit })) },
      night: { progress: night.progress, activities: night.activities.map((a) => ({ id: a.id, title: a.title, kind: a.kind, required: a.required, completed: !!a.log?.completed, value: a.log?.value ?? null, targetValue: a.targetValue, targetUnit: a.targetUnit })) },
    },
    goals: goals.filter((g) => g.status === "active"),
    timeline,
    hasRunEntriesEver: runsAll.length > 0 || (await db.select({ id: runEntries.id }).from(runEntries).limit(1)).length > 0,
  };
}
