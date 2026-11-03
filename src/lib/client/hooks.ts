"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  AnalyticsJ,
  ConnectionJ,
  DaySummaryJ,
  ExerciseDetailJ,
  ExerciseListItemJ,
  GoalJ2,
  HistoryDay,
  InsightsJ,
  JournalEntryJ,
  MealJ,
  MobilityRoutineJ,
  RecordsJ,
  RoutineDayJ,
  RoutineStatsJ,
  RoutineTemplateJ,
  RunningJ,
  SavedMealJ,
  SettingsResponse,
  TodayJ,
  TrainingAnalyticsJ,
  TrainingOverviewJ,
  VitalsJ,
  WeightOverviewJ,
  WorkoutDetailJ,
  WorkoutSummaryJ,
  WorkoutTemplateJ,
} from "./types";

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api.get<SettingsResponse>("/api/settings"), staleTime: 60_000 });
}

export function useDay(date: string | null) {
  return useQuery({
    queryKey: ["day", date],
    queryFn: () => api.get<DaySummaryJ>(`/api/day${date ? `?date=${date}` : ""}`),
    enabled: date !== null,
    placeholderData: (prev) => prev,
  });
}

export function useMeal(id: string) {
  return useQuery({ queryKey: ["meal", id], queryFn: () => api.get<{ meal: MealJ }>(`/api/meals/${id}`).then((r) => r.meal) });
}

export function useWeights(range: string) {
  return useQuery({ queryKey: ["weights", range], queryFn: () => api.get<WeightOverviewJ>(`/api/weights?${range}`), placeholderData: (prev) => prev });
}

export function useAnalytics(qs: string) {
  return useQuery({ queryKey: ["analytics", qs], queryFn: () => api.get<AnalyticsJ>(`/api/analytics?${qs}`), placeholderData: (prev) => prev });
}

export function useHistory(start: string, end: string) {
  return useQuery({
    queryKey: ["history", start, end],
    queryFn: () => api.get<{ days: HistoryDay[] }>(`/api/history?start=${start}&end=${end}`),
    placeholderData: (prev) => prev,
  });
}

export function useSavedMeals() {
  return useQuery({ queryKey: ["saved-meals"], queryFn: () => api.get<{ savedMeals: SavedMealJ[] }>("/api/saved-meals").then((r) => r.savedMeals) });
}

export function useRecentMeals() {
  return useQuery({ queryKey: ["recent-meals"], queryFn: () => api.get<{ meals: MealJ[] }>("/api/meals/recent").then((r) => r.meals) });
}

/**
 * Query keys of everything derived from logged records. Goals, the dashboard and
 * insights depend on all of them, so any change invalidates the whole set — a
 * logged meal, workout, run or routine updates every goal immediately.
 */
export const DATA_KEYS = [
  "day",
  "meal",
  "weights",
  "analytics",
  "history",
  "recent-meals",
  "saved-meals",
  "today",
  "goals",
  "goal",
  "insights",
  "training",
  "workouts",
  "workout",
  "exercises",
  "exercise",
  "records",
  "training-analytics",
  "templates",
  "runs",
  "vitals",
  "connections",
  "routine",
  "routine-stats",
  "mobility",
  "journal",
  "routine-templates",
];

