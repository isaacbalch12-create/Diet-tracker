import type { SetFact, Unit } from './types';
import { estimateConfidence, type EstimateConfidence } from './oneRm';
import { buildSessions, type CalcOptions, type ExerciseSession } from './sessions';
import { WEIGHT_TOLERANCE_KG, fromKg, roundTo } from './units';

export interface DatedValue {
  value: number;
  dateMs: number;
  workoutId: string;
}

export interface RepRecord {
  /** Weight rounded to 0.1 in the display unit — sets are grouped by this key. */
  weightKey: number;
  weightKg: number;
  reps: number;
  dateMs: number;
  workoutId: string;
}

export interface SessionComparison {
  latest: ExerciseSession;
  previous: ExerciseSession;
  topWeightDeltaKg: number;
  e1rmDeltaKg: number | null;
  volumeDeltaKg: number;
  totalRepsDelta: number;
  setCountDelta: number;
}

export interface ExerciseStats {
  exerciseId: string;
  sessions: ExerciseSession[];
  sessionCount: number;
  setCount: number;
  totalReps: number;
  totalVolumeKg: number;
  avgWeightKg: number;
  avgReps: number;
  firstDateMs: number | null;
  lastDateMs: number | null;
  heaviest: (DatedValue & { reps: number }) | null;
  bestE1rm: (DatedValue & { weightKg: number; reps: number; confidence: EstimateConfidence }) | null;
  mostReps: (DatedValue & { weightKg: number }) | null;
  bestSessionVolume: DatedValue | null;
  bestSetVolume: (DatedValue & { weightKg: number; reps: number }) | null;
  /** Most reps ever performed at each weight, heaviest weight first. */
  repRecords: RepRecord[];
  comparison: SessionComparison | null;
}

export function weightKey(kg: number, unit: Unit): number {
  return roundTo(fromKg(kg, unit), 1);
}

/**
 * Lifetime statistics for one exercise. `facts` must contain only this exercise's
 * sets, in chronological order. Records keep the earliest date a value was reached
 * (ties do not move a record forward in time).
 */
export function computeExerciseStats(exerciseId: string, facts: SetFact[], opts: CalcOptions, unit: Unit): ExerciseStats {
  const sessions = buildSessions(facts, opts);
  let totalReps = 0;
  let totalVolumeKg = 0;
  let weightSum = 0;
  let heaviest: ExerciseStats['heaviest'] = null;
  let bestE1rm: ExerciseStats['bestE1rm'] = null;
  let mostReps: ExerciseStats['mostReps'] = null;
  let bestSetVolume: ExerciseStats['bestSetVolume'] = null;
  const repMap = new Map<number, RepRecord>();

  for (const f of facts) {
    totalReps += f.reps;
    totalVolumeKg += f.weightKg * f.reps;
    weightSum += f.weightKg;
    if (heaviest == null || f.weightKg > heaviest.value + WEIGHT_TOLERANCE_KG) {
      heaviest = { value: f.weightKg, reps: f.reps, dateMs: f.dateMs, workoutId: f.workoutId };
    }
    if (!mostReps || f.reps > mostReps.value) {
      mostReps = { value: f.reps, weightKg: f.weightKg, dateMs: f.dateMs, workoutId: f.workoutId };
    }
    const sv = f.weightKg * f.reps;
    if (sv > 0 && (!bestSetVolume || sv > bestSetVolume.value)) {
      bestSetVolume = { value: sv, weightKg: f.weightKg, reps: f.reps, dateMs: f.dateMs, workoutId: f.workoutId };
    }
    const key = weightKey(f.weightKg, unit);
    const rr = repMap.get(key);
    if (!rr || f.reps > rr.reps) {
      repMap.set(key, { weightKey: key, weightKg: f.weightKg, reps: f.reps, dateMs: f.dateMs, workoutId: f.workoutId });
    }
  }

  for (const s of sessions) {
    if (s.bestE1rm != null && s.bestE1rmSet && (!bestE1rm || s.bestE1rm > bestE1rm.value + WEIGHT_TOLERANCE_KG)) {
      bestE1rm = {
        value: s.bestE1rm,
        weightKg: s.bestE1rmSet.weightKg,
        reps: s.bestE1rmSet.reps,
        confidence: estimateConfidence(s.bestE1rmSet.reps, opts.maxRepsFor1RM),
        dateMs: s.dateMs,
        workoutId: s.workoutId,
      };
    }
  }

  let bestSessionVolume: DatedValue | null = null;
  for (const s of sessions) {
    if (s.volumeKg > 0 && (!bestSessionVolume || s.volumeKg > bestSessionVolume.value)) {
      bestSessionVolume = { value: s.volumeKg, dateMs: s.dateMs, workoutId: s.workoutId };
    }
  }

  const n = facts.length;
  return {
    exerciseId,
    sessions,
    sessionCount: sessions.length,
    setCount: n,
    totalReps,
    totalVolumeKg,
    avgWeightKg: n ? weightSum / n : 0,
    avgReps: n ? totalReps / n : 0,
    firstDateMs: sessions[0]?.dateMs ?? null,
    lastDateMs: sessions[sessions.length - 1]?.dateMs ?? null,
    heaviest,
    bestE1rm,
    mostReps,
    bestSessionVolume,
    bestSetVolume,
    repRecords: [...repMap.values()].sort((a, b) => b.weightKey - a.weightKey),
    comparison: compareLastTwo(sessions),
  };
}

export function compareSessions(latest: ExerciseSession, previous: ExerciseSession): SessionComparison {
  return {
    latest,
    previous,
    topWeightDeltaKg: latest.topWeightKg - previous.topWeightKg,
    e1rmDeltaKg: latest.bestE1rm != null && previous.bestE1rm != null ? latest.bestE1rm - previous.bestE1rm : null,
    volumeDeltaKg: latest.volumeKg - previous.volumeKg,
    totalRepsDelta: latest.totalReps - previous.totalReps,
    setCountDelta: latest.setCount - previous.setCount,
  };
}

function compareLastTwo(sessions: ExerciseSession[]): SessionComparison | null {
  if (sessions.length < 2) return null;
  return compareSessions(sessions[sessions.length - 1], sessions[sessions.length - 2]);
}
