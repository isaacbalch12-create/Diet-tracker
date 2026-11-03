/** Types, parsers and formatters for the health (steps & sleep) screens. Client-safe. */
import type { ConnectionJ, GoalJ2, VitalsJ } from "@/lib/client/types";
import { fmtNum } from "@/lib/client/units";
import { formatSleepMinutes, HEALTH_METRICS } from "@/lib/health/metrics";

export type MetricKey = "steps" | "sleep" | "sleep_score" | "resting_hr" | "hrv" | "active_energy";
export type MetricJ = VitalsJ["metrics"][string];
export type DayJ = MetricJ["days"][number];
export type ValueDay = Extract<DayJ, { value: number }>;
export type SyncEventJ = ConnectionJ["recentEvents"][number];

export const METRIC_KEYS: MetricKey[] = ["steps", "sleep", "sleep_score", "resting_hr", "hrv", "active_energy"];
export const METRIC_LABEL: Record<MetricKey, string> = Object.fromEntries(HEALTH_METRICS.map((m) => [m.key, m.label])) as Record<MetricKey, string>;
/** Metrics that can be entered by hand (sleep scores only come from a device/app). */
export const MANUAL_METRICS: MetricKey[] = ["steps", "sleep", "resting_hr", "hrv", "active_energy"];

export const HEALTH_COLORS = {
  steps: "var(--series-1)",
  sleep: "var(--series-cal)",
  score: "var(--series-cal)",
  resting_hr: "var(--series-2)",
  hrv: "var(--series-3)",
  active_energy: "var(--series-2)",
  deep: "var(--series-1)",
  core: "var(--series-3)",
  rem: "var(--series-cal)",
  unstaged: "var(--muted)",
  awake: "var(--series-2)",
} as const;

export function metricOf(v: VitalsJ | undefined, k: MetricKey): MetricJ | null {
  return v?.metrics[k] ?? null;
}

export function hasValue(d: DayJ): d is ValueDay {
  return d.value !== null;
}

export function fmtMetric(k: MetricKey, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (k) {
    case "steps":
      return fmtNum(v, 0);
    case "sleep":
      return formatSleepMinutes(v);
    case "sleep_score":
      return fmtNum(v, 0);
    case "resting_hr":
      return `${fmtNum(v, 0)} bpm`;
    case "hrv":
      return `${fmtNum(v, 0)} ms`;
    case "active_energy":
      return `${fmtNum(v, 0)} kcal`;
  }
}

/** Linear trend: change in the daily value per week, signed (e.g. "+250 steps/wk"). */
export function fmtTrend(k: MetricKey, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  const abs = Math.abs(v);
  const body = k === "sleep" ? `${Math.round(abs)} min` : k === "steps" ? `${fmtNum(abs, 0)} steps` : k === "sleep_score" ? `${fmtNum(abs, 1)} pts` : fmtMetric(k, abs);
  return `${sign}${body}/wk`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export interface SleepStages {
  deep: number | null;
  rem: number | null;
  core: number | null;
  awake: number | null;
  unspecified: number | null;
}

export interface SleepInfo {
  inBedMinutes: number | null;
  stages: SleepStages | null;
  start: string | null;
  end: string | null;
  origins: string[];
}

/** Sleep `details` as stored by the server (shape checked at runtime). */
export function sleepInfo(details: unknown): SleepInfo | null {
  if (!isObj(details)) return null;
  const st = isObj(details.stages) ? details.stages : null;
  const stages: SleepStages | null = st ? { deep: numOrNull(st.deep), rem: numOrNull(st.rem), core: numOrNull(st.core), awake: numOrNull(st.awake), unspecified: numOrNull(st.unspecified) } : null;
  const hasStages = !!stages && (stages.deep != null || stages.rem != null || stages.core != null);
  return {
    inBedMinutes: numOrNull(details.inBedMinutes),
    stages: hasStages ? stages : null,
    start: strOrNull(details.start),
    end: strOrNull(details.end),
    origins: Array.isArray(details.origins) ? details.origins.filter((o): o is string => typeof o === "string") : [],
  };
}

/** The device/app that calculated a sleep score. */
export function scoreProvider(d: ValueDay): string | null {
  const details: unknown = d.details;
  if (isObj(details) && typeof details.provider === "string") return details.provider;
  return d.origin ?? null;
}

/** "Apple Health (iOS Shortcut) · My iPhone · Apple Watch" */
export function sourceText(d: ValueDay): string {
  return [d.sourceLabel, d.origin].filter(Boolean).join(" · ");
}

/** Trailing 7-day mean over days with data; needs at least 3 values in the window. */
export function rolling7(days: DayJ[]): (number | null)[] {
  return days.map((_, i) => {
    const vals = days
      .slice(Math.max(0, i - 6), i + 1)
      .map((d) => d.value)
      .filter((v): v is number => v != null);
    return vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
}

/** The newest day with a value, if any. */
export function latest(m: MetricJ | null): ValueDay | null {
  if (!m) return null;
  for (let i = m.days.length - 1; i >= 0; i--) {
    const d = m.days[i];
    if (hasValue(d)) return d;
  }
  return null;
}

export function dayValue(m: MetricJ | null, date: string): ValueDay | null {
  const d = m?.days.find((x) => x.date === date);
  return d && hasValue(d) ? d : null;
}

/** An active daily "at least" goal on a health metric (steps, sleep_duration, sleep_score). */
export function dailyGoal(goals: GoalJ2[] | undefined, metric: "steps" | "sleep_duration" | "sleep_score"): GoalJ2 | null {
  return (goals ?? []).find((g) => g.status === "active" && g.metric === metric && g.period === "daily" && g.comparator !== "at_most") ?? null;
}

export interface EventSummary {
  format: string | null;
  accepted: number | null;
  byMetric: { metric: string; count: number }[];
  days: string[];
  ignored: { item: string; reason: string }[];
}

/** Sync event summaries are stored as free-form JSON; read them defensively. */
export function eventSummary(summary: unknown): EventSummary {
  const s = isObj(summary) ? summary : {};
  const byMetric = isObj(s.byMetric) ? Object.entries(s.byMetric).filter((e): e is [string, number] => typeof e[1] === "number").map(([metric, count]) => ({ metric, count })) : [];
  const ignored = Array.isArray(s.ignored) ? s.ignored.filter(isObj).map((x) => ({ item: String(x.item ?? ""), reason: String(x.reason ?? "") })) : [];
  return {
    format: strOrNull(s.format),
    accepted: numOrNull(s.accepted),
    byMetric,
    days: Array.isArray(s.days) ? s.days.filter((d): d is string => typeof d === "string") : [],
    ignored,
  };
}

export function metricName(k: string): string {
  return (METRIC_LABEL as Record<string, string>)[k] ?? k;
}

/** Hours since an ISO instant (null when missing). */
export function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export const FORMAT_LABEL: Record<string, string> = { native: "App JSON", health_auto_export: "Health Auto Export JSON" };
