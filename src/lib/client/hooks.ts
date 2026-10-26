"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { AnalyticsJ, DaySummaryJ, HistoryDay, MealJ, SavedMealJ, SettingsResponse, WeightOverviewJ } from "./types";

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

/** Invalidate everything derived from food/weight records after a change. */
export function useInvalidateData() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ["day", "meal", "weights", "analytics", "history", "recent-meals", "saved-meals"].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
}
