import type { ResolvedRange, SetFact, Unit } from './types';
import { aggregateByPeriod, countDistinctByPeriod, periodLabel, type Period, type PeriodBucket } from './aggregate';
import { weightKey } from './exerciseStats';
import type { ExerciseSession } from './sessions';
import { fromKg, roundTo } from './units';

/** Chart-ready series. Values are converted to the display unit here, never in components. */

export interface StrengthPoint {
  x: number;
  workoutId: string;
  e1rm: number | null;
  top: number;
  topReps: number;
}

export function strengthSeries(sessions: ExerciseSession[], unit: Unit): StrengthPoint[] {
  return sessions.map((s) => ({
    x: s.dateMs,
    workoutId: s.workoutId,
    e1rm: s.bestE1rm != null ? roundTo(fromKg(s.bestE1rm, unit), 1) : null,
    top: roundTo(fromKg(s.topWeightKg, unit), 1),
    topReps: s.topWeightReps,
  }));
}

export function sessionVolumeSeries(sessions: ExerciseSession[], unit: Unit): PeriodBucket[] {
  return sessions.map((s) => ({ startMs: s.dateMs, label: periodLabel(s.dateMs, 'week'), value: Math.round(fromKg(s.volumeKg, unit)), count: 1 }));
}

export function periodVolumeSeries(facts: SetFact[], period: Period, weekStartsOn: 0 | 1, range: ResolvedRange, unit: Unit, now = Date.now()): PeriodBucket[] {
  const bounds = { startMs: range.startMs, endMs: range.endMs != null ? Math.min(range.endMs, now) : null };
  return aggregateByPeriod(facts, (f) => f.dateMs, (f) => fromKg(f.weightKg * f.reps, unit), period, weekStartsOn, bounds).map((b) => ({ ...b, value: Math.round(b.value) }));
}

export function sessionsPerPeriod(facts: SetFact[], period: Period, weekStartsOn: 0 | 1, range: ResolvedRange, now = Date.now()): PeriodBucket[] {
  const bounds = { startMs: range.startMs, endMs: range.endMs != null ? Math.min(range.endMs, now) : null };
  return countDistinctByPeriod(facts, (f) => f.dateMs, (f) => f.workoutId, period, weekStartsOn, bounds);
}

/** Weights used for an exercise (display-unit keys), most-used first. */
export function weightsUsed(sessions: ExerciseSession[], unit: Unit): { weightKey: number; sessions: number }[] {
  const map = new Map<number, Set<string>>();
  for (const s of sessions) {
    for (const f of s.sets) {
      const k = weightKey(f.weightKg, unit);
      if (!map.has(k)) map.set(k, new Set());
      map.get(k)!.add(s.workoutId);
    }
  }
  return [...map.entries()].map(([k, set]) => ({ weightKey: k, sessions: set.size })).sort((a, b) => b.sessions - a.sessions || b.weightKey - a.weightKey);
}

export interface RepsPoint {
  x: number;
  workoutId: string;
  reps: number;
  sets: number;
}

/** Best reps at one specific weight in each session that used it. */
export function repsAtWeightSeries(sessions: ExerciseSession[], key: number, unit: Unit): RepsPoint[] {
  const out: RepsPoint[] = [];
  for (const s of sessions) {
    const at = s.sets.filter((f) => weightKey(f.weightKg, unit) === key);
    if (at.length) out.push({ x: s.dateMs, workoutId: s.workoutId, reps: Math.max(...at.map((f) => f.reps)), sets: at.length });
  }
  return out;
}

export function maxRepsSeries(sessions: ExerciseSession[], unit: Unit): { x: number; reps: number; weight: number }[] {
  return sessions.map((s) => {
    const best = s.sets.reduce((a, b) => (b.reps > a.reps || (b.reps === a.reps && b.weightKg > a.weightKg) ? b : a));
    return { x: s.dateMs, reps: best.reps, weight: roundTo(fromKg(best.weightKg, unit), 1) };
  });
}
