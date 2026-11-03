/**
 * Pure goal evaluation: splits a goal's life into periods, aggregates daily
 * values, judges each period against the target that applied at the time, and
 * derives streaks. Paused spans and planned rest days are excused, never failed.
 */
import type { GoalComparator, GoalPeriod, GoalTargetVersion } from "../db/schema";
import { addDays, addMonths, diffDays, eachDate, maxDate, minDate, startOfMonth, startOfWeek, type LocalDate } from "../time";
import type { Aggregation } from "./catalog";

export interface GoalSpec {
  metric: string;
  comparator: GoalComparator;
  targetValue: number;
  targetMax: number | null;
  period: GoalPeriod;
  periodDays: number | null;
  startDate: LocalDate;
  endDate: LocalDate | null;
  pauses: { from: LocalDate; to: LocalDate | null }[];
  targetHistory: GoalTargetVersion[];
  aggregation: Aggregation;
  /** For "count" aggregation on measured metrics: the daily value that makes a day count. */
  dailyThreshold?: number | null;
  dailyComparator?: "at_least" | "at_most";
}

export interface EvalContext {
  today: LocalDate;
  weekStartsOn: number;
  /** Canonical daily value; null = no data that day. Event metrics return 0 on days without events. */
  daily: (date: LocalDate) => number | null;
  /** Planned rest/recovery days for goals that excuse them. */
  excused?: (date: LocalDate) => boolean;
  /** Share of eligible days that qualified, for "pct" goals. */
  pct?: (start: LocalDate, end: LocalDate) => { value: number | null; eligible: number };
  /** Trend per week ending on a date, for "rate" goals. */
  rate?: (end: LocalDate) => number | null;
}

/**
 * "not_reached" is used for reach-a-level goals (target weight, a lift milestone):
 * a day before the target is reached isn't a failure, it's progress not yet done.
 */
export type PeriodStatus = "met" | "missed" | "in_progress" | "excused" | "paused" | "no_data" | "upcoming" | "not_reached";

export interface PeriodResult {
  start: LocalDate;
  end: LocalDate;
  value: number | null;
  target: number;
  targetMax: number | null;
  status: PeriodStatus;
  /** For the current period: whether the value meets the target right now. */
  meetsNow: boolean;
  daysElapsed: number;
  daysTotal: number;
  daysWithData: number;
  /** Straight-line projection to the end of a current sum/count period (an estimate). */
  projected: number | null;
}

export function isPaused(spec: Pick<GoalSpec, "pauses">, date: LocalDate): boolean {
  return spec.pauses.some((p) => p.from <= date && (p.to == null || p.to >= date));
}

/** The target in force on a date (versions apply from their `from` date). */
export function targetOn(spec: Pick<GoalSpec, "targetHistory" | "targetValue" | "targetMax">, date: LocalDate): { value: number; max: number | null } {
  const versions = [...spec.targetHistory].sort((a, b) => a.from.localeCompare(b.from));
  let found: GoalTargetVersion | null = null;
  for (const v of versions) {
    if (v.from <= date) found = v;
    else break;
  }
  const v = found ?? versions[0];
  return v ? { value: v.value, max: v.max } : { value: spec.targetValue, max: spec.targetMax };
}

export function compare(value: number | null, comparator: GoalComparator, target: number, max: number | null): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  const eps = 1e-9;
  if (comparator === "at_least") return value >= target - eps;
  if (comparator === "at_most") return value <= target + eps;
  const lo = Math.min(target, max ?? target);
  const hi = Math.max(target, max ?? target);
  return value >= lo - eps && value <= hi + eps;
}

/** All period windows from the goal's start through today (or its end date), newest last. */
export function periodsFor(spec: Pick<GoalSpec, "period" | "periodDays" | "startDate" | "endDate">, today: LocalDate, weekStartsOn: number, maxDays = 366): { start: LocalDate; end: LocalDate }[] {
  const last = spec.endDate ? minDate(spec.endDate, today) : today;
  const first = maxDate(spec.startDate, addDays(last, -(maxDays - 1)));
  if (first > last) return [];
  const out: { start: LocalDate; end: LocalDate }[] = [];
  if (spec.period === "daily") {
    for (const d of eachDate(first, last)) out.push({ start: d, end: d });
    return out;
  }
  if (spec.period === "weekly") {
    for (let s = startOfWeek(first, weekStartsOn); s <= last; s = addDays(s, 7)) out.push({ start: s, end: addDays(s, 6) });
    return out;
  }
  if (spec.period === "monthly") {
    for (let s = startOfMonth(first); s <= last; s = addMonths(s, 1)) out.push({ start: s, end: addDays(addMonths(s, 1), -1) });
    return out;
  }
  const n = Math.max(1, spec.periodDays ?? 7);
  // Custom periods are anchored on the start date.
  const offset = Math.floor(diffDays(spec.startDate, first) / n);
  for (let s = addDays(spec.startDate, offset * n); s <= last; s = addDays(s, n)) out.push({ start: s, end: addDays(s, n - 1) });
  return out;
}

