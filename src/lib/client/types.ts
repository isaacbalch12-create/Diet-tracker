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
