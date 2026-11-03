import type { HealthMetric } from "../db/schema";

export interface HealthMetricDef {
  key: HealthMetric;
  label: string;
  unit: string;
  /** Plausible range for one day's value; anything outside is rejected, never clamped. */
  min: number;
  max: number;
  /** How several days combine into a weekly/monthly figure. */
  aggregate: "sum" | "avg";
  description: string;
}

export const HEALTH_METRICS: HealthMetricDef[] = [
  { key: "steps", label: "Steps", unit: "steps", min: 0, max: 200_000, aggregate: "sum", description: "Daily step count from your phone and watch." },
  { key: "sleep", label: "Sleep", unit: "min", min: 0, max: 1_200, aggregate: "avg", description: "Time asleep for the night ending on that day, with stages when your device records them." },
  {
    key: "sleep_score",
    label: "Sleep score",
    unit: "score",
    min: 0,
    max: 100,
    aggregate: "avg",
    description: "Only stored when a connected device or app supplies its own score (e.g. Oura, Fitbit, Garmin, Whoop). The app never calculates one.",
  },
  { key: "resting_hr", label: "Resting heart rate", unit: "bpm", min: 20, max: 250, aggregate: "avg", description: "Resting heart rate as measured by your watch." },
  { key: "hrv", label: "Heart rate variability", unit: "ms", min: 1, max: 500, aggregate: "avg", description: "HRV (SDNN on Apple Watch)." },
  { key: "active_energy", label: "Active energy", unit: "kcal", min: 0, max: 20_000, aggregate: "sum", description: "Active calories burned as estimated by your device." },
];

export const HEALTH_METRIC_KEYS = HEALTH_METRICS.map((m) => m.key);
export const HEALTH_METRIC_BY_KEY = Object.fromEntries(HEALTH_METRICS.map((m) => [m.key, m])) as Record<HealthMetric, HealthMetricDef>;

export function formatSleepMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return m === 60 ? `${h + 1}h 0m` : `${h}h ${m}m`;
}