/** Invalidate everything derived from records after a change. */
export function useInvalidateData() {
  const qc = useQueryClient();
  return () => Promise.all(DATA_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

const keep = <T,>(prev: T | undefined) => prev;

export function useToday(date: string | null) {
  return useQuery({ queryKey: ["today", date], queryFn: () => api.get<TodayJ>(`/api/today${date ? `?date=${date}` : ""}`), placeholderData: keep });
}

export function useGoals() {
  return useQuery({ queryKey: ["goals"], queryFn: () => api.get<{ today: string; goals: GoalJ2[] }>("/api/user-goals"), placeholderData: keep });
}

export function useGoal(id: string) {
  return useQuery({ queryKey: ["goal", id], queryFn: () => api.get<{ today: string; goal: GoalJ2 }>(`/api/user-goals/${encodeURIComponent(id)}`) });
}

export function useInsights(days = 30) {
  return useQuery({ queryKey: ["insights", days], queryFn: () => api.get<InsightsJ>(`/api/insights?days=${days}`), placeholderData: keep, staleTime: 60_000 });
}

export function useTrainingOverview() {
  return useQuery({ queryKey: ["training", "overview"], queryFn: () => api.get<TrainingOverviewJ>("/api/training/overview"), placeholderData: keep });
}

export function useWorkouts(qs = "") {
  return useQuery({ queryKey: ["workouts", qs], queryFn: () => api.get<{ workouts: WorkoutSummaryJ[] }>(`/api/workouts${qs ? `?${qs}` : ""}`).then((r) => r.workouts), placeholderData: keep });
}

export function useWorkout(id: string) {
  return useQuery({ queryKey: ["workout", id], queryFn: () => api.get<{ workout: WorkoutDetailJ }>(`/api/workouts/${encodeURIComponent(id)}`).then((r) => r.workout), refetchOnWindowFocus: false });
}

export function useExercises() {
  return useQuery({ queryKey: ["exercises"], queryFn: () => api.get<{ exercises: ExerciseListItemJ[] }>("/api/exercises").then((r) => r.exercises), staleTime: 60_000 });
}

export function useExercise(id: string) {
  return useQuery({ queryKey: ["exercise", id], queryFn: () => api.get<ExerciseDetailJ>(`/api/exercises/${encodeURIComponent(id)}`) });
}

export function useRecords(qs: string) {
  return useQuery({ queryKey: ["records", qs], queryFn: () => api.get<RecordsJ>(`/api/training/records?${qs}`), placeholderData: keep });
}

export function useTrainingAnalytics(qs: string) {
  return useQuery({ queryKey: ["training-analytics", qs], queryFn: () => api.get<TrainingAnalyticsJ>(`/api/training/analytics?${qs}`), placeholderData: keep });
}

export function useTemplates() {
  return useQuery({ queryKey: ["templates"], queryFn: () => api.get<{ templates: WorkoutTemplateJ[] }>("/api/workout-templates").then((r) => r.templates) });
}

export function useRuns(qs: string) {
  return useQuery({ queryKey: ["runs", qs], queryFn: () => api.get<RunningJ>(`/api/runs?${qs}`), placeholderData: keep });
}

export function useVitals(qs: string) {
  return useQuery({ queryKey: ["vitals", qs], queryFn: () => api.get<VitalsJ>(`/api/vitals?${qs}`), placeholderData: keep });
}

export function useConnections() {
  return useQuery({ queryKey: ["connections"], queryFn: () => api.get<{ connections: ConnectionJ[] }>("/api/vitals/connections").then((r) => r.connections) });
}

export function useRoutine(slot: "morning" | "night", date: string | null) {
  return useQuery({ queryKey: ["routine", slot, date], queryFn: () => api.get<RoutineDayJ>(`/api/routines/${slot}${date ? `?date=${date}` : ""}`), placeholderData: keep });
}

export function useRoutineStats(qs: string) {
  return useQuery({ queryKey: ["routine-stats", qs], queryFn: () => api.get<RoutineStatsJ>(`/api/routines/stats?${qs}`), placeholderData: keep });
}

export function useRoutineTemplates(slot: "morning" | "night") {
  return useQuery({ queryKey: ["routine-templates", slot], queryFn: () => api.get<{ templates: RoutineTemplateJ[] }>(`/api/routines/${slot}/templates`).then((r) => r.templates) });
}

export function useMobility() {
  return useQuery({ queryKey: ["mobility"], queryFn: () => api.get<{ routines: MobilityRoutineJ[] }>("/api/mobility").then((r) => r.routines) });
}

export function useJournal(qs: string) {
  return useQuery({ queryKey: ["journal", qs], queryFn: () => api.get<{ entries: JournalEntryJ[] }>(`/api/journal?${qs}`).then((r) => r.entries), placeholderData: keep });
}
