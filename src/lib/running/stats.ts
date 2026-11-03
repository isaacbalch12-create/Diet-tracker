/**
 * Daily running: consistency and distance. No duration, pace or timers.
 *
 * Day statuses:
 * - done:     a run was logged (and met the minimum distance, when one is set and
 *             the run has a distance — a run logged without distance counts as done)
 * - short:    runs were logged but their total distance is below the minimum
 * - rest / recovery: a planned day off. It never breaks a streak and is excluded
 *             from consistency percentages, so recovery is never treated as failure.
 * - missed:   a past day with nothing logged
 * - pending:  today, not logged yet (never breaks a streak while the day is open)
 */
import { addDays, eachDate, maxDate, startOfMonth, startOfWeek, type LocalDate } from "../time";

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_KM = 1000;

export type DistanceUnit = "mi" | "km";

export function toMeters(value: number, unit: DistanceUnit): number {
  return unit === "mi" ? value * METERS_PER_MILE : value * METERS_PER_KM;
}

export function fromMeters(m: number, unit: DistanceUnit): number {
  return unit === "mi" ? m / METERS_PER_MILE : m / METERS_PER_KM;
}

export function formatDistance(m: number | null | undefined, unit: DistanceUnit, decimals = 2): string {
  if (m == null || !Number.isFinite(m)) return "—";
  const v = fromMeters(m, unit);
  return `${v.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: 0 })} ${unit}`;
}

export interface RunLike {
  id: string;
  localDate: LocalDate;
  kind: "run" | "rest" | "recovery";
  distanceM: number | null;
  effort: number | null;
  runType: string | null;
}

export type RunDayStatus = "done" | "short" | "rest" | "recovery" | "missed" | "pending";

export interface RunDay {
  date: LocalDate;
  status: RunDayStatus;
  distanceM: number;
  runs: number;
  /** Whether any run that day had a recorded distance. */
  hasDistance: boolean;
  maxEffort: number | null;
}

export function classifyDays(entries: RunLike[], start: LocalDate, end: LocalDate, today: LocalDate, minDistanceM: number | null): RunDay[] {
  const byDate = new Map<LocalDate, RunLike[]>();
  for (const e of entries) {
    if (e.localDate < start || e.localDate > end) continue;
    const list = byDate.get(e.localDate) ?? [];
    list.push(e);
    byDate.set(e.localDate, list);
  }
  return eachDate(start, end).map((date) => {
    const list = byDate.get(date) ?? [];
    const runs = list.filter((e) => e.kind === "run");
    const off = list.find((e) => e.kind !== "run");
    const distanceM = runs.reduce((a, r) => a + (r.distanceM ?? 0), 0);
    const hasDistance = runs.some((r) => r.distanceM != null);
    const efforts = runs.map((r) => r.effort).filter((x): x is number => x != null);
    let status: RunDayStatus;
    if (runs.length) status = minDistanceM && hasDistance && distanceM < minDistanceM ? "short" : "done";
    else if (off) status = off.kind as "rest" | "recovery";
    else status = date >= today ? "pending" : "missed";
    return { date, status, distanceM, runs: runs.length, hasDistance, maxEffort: efforts.length ? Math.max(...efforts) : null };
  });
}

export interface RunStreaks {
  current: number;
  longest: number;
  /** Consecutive days (ending today/yesterday) with a run and no rest or recovery day. */
  daysWithoutRest: number;
}

/** Streaks count run days; rest and recovery days are skipped (neither break nor extend). */
export function runStreaks(days: RunDay[]): RunStreaks {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    if (d.status === "done") {
      run += 1;
      longest = Math.max(longest, run);
    } else if (d.status === "rest" || d.status === "recovery" || d.status === "pending") {
      continue;
    } else {
      run = 0;
    }
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const s = days[i].status;
    if (s === "done") current += 1;
    else if (s === "rest" || s === "recovery" || s === "pending") continue;
    else break;
  }
  let daysWithoutRest = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const s = days[i].status;
    if (s === "pending") continue;
    if (s === "done" || s === "short") daysWithoutRest += 1;
    else break;
  }
  return { current, longest, daysWithoutRest };
}

export interface Consistency {
  done: number;
  short: number;
  missed: number;
  rest: number;
  recovery: number;
  /** Days that count: past or completed days that were not planned days off. */
  eligible: number;
  pct: number | null;
}

export function consistency(days: RunDay[]): Consistency {
  const c = { done: 0, short: 0, missed: 0, rest: 0, recovery: 0 };
  for (const d of days) if (d.status !== "pending") c[d.status] += 1;
  const eligible = c.done + c.short + c.missed;
  return { ...c, eligible, pct: eligible ? c.done / eligible : null };
}

export interface DistanceBucket {
  start: LocalDate;
  distanceM: number;
  runs: number;
  runDays: number;
}

