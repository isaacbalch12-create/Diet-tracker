/** JSON shapes returned by the API (server types with Dates serialized to strings). */
import type { AssistantAction, Goal, Settings, WeightEntry, Food } from "../db/schema";
import type { DaySummary } from "../services/stats";
import type { MealView, MealItemView, TotalsView } from "../services/meals";
import type { SavedMealView } from "../services/saved-meals";
import type { analyticsOverview } from "../services/stats";
import type { weightOverview } from "../services/weights";
import type { GoalVersion } from "../nutrition/goals";
import type { NutrientKey } from "../nutrition/nutrients";
import type { FoodSearchResult } from "../foods/repo";
import type { AnalysisView } from "../drafts";

export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends (...args: never[]) => unknown
      ? never
      : T extends object
        ? { [K in keyof T]: Jsonify<T[K]> }
        : T;

export type SettingsJ = Jsonify<Settings>;
export type MealJ = Jsonify<MealView>;
export type MealItemJ = Jsonify<MealItemView>;
export type TotalsJ = TotalsView;
export type DaySummaryJ = Jsonify<DaySummary> & { today: string };
export type WeightEntryJ = Jsonify<WeightEntry>;
export type WeightOverviewJ = Jsonify<Awaited<ReturnType<typeof weightOverview>>>;
export type AnalyticsJ = Jsonify<Awaited<ReturnType<typeof analyticsOverview>>>;
export type SavedMealJ = Jsonify<SavedMealView>;
export type GoalJ = Jsonify<Goal>;
export type FoodSearchResultJ = FoodSearchResult;
export type FoodJ = Jsonify<Omit<Food, "searchVector">>;
export type AssistantActionJ = Jsonify<AssistantAction>;
export type { AnalysisView, GoalVersion, NutrientKey };

export interface SettingsResponse {
  settings: SettingsJ;
  today: string;
  goals: GoalVersion | null;
  goalTargets: Partial<Record<NutrientKey, number>>;
  goalHistory: GoalVersion[];
  status: {
    aiConfigured: boolean;
    aiModel: string;
    usdaFoods: number;
    customFoods: number;
    fdcApiKeyIsDemo: boolean;
    authMode: "password" | "open" | "misconfigured";
    imageStorage: "db" | "s3";
    database: "postgres" | "embedded";
  };
}

export interface HistoryDay {
  date: string;
  mealCount: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  morningKg: number | null;
  nightKg: number | null;
}

// ---------------------------------------------------------------------------
// Unified tracker (training, running, health, routines, goals)

import type { todayOverview } from "../services/today";
import type { GoalView } from "../services/goals";
import type { computeInsights } from "../services/insights";
import type { trainingOverview, getWorkout, listWorkouts, listExercises, exerciseDetail, trainingRecords, trainingAnalytics, listTemplates } from "../services/training";
import type { runningOverview } from "../services/running";
import type { healthOverview, listConnections, IngestResult } from "../services/health";
import type { getRoutineDay, routineStats } from "../services/routines";
import type { JournalEntry, MobilityRoutine, RoutineTemplate, WorkoutTemplate } from "../db/schema";
import type { LiftlogImportSummary } from "../services/liftlog-import";

export type TodayJ = Jsonify<Awaited<ReturnType<typeof todayOverview>>>;
export type GoalJ2 = Jsonify<GoalView>;
export type InsightsJ = Jsonify<Awaited<ReturnType<typeof computeInsights>>>;
export type TrainingOverviewJ = Jsonify<Awaited<ReturnType<typeof trainingOverview>>>;
export type WorkoutDetailJ = Jsonify<Awaited<ReturnType<typeof getWorkout>>>;
export type WorkoutSummaryJ = Jsonify<Awaited<ReturnType<typeof listWorkouts>>[number]>;
export type ExerciseListItemJ = Jsonify<Awaited<ReturnType<typeof listExercises>>[number]>;
export type ExerciseDetailJ = Jsonify<Awaited<ReturnType<typeof exerciseDetail>>>;
export type RecordsJ = Jsonify<Awaited<ReturnType<typeof trainingRecords>>>;
export type TrainingAnalyticsJ = Jsonify<Awaited<ReturnType<typeof trainingAnalytics>>>;
export type WorkoutTemplateJ = Jsonify<WorkoutTemplate>;
export type TemplatesListJ = Jsonify<Awaited<ReturnType<typeof listTemplates>>>;
export type RunningJ = Jsonify<Awaited<ReturnType<typeof runningOverview>>>;
export type VitalsJ = Jsonify<Awaited<ReturnType<typeof healthOverview>>>;
export type ConnectionJ = Jsonify<Awaited<ReturnType<typeof listConnections>>[number]>;
export type IngestResultJ = IngestResult;
export type RoutineDayJ = Jsonify<Awaited<ReturnType<typeof getRoutineDay>>> & { today: string };
export type RoutineStatsJ = Jsonify<Awaited<ReturnType<typeof routineStats>>>;
export type JournalEntryJ = Jsonify<JournalEntry>;
export type MobilityRoutineJ = Jsonify<MobilityRoutine>;
export type RoutineTemplateJ = Jsonify<RoutineTemplate>;
export type LiftlogImportSummaryJ = LiftlogImportSummary;
