import type { SetFact, Unit } from './types';
import { groupByExercise, summarizeWorkouts } from './facts';
import { buildSessions, type CalcOptions } from './sessions';
import { WEIGHT_TOLERANCE_KG, fromKg } from './units';

export type RecordType =
  | 'weight' // heaviest weight lifted
  | 'e1rm' // highest estimated 1RM
  | 'reps' // most reps at a given weight
  | 'sessionVolume' // most volume for one exercise in one session
  | 'workoutVolume' // most total volume in one workout
  | 'beatLast' // beat the previous session's best estimated 1RM
  | 'milestone'; // lifetime volume / reps / workout-count milestones

export interface RecordEvent {
  /** Deterministic key, so the same achievement is never stored or celebrated twice. */
  key: string;
  type: RecordType;
  exerciseId: string | null;
  workoutId: string;
  dateMs: number;
  value: number;
  previous: number | null;
  /** Context: the set that set the record. */
  weightKg?: number;
  reps?: number;
  /** For milestones: what crossed the threshold. */
  milestone?: { metric: 'totalVolume' | 'totalReps' | 'workouts' | 'exerciseVolume'; threshold: number; unit?: Unit };
}

export const RECORD_LABEL: Record<RecordType, string> = {
  weight: 'Heaviest weight',
  e1rm: 'Best estimated 1RM',
  reps: 'Rep record',
  sessionVolume: 'Exercise volume (session)',
  workoutVolume: 'Workout volume',
  beatLast: 'Beat last session',
  milestone: 'Milestone',
};

const VOLUME_MILESTONES: Record<Unit, number[]> = {
  lb: [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000],
  kg: [5_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000],
};
const EXERCISE_VOLUME_MILESTONES: Record<Unit, number[]> = {
  lb: [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000],
  kg: [5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000],
};
const REP_MILESTONES = [500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000];
const WORKOUT_MILESTONES = [1, 10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000];

const VOLUME_TOLERANCE = 0.001; // 0.1%

function beats(value: number, best: number): boolean {
  return value > best + WEIGHT_TOLERANCE_KG;
}
function beatsVolume(value: number, best: number): boolean {
  return value > best * (1 + VOLUME_TOLERANCE) + WEIGHT_TOLERANCE_KG;
}
/** Unit-independent weight bucket for rep records: kg rounded to 0.1. */
export function recordWeightKey(kg: number): number {
  return Math.round(kg * 10) / 10;
}

function crossed(thresholds: number[], before: number, after: number): number[] {
  return thresholds.filter((t) => before < t && after >= t);
}

/**
 * Replays history in chronological order and emits an event every time a record
 * is broken. The first time an exercise is performed only establishes a baseline —
 * it is not a "record broken" event. Within one session, each record type fires at
 * most once per exercise (per weight for rep records), reporting the session's best.
 *
 * Because records are derived from set data rather than stored, editing or deleting
 * a historical set automatically corrects every record that depended on it.
 */
