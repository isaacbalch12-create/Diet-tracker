/** Display helpers shared by the strength-training screens (client-safe, pure). */
import { formatLocalDate } from "@/lib/time";
import type { PlateauStatus } from "@/lib/training/insights";
import type { RecordType } from "@/lib/training/records";
import type { Unit } from "@/lib/training/types";
import { compactNumber, formatLift, formatVolume } from "@/lib/training/units";

export const workoutHref = (id: string) => `/training/workouts/${encodeURIComponent(id)}`;
export const exerciseHref = (id: string) => `/training/exercises/${encodeURIComponent(id)}`;

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

/** Hard-set counts can be fractional (secondary muscles count half). */
export function fmtSets(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(n) ? 0 : 1 });
}

/** "+2.4%" / "−1.1%" / "0%" from a fraction. */
export function signedPct(fraction: number, decimals = 1): string {
  const v = Number((fraction * 100).toFixed(decimals));
  if (v === 0) return "0%";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: decimals })}%`;
}

export function dayLabel(date: string): string {
  return formatLocalDate(date, { weekday: "short", month: "short", day: "numeric" });
}

export function dayLabelWithYear(date: string): string {
  return formatLocalDate(date, { month: "short", day: "numeric", year: "numeric" });
}

export function monthTitle(monthKey: string): string {
  return formatLocalDate(`${monthKey}-01`, { month: "long", year: "numeric" });
}

/** Statistics use UTC-midnight day keys (plus a tiny same-day offset) as milliseconds. */
export function msToLocalDate(ms: number): string {
  return new Date(Math.floor(ms / 86_400_000) * 86_400_000).toISOString().slice(0, 10);
}

/** Most recently used first, never-used last, then by name (the API's DESC order puts never-used first). */
export function byLastUsed<T extends { lastUsedAt: string | null; name: string }>(a: T, b: T): number {
  if (a.lastUsedAt && b.lastUsedAt) return b.lastUsedAt.localeCompare(a.lastUsedAt) || a.name.localeCompare(b.name);
  if (a.lastUsedAt) return -1;
  if (b.lastUsedAt) return 1;
  return a.name.localeCompare(b.name);
}

export const PLATEAU_LABEL: Record<PlateauStatus, string> = {
  insufficient: "Not enough data",
  inactive: "Not trained lately",
  progressing: "Progressing",
  plateau: "Plateau",
  declining: "Declining",
};

export const PLATEAU_TONE: Record<PlateauStatus, "good" | "warning" | "critical" | "neutral" | "outline"> = {
  insufficient: "outline",
  inactive: "neutral",
  progressing: "good",
  plateau: "warning",
  declining: "critical",
};

export interface RecordLike {
  type: RecordType;
  value: number;
  previous: number | null;
  weightKg?: number;
  reps?: number;
  milestone?: { metric: "totalVolume" | "totalReps" | "workouts" | "exerciseVolume"; threshold: number; unit?: Unit };
  label: string;
  exerciseName?: string | null;
}

export const RECORD_TYPES: RecordType[] = ["weight", "e1rm", "reps", "sessionVolume", "workoutVolume", "beatLast", "milestone"];

export const RECORD_SHORT: Record<RecordType, string> = {
  weight: "Heaviest",
  e1rm: "Est. 1RM",
  reps: "Rep record",
  sessionVolume: "Exercise volume",
  workoutVolume: "Workout volume",
  beatLast: "Beat last",
  milestone: "Milestone",
};

function setText(e: RecordLike, unit: Unit): string {
  return e.weightKg != null && e.reps != null ? `${formatLift(e.weightKg, unit)} × ${e.reps}` : "";
}

function milestoneText(e: RecordLike): string {
  const m = e.milestone;
  if (!m) return compactNumber(e.value);
  if (m.metric === "workouts") return m.threshold === 1 ? "First workout logged" : `${m.threshold.toLocaleString("en-US")} workouts logged`;
  if (m.metric === "totalReps") return `${compactNumber(m.threshold)} lifetime reps`;
  if (m.metric === "totalVolume") return `${compactNumber(m.threshold)} ${m.unit ?? ""} lifted in total`.replace("  ", " ");
  return `${compactNumber(m.threshold)} ${m.unit ?? ""} lifted on this exercise`.replace("  ", " ");
}

/** The headline value of a record, in the display unit. */
export function recordValue(e: RecordLike, unit: Unit): string {
  switch (e.type) {
    case "weight":
      return `${formatLift(e.value, unit)}${e.reps != null ? ` × ${e.reps}` : ""}`;
    case "e1rm":
      return `${formatLift(e.value, unit)} est.`;
    case "reps":
      return `${e.value} reps at ${formatLift(e.weightKg ?? null, unit)}`;
    case "sessionVolume":
    case "workoutVolume":
      return formatVolume(e.value, unit);
    case "beatLast":
      return `${formatLift(e.value, unit)} est. 1RM`;
    case "milestone":
      return milestoneText(e);
  }
}

/** Supporting detail: the set behind it and the previous best. */
export function recordDetail(e: RecordLike, unit: Unit): string {
  const parts: string[] = [];
  if (e.type === "e1rm" || e.type === "beatLast") {
    const s = setText(e, unit);
    if (s) parts.push(`from ${s}`);
  }
  if (e.previous != null) {
    if (e.type === "reps") parts.push(`previous best ${e.previous} reps`);
    else if (e.type === "sessionVolume" || e.type === "workoutVolume") parts.push(`previous best ${formatVolume(e.previous, unit)}`);
    else if (e.type === "beatLast") parts.push(`last session ${formatLift(e.previous, unit)}`);
    else parts.push(`previous best ${formatLift(e.previous, unit)}`);
  }
  return parts.join(" · ");
}

/** "New record: Bench Press — heaviest weight 225 lb". */
export function celebrationText(e: RecordLike, unit: Unit): string {
  const who = e.exerciseName ? `${e.exerciseName} — ` : "";
  switch (e.type) {
    case "weight":
      return `New record: ${who}heaviest weight ${formatLift(e.value, unit)}`;
    case "e1rm":
      return `New record: ${who}best estimated 1RM ${formatLift(e.value, unit)}`;
    case "reps":
      return `New record: ${who}${e.value} reps at ${formatLift(e.weightKg ?? null, unit)}`;
    case "sessionVolume":
      return `New record: ${who}most volume in a session ${formatVolume(e.value, unit)}`;
    case "workoutVolume":
      return `New record: biggest workout by volume ${formatVolume(e.value, unit)}`;
    case "beatLast":
      return `${who}beat last session (${formatLift(e.value, unit)} est. 1RM)`;
    case "milestone":
      return `Milestone: ${milestoneText(e)}`;
  }
}