function aggregate(spec: GoalSpec, ctx: EvalContext, days: LocalDate[]): { value: number | null; withData: number } {
  if (spec.aggregation === "pct") {
    if (!days.length || !ctx.pct) return { value: null, withData: 0 };
    const r = ctx.pct(days[0], days[days.length - 1]);
    return { value: r.value, withData: r.eligible };
  }
  if (spec.aggregation === "rate") {
    if (!days.length || !ctx.rate) return { value: null, withData: 0 };
    const v = ctx.rate(days[days.length - 1]);
    return { value: v, withData: v == null ? 0 : 1 };
  }
  const vals = days.map((d) => ctx.daily(d));
  const known = vals.filter((v): v is number => v != null);
  switch (spec.aggregation) {
    case "sum":
      return { value: known.length ? known.reduce((a, b) => a + b, 0) : null, withData: known.length };
    case "avg":
      return { value: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null, withData: known.length };
    case "count": {
      const thr = spec.dailyThreshold ?? 1;
      const cmp = spec.dailyComparator ?? "at_least";
      return { value: known.filter((v) => (cmp === "at_least" ? v >= thr : v <= thr)).length, withData: known.length };
    }
    case "level": {
      for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return { value: vals[i], withData: known.length };
      return { value: null, withData: 0 };
    }
  }
  return { value: null, withData: 0 };
}

export function evaluatePeriod(spec: GoalSpec, p: { start: LocalDate; end: LocalDate }, ctx: EvalContext): PeriodResult {
  const target = targetOn(spec, maxDate(p.start, spec.startDate));
  const total = diffDays(p.start, p.end) + 1;
  const lastDay = minDate(p.end, spec.endDate ? minDate(spec.endDate, ctx.today) : ctx.today);
  const firstDay = maxDate(p.start, spec.startDate);
  const base = { start: p.start, end: p.end, target: target.value, targetMax: target.max, daysTotal: total };
  if (firstDay > lastDay) return { ...base, value: null, status: "upcoming", meetsNow: false, daysElapsed: 0, daysWithData: 0, projected: null };
  const allDays = eachDate(firstDay, lastDay);
  const active = allDays.filter((d) => !isPaused(spec, d));
  if (!active.length) return { ...base, value: null, status: "paused", meetsNow: false, daysElapsed: allDays.length, daysWithData: 0, projected: null };
  const counted = ctx.excused ? active.filter((d) => !ctx.excused!(d)) : active;
  if (!counted.length) return { ...base, value: null, status: "excused", meetsNow: false, daysElapsed: allDays.length, daysWithData: 0, projected: null };
  // Level and rate goals look at the whole window; others only at counted days.
  const { value, withData } = aggregate(spec, ctx, spec.aggregation === "level" || spec.aggregation === "rate" ? active : counted);
  const meets = compare(value, spec.comparator, target.value, target.max);
  const isCurrent = p.end >= ctx.today && (!spec.endDate || spec.endDate >= ctx.today);
  let status: PeriodStatus;
  if (isCurrent) {
    // A running total that already reached an "at least" target can't fall back below it.
    const final = meets && spec.comparator === "at_least" && (spec.aggregation === "sum" || spec.aggregation === "count");
    status = final || (meets && spec.period === "daily" && spec.comparator === "at_least") ? "met" : "in_progress";
  } else if (value == null) status = "no_data";
  else status = meets ? "met" : spec.aggregation === "level" ? "not_reached" : "missed";
  let projected: number | null = null;
  if (isCurrent && value != null && (spec.aggregation === "sum" || spec.aggregation === "count") && spec.period !== "daily") {
    const elapsed = counted.length;
    const remainingDays = diffDays(lastDay, p.end);
    projected = elapsed > 0 ? value + (value / elapsed) * remainingDays : null;
  }
  return { ...base, value, status, meetsNow: meets, daysElapsed: allDays.length, daysWithData: withData, projected };
}

export interface GoalEvaluation {
  periods: PeriodResult[];
  current: PeriodResult | null;
  streak: { current: number; best: number; unit: "days" | "weeks" | "months" | "periods" };
  /** Met periods ÷ judged periods (met + missed + no data), excluding the current one. */
  successRate: number | null;
  judged: number;
  met: number;
}

export function evaluateGoal(spec: GoalSpec, ctx: EvalContext, maxDays = 366): GoalEvaluation {
  const periods = periodsFor(spec, ctx.today, ctx.weekStartsOn, maxDays).map((p) => evaluatePeriod(spec, p, ctx));
  const current = periods.length && periods[periods.length - 1].end >= ctx.today ? periods[periods.length - 1] : null;
  const skip = (s: PeriodStatus) => s === "excused" || s === "paused" || s === "upcoming";
  let cur = 0;
  for (let i = periods.length - 1; i >= 0; i--) {
    const s = periods[i].status;
    if (s === "met") cur += 1;
    else if (skip(s) || s === "in_progress") continue;
    else break;
  }
  let best = 0;
  let run = 0;
  for (const p of periods) {
    if (p.status === "met") best = Math.max(best, ++run);
    else if (skip(p.status) || p.status === "in_progress") continue;
    else run = 0;
  }
  // Reach goals have no success rate: every day before the milestone would otherwise count as a miss.
  const past = spec.aggregation === "level" ? [] : periods.filter((p) => p !== current && (p.status === "met" || p.status === "missed" || p.status === "no_data"));
  const met = past.filter((p) => p.status === "met").length;
  const unit = spec.period === "daily" ? "days" : spec.period === "weekly" ? "weeks" : spec.period === "monthly" ? "months" : "periods";
  return { periods, current, streak: { current: cur, best, unit }, successRate: past.length ? met / past.length : null, judged: past.length, met };
}

/** Progress toward the target for display (0–1+). */
export function progressRatio(value: number | null, comparator: GoalComparator, target: number, max: number | null): number | null {
  if (value == null) return null;
  if (comparator === "at_least") return target > 0 ? value / target : value > 0 ? 1 : 0;
  if (comparator === "at_most") return target > 0 ? value / target : 0;
  const hi = Math.max(target, max ?? target);
  return hi > 0 ? value / hi : null;
}