export function computeRecordEvents(facts: SetFact[], opts: CalcOptions, unit: Unit): RecordEvent[] {
  const events: RecordEvent[] = [];

  for (const [exerciseId, exFacts] of groupByExercise(facts)) {
    const sessions = buildSessions(exFacts, opts);
    let bestWeight: number | null = null;
    let bestE1rm: number | null = null;
    let bestSessionVol: number | null = null;
    let lifetimeVolKg = 0;
    const repsAt = new Map<number, number>();
    let prevSessionE1rm: number | null = null;

    for (const s of sessions) {
      const base = { exerciseId, workoutId: s.workoutId, dateMs: s.dateMs };
      // Keys identify *which* record (type + exercise + session), never its value or the
      // display unit, so later sets in the same session or a kg/lb switch can't re-trigger it.
      const key = (type: RecordType, extra = '') => `${type}:${exerciseId}:${s.workoutId}${extra}`;

      if (bestWeight != null && beats(s.topWeightKg, bestWeight)) {
        events.push({ ...base, key: key('weight'), type: 'weight', value: s.topWeightKg, previous: bestWeight, weightKg: s.topWeightKg, reps: s.topWeightReps });
      }
      if (s.bestE1rm != null && s.bestE1rmSet) {
        if (bestE1rm != null && beats(s.bestE1rm, bestE1rm)) {
          events.push({ ...base, key: key('e1rm'), type: 'e1rm', value: s.bestE1rm, previous: bestE1rm, weightKg: s.bestE1rmSet.weightKg, reps: s.bestE1rmSet.reps });
        }
        if (prevSessionE1rm != null && beats(s.bestE1rm, prevSessionE1rm)) {
          events.push({ ...base, key: key('beatLast'), type: 'beatLast', value: s.bestE1rm, previous: prevSessionE1rm, weightKg: s.bestE1rmSet.weightKg, reps: s.bestE1rmSet.reps });
        }
      }

      // Rep records: best reps per weight in this session vs. all earlier sessions.
      const sessionRepsAt = new Map<number, { reps: number; weightKg: number }>();
      for (const f of s.sets) {
        const k = recordWeightKey(f.weightKg);
        const cur = sessionRepsAt.get(k);
        if (!cur || f.reps > cur.reps) sessionRepsAt.set(k, { reps: f.reps, weightKg: f.weightKg });
      }
      for (const [k, { reps, weightKg }] of sessionRepsAt) {
        const prev = repsAt.get(k);
        if (prev != null && reps > prev) {
          events.push({ ...base, key: key('reps', `:${k}`), type: 'reps', value: reps, previous: prev, weightKg, reps });
        }
      }

      if (bestSessionVol != null && beatsVolume(s.volumeKg, bestSessionVol)) {
        events.push({ ...base, key: key('sessionVolume'), type: 'sessionVolume', value: s.volumeKg, previous: bestSessionVol });
      }

      const before = fromKg(lifetimeVolKg, unit);
      lifetimeVolKg += s.volumeKg;
      for (const t of crossed(EXERCISE_VOLUME_MILESTONES[unit], before, fromKg(lifetimeVolKg, unit))) {
        events.push({ ...base, key: `milestone:exerciseVolume:${exerciseId}:${unit}:${t}`, type: 'milestone', value: t, previous: null, milestone: { metric: 'exerciseVolume', threshold: t, unit } });
      }

      // Update running bests after evaluating this session.
      bestWeight = Math.max(bestWeight ?? -Infinity, s.topWeightKg);
      if (s.bestE1rm != null) {
        bestE1rm = Math.max(bestE1rm ?? -Infinity, s.bestE1rm);
        prevSessionE1rm = s.bestE1rm;
      }
      bestSessionVol = Math.max(bestSessionVol ?? -Infinity, s.volumeKg);
      for (const [k, { reps }] of sessionRepsAt) repsAt.set(k, Math.max(repsAt.get(k) ?? 0, reps));
    }
  }

  // Workout-level records and lifetime milestones.
  let bestWorkoutVol: number | null = null;
  let totalVolKg = 0;
  let totalReps = 0;
  let workoutCount = 0;
  for (const w of summarizeWorkouts(facts)) {
    const base = { exerciseId: null, workoutId: w.workoutId, dateMs: w.dateMs };
    if (bestWorkoutVol != null && beatsVolume(w.volumeKg, bestWorkoutVol)) {
      events.push({ ...base, key: `workoutVolume:${w.workoutId}`, type: 'workoutVolume', value: w.volumeKg, previous: bestWorkoutVol });
    }
    bestWorkoutVol = Math.max(bestWorkoutVol ?? -Infinity, w.volumeKg);

    const volBefore = fromKg(totalVolKg, unit);
    totalVolKg += w.volumeKg;
    for (const t of crossed(VOLUME_MILESTONES[unit], volBefore, fromKg(totalVolKg, unit))) {
      events.push({ ...base, key: `milestone:totalVolume:${unit}:${t}`, type: 'milestone', value: t, previous: null, milestone: { metric: 'totalVolume', threshold: t, unit } });
    }
    const repsBefore = totalReps;
    totalReps += w.totalReps;
    for (const t of crossed(REP_MILESTONES, repsBefore, totalReps)) {
      events.push({ ...base, key: `milestone:totalReps:${t}`, type: 'milestone', value: t, previous: null, milestone: { metric: 'totalReps', threshold: t } });
    }
    workoutCount += 1;
    for (const t of crossed(WORKOUT_MILESTONES, workoutCount - 1, workoutCount)) {
      events.push({ ...base, key: `milestone:workouts:${t}`, type: 'milestone', value: t, previous: null, milestone: { metric: 'workouts', threshold: t } });
    }
  }

  return events.sort((a, b) => b.dateMs - a.dateMs || a.key.localeCompare(b.key));
}

/**
 * Records worth a celebration toast and a "PR" badge. Beat-last-session is progress,
 * not a record; milestones depend on the display unit, so they are shown on the
 * Records page and dashboard instead of being celebrated mid-workout.
 */
export const CELEBRATED_TYPES: RecordType[] = ['weight', 'e1rm', 'reps', 'sessionVolume', 'workoutVolume'];

export function eventsForWorkout(events: RecordEvent[], workoutId: string): RecordEvent[] {
  return events.filter((e) => e.workoutId === workoutId);
}