export function bucketDistance(days: RunDay[], period: "week" | "month", weekStartsOn: number): DistanceBucket[] {
  const map = new Map<LocalDate, DistanceBucket>();
  for (const d of days) {
    const key = period === "week" ? startOfWeek(d.date, weekStartsOn) : startOfMonth(d.date);
    const b = map.get(key) ?? { start: key, distanceM: 0, runs: 0, runDays: 0 };
    b.distanceM += d.distanceM;
    b.runs += d.runs;
    if (d.status === "done" || d.status === "short") b.runDays += 1;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export interface RunOverview {
  days: RunDay[];
  streaks: RunStreaks;
  consistency: Consistency;
  totals: { distanceM: number; runs: number; runDays: number; avgDistanceM: number | null; avgEffort: number | null };
  weekly: DistanceBucket[];
  monthly: DistanceBucket[];
  records: { longestRun: { distanceM: number; date: LocalDate } | null; bestWeek: DistanceBucket | null; bestMonth: DistanceBucket | null; longestStreak: number };
  byType: { type: string; runs: number; distanceM: number }[];
}

/**
 * Overview for a range. `trackingStart` (first logged entry or goal start) keeps
 * days before you started from counting as missed.
 */
export function runOverview(
  entries: RunLike[],
  range: { start: LocalDate; end: LocalDate },
  today: LocalDate,
  opts: { minDistanceM: number | null; weekStartsOn: number; trackingStart: LocalDate | null },
): RunOverview {
  const effectiveStart = opts.trackingStart ? maxDate(range.start, opts.trackingStart) : range.start;
  const start = effectiveStart > range.end ? range.end : effectiveStart;
  const days = classifyDays(entries, start, range.end, today, opts.minDistanceM);
  // Streaks look at all history up to the end of the range.
  const historyStart = opts.trackingStart ?? (entries.length ? entries.reduce((m, e) => (e.localDate < m ? e.localDate : m), entries[0].localDate) : start);
  const fullDays = historyStart <= range.end ? classifyDays(entries, historyStart, range.end, today, opts.minDistanceM) : days;
  const runs = entries.filter((e) => e.kind === "run" && e.localDate >= start && e.localDate <= range.end);
  const withDist = runs.filter((r) => r.distanceM != null);
  const efforts = runs.map((r) => r.effort).filter((x): x is number => x != null);
  const weekly = bucketDistance(days, "week", opts.weekStartsOn);
  const monthly = bucketDistance(days, "month", opts.weekStartsOn);
  const allWeekly = bucketDistance(fullDays, "week", opts.weekStartsOn);
  const allMonthly = bucketDistance(fullDays, "month", opts.weekStartsOn);
  const allRuns = entries.filter((e) => e.kind === "run" && e.distanceM != null && e.localDate <= range.end);
  const longest = allRuns.reduce<RunLike | null>((best, r) => (!best || (r.distanceM ?? 0) > (best.distanceM ?? 0) ? r : best), null);
  const typeMap = new Map<string, { runs: number; distanceM: number }>();
  for (const r of runs) {
    const t = r.runType ?? "Unspecified";
    const v = typeMap.get(t) ?? { runs: 0, distanceM: 0 };
    v.runs += 1;
    v.distanceM += r.distanceM ?? 0;
    typeMap.set(t, v);
  }
  const streaks = runStreaks(fullDays);
  return {
    days,
    streaks,
    consistency: consistency(days),
    totals: {
      distanceM: runs.reduce((a, r) => a + (r.distanceM ?? 0), 0),
      runs: runs.length,
      runDays: days.filter((d) => d.status === "done" || d.status === "short").length,
      avgDistanceM: withDist.length ? withDist.reduce((a, r) => a + (r.distanceM ?? 0), 0) / withDist.length : null,
      avgEffort: efforts.length ? efforts.reduce((a, b) => a + b, 0) / efforts.length : null,
    },
    weekly,
    monthly,
    records: {
      longestRun: longest && longest.distanceM ? { distanceM: longest.distanceM, date: longest.localDate } : null,
      bestWeek: allWeekly.reduce<DistanceBucket | null>((b, w) => (w.distanceM > 0 && (!b || w.distanceM > b.distanceM) ? w : b), null),
      bestMonth: allMonthly.reduce<DistanceBucket | null>((b, w) => (w.distanceM > 0 && (!b || w.distanceM > b.distanceM) ? w : b), null),
      longestStreak: streaks.longest,
    },
    byType: [...typeMap.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.runs - a.runs),
  };
}

/** Range helper: the N days ending on `end`. */
export function lastDays(end: LocalDate, n: number): { start: LocalDate; end: LocalDate } {
  return { start: addDays(end, -(n - 1)), end };
}
