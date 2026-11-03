/**
 * The workout editor's local document. It mirrors the PUT /api/workouts/:id
 * payload (workoutDocSchema); ids are generated on the client so autosaves are
 * idempotent and set identity survives every save.
 */
import { newRequestId } from "@/lib/client/api";
import type { WorkoutDetailJ } from "@/lib/client/types";
import type { Unit } from "@/lib/training/types";

export type SetKind = "working" | "warmup";

export interface EditorSet {
  id: string;
  setNumber: number;
  manualSetNumber: boolean;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  notes: string;
  kind: SetKind;
  completed: boolean;
  targetWeightKg: number | null;
  targetReps: number | null;
}

export interface EditorExercise {
  id: string;
  exerciseId: string;
  notes: string;
  sets: EditorSet[];
}

export interface EditorDoc {
  name: string;
  localDate: string;
  notes: string;
  unit: Unit;
  exercises: EditorExercise[];
}

export interface PrevSet {
  weightKg: number | null;
  reps: number | null;
  kind: string;
}

export type PreviousSession = WorkoutDetailJ["exercises"][number]["previous"];

/** Server limits from workoutDocSchema. */
export const LIMITS = { maxExercises: 60, maxSets: 100, maxWeightKg: 1000, maxReps: 10_000, minRpe: 1, maxRpe: 10 } as const;

export const newSetId = () => `s-${newRequestId()}`;
export const newWorkoutExerciseId = () => `we-${newRequestId()}`;

export function blankSet(patch: Partial<EditorSet> = {}): EditorSet {
  return { id: newSetId(), setNumber: 1, manualSetNumber: false, weightKg: null, reps: null, rpe: null, notes: "", kind: "working", completed: false, targetWeightKg: null, targetReps: null, ...patch };
}

export function docFromWorkout(w: WorkoutDetailJ): EditorDoc {
  return {
    name: w.name,
    localDate: w.localDate,
    notes: w.notes,
    unit: w.unit,
    exercises: w.exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      notes: e.notes,
      sets: e.sets.map((s) => ({
        id: s.id,
        setNumber: s.setNumber,
        manualSetNumber: s.manualSetNumber,
        weightKg: s.weightKg,
        reps: s.reps,
        rpe: s.rpe,
        notes: s.notes,
        kind: s.kind === "warmup" ? "warmup" : "working",
        completed: s.completed,
        targetWeightKg: s.targetWeightKg,
        targetReps: s.targetReps,
      })),
    })),
  };
}

export function docPayload(doc: EditorDoc, celebratedRecordKeys?: string[]) {
  return {
    name: doc.name.trim().slice(0, 200) || "Workout",
    localDate: doc.localDate,
    notes: doc.notes.slice(0, 4000),
    unit: doc.unit,
    exercises: doc.exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      notes: e.notes.slice(0, 2000),
      sets: e.sets.map((s, k) => ({
        id: s.id,
        setNumber: s.manualSetNumber ? s.setNumber : k + 1,
        manualSetNumber: s.manualSetNumber,
        weightKg: s.weightKg,
        reps: s.reps,
        rpe: s.rpe,
        notes: s.notes.slice(0, 1000),
        kind: s.kind,
        completed: s.completed,
        targetWeightKg: s.targetWeightKg,
        targetReps: s.targetReps,
      })),
    })),
    ...(celebratedRecordKeys?.length ? { celebratedRecordKeys } : {}),
  };
}

/**
 * Everything records and "previous session" depend on. When it changes after a
 * save, the workout (and every derived screen) is refetched.
 */
export function recordSignature(doc: EditorDoc): string {
  return JSON.stringify([doc.localDate, doc.exercises.map((e) => [e.id, e.exerciseId, e.sets.filter((s) => s.completed).map((s) => [s.weightKg, s.reps, s.kind])])]);
}

/**
 * Line up this session's sets with last session's by type: the first working set
 * matches last time's first working set, warm-ups match warm-ups.
 */
export function matchPrevious(sets: EditorSet[], previous: PreviousSession | undefined): (PrevSet | null)[] {
  if (!previous) return sets.map(() => null);
  const pools: Record<SetKind, PrevSet[]> = {
    working: previous.sets.filter((s) => s.kind !== "warmup"),
    warmup: previous.sets.filter((s) => s.kind === "warmup"),
  };
  const seen: Record<SetKind, number> = { working: 0, warmup: 0 };
  return sets.map((s) => pools[s.kind][seen[s.kind]++] ?? null);
}

/** Display numbers: warm-ups show "W", working sets count 1, 2, 3… (or a manual number). */
export function setLabels(sets: EditorSet[]): string[] {
  let n = 0;
  return sets.map((s) => {
    if (s.kind === "warmup") return "W";
    n += 1;
    return String(s.manualSetNumber ? s.setNumber : n);
  });
}

export function setCounts(doc: EditorDoc) {
  let completed = 0;
  let untickedWithValues = 0;
  let completable = 0;
  let empty = 0;
  for (const e of doc.exercises) {
    for (const s of e.sets) {
      if (s.completed) completed += 1;
      else if (s.weightKg != null || s.reps != null) {
        untickedWithValues += 1;
        if (s.weightKg != null && s.reps != null && s.reps > 0) completable += 1;
      } else empty += 1;
    }
  }
  return { completed, untickedWithValues, completable, empty };
}

/** Totals of completed working sets (warm-ups are excluded, like every statistic). */
export function docTotals(doc: EditorDoc) {
  let sets = 0;
  let reps = 0;
  let volumeKg = 0;
  for (const e of doc.exercises) {
    for (const s of e.sets) {
      if (!s.completed || s.kind !== "working" || s.weightKg == null || s.reps == null || s.reps < 1) continue;
      sets += 1;
      reps += s.reps;
      volumeKg += s.weightKg * s.reps;
    }
  }
  return { sets, reps, volumeKg };
}
