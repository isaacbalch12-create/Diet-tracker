import type { SetFact } from './types';
import { dateToMs } from './aggregate';

/** Minimal shapes the calculations need (database rows satisfy them). */
export interface FactWorkout {
  id: string;
  localDate: string;
  createdAt: Date | string;
}

export interface FactSet {
  id: string;
  workoutId: string;
  exerciseId: string;
  setNumber: number;
  position: number;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  kind: string;
  completed: boolean;
}

/**
 * A set counts toward statistics only when it is completed, is a working set
 * (warm-ups are excluded), has at least one rep, and has a weight (0 = bodyweight).
 */
export function isCountableSet(s: FactSet): boolean {
  return (
    s.completed &&
    s.kind === 'working' &&
    s.reps != null &&
    Number.isFinite(s.reps) &&
    s.reps > 0 &&
    s.weightKg != null &&
    Number.isFinite(s.weightKg) &&
    s.weightKg >= 0
  );
}

export function setVolumeKg(weightKg: number, reps: number): number {
  return weightKg * reps;
}

/**
 * Join countable sets with their workout's local date, sorted chronologically.
 * Several workouts on one day are ordered by when they were created (a few
 * milliseconds apart in `dateMs`), which keeps record replays deterministic.
 */
export function buildFacts(data: { workouts: FactWorkout[]; sets: FactSet[] }): SetFact[] {
  const ordered = [...data.workouts].sort(
    (a, b) => a.localDate.localeCompare(b.localDate) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id),
  );
  const workoutMs = new Map<string, { date: string; ms: number }>();
  let prevDate = '';
  let idx = 0;
  for (const w of ordered) {
    idx = w.localDate === prevDate ? idx + 1 : 0;
    prevDate = w.localDate;
    workoutMs.set(w.id, { date: w.localDate, ms: dateToMs(w.localDate) + idx });
  }
  const facts: SetFact[] = [];
  for (const s of data.sets) {
    if (!isCountableSet(s)) continue;
    const w = workoutMs.get(s.workoutId);
    if (!w) continue;
    facts.push({
      id: s.id,
      workoutId: s.workoutId,
      exerciseId: s.exerciseId,
      date: w.date,
      dateMs: w.ms,
      setNumber: s.setNumber,
      position: s.position,
      weightKg: s.weightKg as number,
      reps: s.reps as number,
      rpe: s.rpe,
    });
  }
  return sortFacts(facts);
}

export function sortFacts(facts: SetFact[]): SetFact[] {
  return facts.sort(
    (a, b) => a.dateMs - b.dateMs || a.workoutId.localeCompare(b.workoutId) || a.position - b.position || a.setNumber - b.setNumber,
  );
}

export function groupByExercise(facts: SetFact[]): Map<string, SetFact[]> {
  const map = new Map<string, SetFact[]>();
  for (const f of facts) {
    const list = map.get(f.exerciseId);
    if (list) list.push(f);
    else map.set(f.exerciseId, [f]);
  }
  return map;
}

export function groupByWorkout(facts: SetFact[]): Map<string, SetFact[]> {
  const map = new Map<string, SetFact[]>();
  for (const f of facts) {
    const list = map.get(f.workoutId);
    if (list) list.push(f);
    else map.set(f.workoutId, [f]);
  }
  return map;
}

export interface WorkoutSummary {
  workoutId: string;
  dateMs: number;
  setCount: number;
  totalReps: number;
  volumeKg: number;
  exerciseIds: string[];
}

/** One summary per workout that has at least one countable set, oldest first. */
export function summarizeWorkouts(facts: SetFact[]): WorkoutSummary[] {
  const out: WorkoutSummary[] = [];
  for (const [workoutId, list] of groupByWorkout(facts)) {
    const exerciseIds = [...new Set(list.map((f) => f.exerciseId))];
    out.push({
      workoutId,
      dateMs: list[0].dateMs,
      setCount: list.length,
      totalReps: list.reduce((a, f) => a + f.reps, 0),
      volumeKg: list.reduce((a, f) => a + setVolumeKg(f.weightKg, f.reps), 0),
      exerciseIds,
    });
  }
  return out.sort((a, b) => a.dateMs - b.dateMs);
}
