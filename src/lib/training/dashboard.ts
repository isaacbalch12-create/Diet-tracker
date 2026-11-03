import type { SetFact } from './types';
import { groupByExercise } from './facts';
import { DAY_MS, dayStart, nextPeriod, periodStart } from './aggregate';
import { buildSessions, type CalcOptions } from './sessions';

export interface Totals {
  workouts: number;
  sets: number;
  reps: number;
  volumeKg: number;
  exercises: number;
}

export function computeTotals(facts: SetFact[]): Totals {
  const workouts = new Set<string>();
  const exercises = new Set<string>();
  let reps = 0;
  let volumeKg = 0;
  for (const f of facts) {
    workouts.add(f.workoutId);
    exercises.add(f.exerciseId);
    reps += f.reps;
    volumeKg += f.weightKg * f.reps;
  }
  return { workouts: workouts.size, sets: facts.length, reps, volumeKg, exercises: exercises.size };
}

export interface WeekNumbers {
  startMs: number;
  endMs: number;
  workouts: number;
  sets: number;
  reps: number;
  volumeKg: number;
}

export interface WeekComparison {
  thisWeek: WeekNumbers;
  lastWeek: WeekNumbers;
  /** Last week up to the same weekday — a fair basis while this week is in progress. */
  lastWeekToDate: WeekNumbers;
  /** 1-based day of the current week, so "this week" can be labeled as in progress. */
  dayOfWeek: number;
  exercises: { exerciseId: string; thisWeekE1rm: number | null; lastWeekE1rm: number | null; lastWeekToDateE1rm: number | null }[];
}

function weekNumbers(facts: SetFact[], startMs: number, endMs: number): WeekNumbers {
  const inWeek = facts.filter((f) => f.dateMs >= startMs && f.dateMs < endMs);
  const t = computeTotals(inWeek);
  return { startMs, endMs, workouts: t.workouts, sets: t.sets, reps: t.reps, volumeKg: t.volumeKg };
}

/** Current calendar week (so far) vs. the full previous calendar week, from saved data only. */
export function compareWeeks(facts: SetFact[], now: Date, weekStartsOn: 0 | 1, opts: CalcOptions, exerciseIds: string[]): WeekComparison {
  const thisStart = periodStart(now.getTime(), 'week', weekStartsOn);
  const lastStart = periodStart(thisStart - 1, 'week', weekStartsOn);
  const nextStart = nextPeriod(thisStart, 'week');
  // Same weekday last week, inclusive (days are UTC-midnight keys, so no DST issues).
  const lastToDateEnd = dayStart(now.getTime()) - 7 * DAY_MS + DAY_MS;
  const byExercise = groupByExercise(facts);
  const bestIn = (exerciseId: string, s: number, e: number) => {
    const sessions = buildSessions((byExercise.get(exerciseId) ?? []).filter((f) => f.dateMs >= s && f.dateMs < e), opts);
    const vals = sessions.map((x) => x.bestE1rm).filter((v): v is number => v != null);
    return vals.length ? Math.max(...vals) : null;
  };
  return {
    thisWeek: weekNumbers(facts, thisStart, nextStart),
    lastWeek: weekNumbers(facts, lastStart, thisStart),
    lastWeekToDate: weekNumbers(facts, lastStart, Math.min(lastToDateEnd, thisStart)),
    dayOfWeek: Math.round((dayStart(now.getTime()) - thisStart) / DAY_MS) + 1,
    exercises: exerciseIds.map((id) => ({
      exerciseId: id,
      thisWeekE1rm: bestIn(id, thisStart, nextStart),
      lastWeekE1rm: bestIn(id, lastStart, thisStart),
      lastWeekToDateE1rm: bestIn(id, lastStart, Math.min(lastToDateEnd, thisStart)),
    })),
  };
}

/** Exercises ordered by how often they've been trained (most sessions first). */
export function mostTrainedExercises(facts: SetFact[]): { exerciseId: string; sessions: number; lastMs: number }[] {
  const out: { exerciseId: string; sessions: number; lastMs: number }[] = [];
  for (const [exerciseId, list] of groupByExercise(facts)) {
    out.push({ exerciseId, sessions: new Set(list.map((f) => f.workoutId)).size, lastMs: list[list.length - 1].dateMs });
  }
  return out.sort((a, b) => b.sessions - a.sessions || b.lastMs - a.lastMs);
}
