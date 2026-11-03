import type { OneRmFormula, SetFact } from './types';
import { eligible1RM } from './oneRm';
import { setVolumeKg } from './facts';

export interface CalcOptions {
  formula: OneRmFormula;
  maxRepsFor1RM: number;
}

export const DEFAULT_CALC: CalcOptions = { formula: 'epley', maxRepsFor1RM: 12 };

/** Everything one exercise did in one workout. */
export interface ExerciseSession {
  workoutId: string;
  exerciseId: string;
  dateMs: number;
  sets: SetFact[];
  setCount: number;
  totalReps: number;
  volumeKg: number;
  /** Heaviest weight lifted in the session and the reps done with it. */
  topWeightKg: number;
  topWeightReps: number;
  maxReps: number;
  /** Best eligible estimated 1RM (null when every set exceeded the rep cap or was bodyweight). */
  bestE1rm: number | null;
  bestE1rmSet: SetFact | null;
  /** Best set: highest estimated 1RM, or heaviest weight if no estimate is eligible. */
  bestSet: SetFact;
  avgWeightKg: number;
  avgReps: number;
}

export function buildSession(sets: SetFact[], opts: CalcOptions): ExerciseSession {
  let maxReps = 0;
  let totalReps = 0;
  let volumeKg = 0;
  let weightSum = 0;
  let bestE1rm: number | null = null;
  let bestE1rmSet: SetFact | null = null;
  for (const s of sets) {
    totalReps += s.reps;
    volumeKg += setVolumeKg(s.weightKg, s.reps);
    weightSum += s.weightKg;
    if (s.reps > maxReps) maxReps = s.reps;
    const e = eligible1RM(s.weightKg, s.reps, opts.formula, opts.maxRepsFor1RM);
    if (e != null && (bestE1rm == null || e > bestE1rm)) {
      bestE1rm = e;
      bestE1rmSet = s;
    }
  }
  const heaviest = sets.reduce((best, s) => (s.weightKg > best.weightKg || (s.weightKg === best.weightKg && s.reps > best.reps) ? s : best), sets[0]);
  return {
    workoutId: sets[0].workoutId,
    exerciseId: sets[0].exerciseId,
    dateMs: sets[0].dateMs,
    sets,
    setCount: sets.length,
    totalReps,
    volumeKg,
    topWeightKg: heaviest.weightKg,
    topWeightReps: heaviest.reps,
    maxReps,
    bestE1rm,
    bestE1rmSet,
    bestSet: bestE1rmSet ?? heaviest,
    avgWeightKg: weightSum / sets.length,
    avgReps: totalReps / sets.length,
  };
}

/** Group one exercise's facts (already chronological) into sessions, oldest first. */
export function buildSessions(facts: SetFact[], opts: CalcOptions): ExerciseSession[] {
  const byWorkout = new Map<string, SetFact[]>();
  for (const f of facts) {
    const list = byWorkout.get(f.workoutId);
    if (list) list.push(f);
    else byWorkout.set(f.workoutId, [f]);
  }
  return [...byWorkout.values()].map((sets) => buildSession(sets, opts)).sort((a, b) => a.dateMs - b.dateMs || a.workoutId.localeCompare(b.workoutId));
}
