/** Shared types, labels and colors for the running screens (client-safe). */
import type { RunningJ, SettingsJ } from "@/lib/client/types";
import type { UnitPrefs } from "@/lib/client/units";
import { fromMeters, type DistanceUnit } from "@/lib/running/stats";

export type RunEntryJ = RunningJ["entries"][number];
export type RunDayJ = RunningJ["days"][number];
export type RunStatus = RunDayJ["status"];

export const RUN_COLOR = "var(--series-3)";

export interface StatusMeta {
  label: string;
  /** Badge tone in components/ui.tsx. */
  tone: "neutral" | "accent" | "good" | "warning" | "critical" | "outline";
  /** Cell fill for the calendar. */
  fill: string;
  /** Extra classes for the calendar cell (borders for light fills). */
  cell: string;
}

export const STATUS_META: Record<RunStatus, StatusMeta> = {
  done: { label: "Ran", tone: "good", fill: RUN_COLOR, cell: "" },
  short: { label: "Below minimum", tone: "warning", fill: "var(--warning)", cell: "" },
  rest: { label: "Rest day", tone: "neutral", fill: "var(--surface-3)", cell: "border border-line-strong" },
  recovery: { label: "Recovery day", tone: "accent", fill: "var(--accent-soft)", cell: "border border-accent/60" },
  missed: { label: "Missed", tone: "critical", fill: "color-mix(in srgb, var(--critical) 55%, transparent)", cell: "" },
  pending: { label: "Not logged yet", tone: "outline", fill: "transparent", cell: "border border-dashed border-line-strong" },
};

/** Perceived effort, 1 (very easy) to 10 (max). */
export const EFFORT_LABELS: Record<number, string> = {
  1: "Very easy",
  2: "Easy",
  3: "Easy",
  4: "Comfortable",
  5: "Moderate",
  6: "Somewhat hard",
  7: "Hard",
  8: "Very hard",
  9: "Very hard",
  10: "Max effort",
};

export function effortText(e: number | null | undefined): string | null {
  if (e == null) return null;
  return `Effort ${e}/10 · ${EFFORT_LABELS[e] ?? ""}`.trim();
}

export function unitPrefs(s: SettingsJ): UnitPrefs {
  return { weightUnit: s.weightUnit, distanceUnit: s.distanceUnit, waterUnit: s.waterUnit };
}

/** Meters → number in the display unit, rounded for charts. */
export function distIn(m: number | null | undefined, unit: DistanceUnit): number | null {
  if (m == null || !Number.isFinite(m)) return null;
  return Math.round(fromMeters(m, unit) * 100) / 100;
}

export const RUN_GOAL_METRICS = ["run_completed", "run_distance", "run_days", "run_consistency"] as const;

export function isRunGoalMetric(m: string): boolean {
  return (RUN_GOAL_METRICS as readonly string[]).includes(m);
}
