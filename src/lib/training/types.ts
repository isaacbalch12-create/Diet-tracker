/**
 * Strength-training types shared by the pure calculation modules in this folder
 * (ported from the LiftLog workout tracker). Dates are local calendar days; for
 * ordering and window math each day is represented as UTC-midnight milliseconds
 * (`dateMs`), so results never depend on the server's time zone.
 */
import type { Equipment, Exercise as ExerciseRow, ExerciseCategory, MuscleGroup } from "../db/schema";

export type Unit = "kg" | "lb";
export type OneRmFormula = "epley" | "brzycki";
export type { Equipment, ExerciseCategory, MuscleGroup };

export const MUSCLE_GROUPS: MuscleGroup[] = ["chest", "back", "shoulders", "biceps", "triceps", "forearms", "traps", "quads", "hamstrings", "glutes", "calves", "adductors", "core", "full body"];
export const EQUIPMENT: Equipment[] = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "smith machine", "ez bar", "trap bar", "band", "other"];
export const CATEGORIES: ExerciseCategory[] = ["compound", "isolation"];

/** The subset of an exercise row the calculations need. */
export type Exercise = Pick<ExerciseRow, "id" | "name" | "primaryMuscle" | "secondaryMuscles" | "equipment" | "category">;

/** A completed working set joined with the context analytics needs. */
export interface SetFact {
  id: string;
  workoutId: string;
  exerciseId: string;
  /** Local date of the workout (YYYY-MM-DD). */
  date: string;
  /** Ordering key: UTC midnight of `date` plus a small per-workout offset for same-day workouts. */
  dateMs: number;
  setNumber: number;
  position: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
}

/** Inclusive millisecond bounds; null = unbounded. */
export interface ResolvedRange {
  startMs: number | null;
  endMs: number | null;
}
