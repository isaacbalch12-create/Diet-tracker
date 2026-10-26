/**
 * Weight statistics. Definitions (kept consistent across every chart and table):
 *
 * - Daily average: mean of that day's morning and night readings. If only one
 *   reading exists, it is used alone and the day is flagged `partial`.
 * - 7-day rolling average: mean of the daily averages over the trailing 7
 *   calendar days (inclusive), requiring at least 3 days with data.
 * - Weekly / monthly average: mean of the daily averages for days with data in
 *   that calendar week / month (days without data are skipped, never zero).
 * - Trend: least-squares line through daily averages over the selected range.
 */
import { addDays, diffDays, eachDate, type LocalDate, monthKey, startOfWeek } from "../time";

export interface WeightReading {
  localDate: LocalDate;
  period: "morning" | "night";
  weightKg: number;
}

export interface DailyWeight {
  date: LocalDate;
  morning: number | null;
  night: number | null;
  average: number | null;
  /** night − morning, when both exist. */
  fluctuation: number | null;
  partial: boolean;
}

export interface RollingPoint {
  date: LocalDate;
  value: number | null;
  days: number;
}

export interface PeriodAverage {
  key: string;
  start: LocalDate;
  end: LocalDate;
  average: number | null;
  days: number;
  morningAverage: number | null;
  nightAverage: number | null;
}

export interface Trend {
  slopePerDay: number;
  slopePerWeek: number;
  intercept: number;
  r2: number;
  n: number;
  startDate: LocalDate;
  /** Fitted value at a given date. */
  valueAt: (date: LocalDate) => number;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function buildDailyMap(readings: WeightReading[]): Map<LocalDate, DailyWeight> {
  const map = new Map<LocalDate, DailyWeight>();
  for (const r of readings) {
    const day = map.get(r.localDate) ?? { date: r.localDate, morning: null, night: null, average: null, fluctuation: null, partial: true };
    if (r.period === "morning") day.morning = r.weightKg;
    else day.night = r.weightKg;
    map.set(r.localDate, day);
  }
  for (const day of map.values()) finalizeDay(day);
  return map;
}

function finalizeDay(day: DailyWeight) {
  const vals = [day.morning, day.night].filter((v): v is number => v !== null);
  day.average = mean(vals);
  day.partial = vals.length < 2;
  day.fluctuation = day.morning !== null && day.night !== null ? day.night - day.morning : null;
}

/** One entry per calendar day in [start, end]; days without readings have nulls. */
export function dailySeries(readings: WeightReading[], start: LocalDate, end: LocalDate): DailyWeight[] {
  const map = buildDailyMap(readings);
  return eachDate(start, end).map(
    (date) => map.get(date) ?? { date, morning: null, night: null, average: null, fluctuation: null, partial: false },
  );
}

/**
 * Trailing rolling average of daily averages. `allDaily` should include days
 * before the visible range so the first points have full windows.
 */
export function rollingAverage(allDaily: Map<LocalDate, DailyWeight>, dates: LocalDate[], window = 7, minDays = 3): RollingPoint[] {
  return dates.map((date) => {
    const vals: number[] = [];
    for (let i = 0; i < window; i++) {
      const v = allDaily.get(addDays(date, -i))?.average;
      if (v != null) vals.push(v);
    }
    return { date, value: vals.length >= minDays ? mean(vals) : null, days: vals.length };
  });
}

function groupAverages(days: DailyWeight[], keyOf: (d: LocalDate) => string, rangeOf: (key: string, d: LocalDate) => { start: LocalDate; end: LocalDate }): PeriodAverage[] {
  const groups = new Map<string, { start: LocalDate; end: LocalDate; avgs: number[]; mornings: number[]; nights: number[] }>();
  for (const day of days) {
    const key = keyOf(day.date);
    let g = groups.get(key);
    if (!g) {
      g = { ...rangeOf(key, day.date), avgs: [], mornings: [], nights: [] };
      groups.set(key, g);
    }
    if (day.average !== null) g.avgs.push(day.average);
    if (day.morning !== null) g.mornings.push(day.morning);
    if (day.night !== null) g.nights.push(day.night);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      start: g.start,
      end: g.end,
      average: mean(g.avgs),
      days: g.avgs.length,
      morningAverage: mean(g.mornings),
      nightAverage: mean(g.nights),
    }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function weeklyAverages(days: DailyWeight[], weekStartsOn = 1): PeriodAverage[] {
  return groupAverages(
    days,
    (d) => startOfWeek(d, weekStartsOn),
    (key) => ({ start: key, end: addDays(key, 6) }),
  );
}

export function monthlyAverages(days: DailyWeight[]): PeriodAverage[] {
  return groupAverages(
    days,
    (d) => monthKey(d),
    (key) => {
      const [y, m] = key.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return { start: `${key}-01`, end: `${key}-${String(last).padStart(2, "0")}` };
    },
  );
}

/** Least-squares trend through daily averages; null with fewer than `minPoints` days. */
export function linearTrend(days: DailyWeight[], minPoints = 5): Trend | null {
  const pts = days.filter((d) => d.average !== null);
  if (pts.length < minPoints) return null;
  const origin = pts[0].date;
  const xs = pts.map((d) => diffDays(origin, d.date));
  const ys = pts.map((d) => d.average as number);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return {
    slopePerDay: slope,
    slopePerWeek: slope * 7,
    intercept,
    r2,
    n,
    startDate: origin,
    valueAt: (date: LocalDate) => intercept + slope * diffDays(origin, date),
  };
}

export interface WeightChange {
  value: number | null;
  /** Why the value is null, for display. */
  reason?: string;
  from?: LocalDate;
  to?: LocalDate;
}

export interface WeightSummary {
  latestDate: LocalDate | null;
  latestDaily: number | null;
  latestMorning: { date: LocalDate; value: number } | null;
  latestNight: { date: LocalDate; value: number } | null;
  current7DayAverage: number | null;
  changeVsPreviousDay: WeightChange;
  changeVsPreviousWeek: WeightChange;
  changeVsPreviousMonth: WeightChange;
  changeFromStart: WeightChange;
  toTarget: number | null;
  averageFluctuation: number | null;
}

/**
 * Headline changes as of `today`:
 * - previous day: latest daily average vs the calendar day before it.
 * - previous week / month: 7-day rolling average now vs 7 / 30 days earlier
 *   (rolling averages damp water-weight noise).
 * - from start: current 7-day average (or latest daily average) vs starting weight.
 */
export function summarizeWeights(
  readings: WeightReading[],
  today: LocalDate,
  opts: { startingWeightKg?: number | null; targetWeightKg?: number | null } = {},
): WeightSummary {
  const map = buildDailyMap(readings);
  const datesWithData = [...map.values()].filter((d) => d.average !== null && d.date <= today).map((d) => d.date).sort();
  const latestDate = datesWithData.at(-1) ?? null;
  const latestDaily = latestDate ? (map.get(latestDate)?.average ?? null) : null;

  const latestOf = (period: "morning" | "night") => {
    const rs = readings.filter((r) => r.period === period && r.localDate <= today).sort((a, b) => (a.localDate < b.localDate ? 1 : -1));
    return rs[0] ? { date: rs[0].localDate, value: rs[0].weightKg } : null;
  };

  const rollingAt = (date: LocalDate) => rollingAverage(map, [date])[0].value;
  const current7 = rollingAt(today);

  let changeVsPreviousDay: WeightChange = { value: null, reason: "No weigh-ins yet" };
  if (latestDate) {
    const prev = addDays(latestDate, -1);
    const prevAvg = map.get(prev)?.average ?? null;
    changeVsPreviousDay =
      prevAvg === null || latestDaily === null
        ? { value: null, reason: "No weigh-in on the previous day" }
        : { value: latestDaily - prevAvg, from: prev, to: latestDate };
  }

  const rollingChange = (days: number): WeightChange => {
    if (current7 === null) return { value: null, reason: "Need 3+ weigh-in days in the last week" };
    const past = rollingAt(addDays(today, -days));
    if (past === null) return { value: null, reason: `Not enough weigh-ins around ${days} days ago` };
    return { value: current7 - past, from: addDays(today, -days), to: today };
  };

  const currentForStart = current7 ?? latestDaily;
  const changeFromStart: WeightChange =
    opts.startingWeightKg == null
      ? { value: null, reason: "Set a starting weight in Settings" }
      : currentForStart === null
        ? { value: null, reason: "No recent weigh-ins" }
        : { value: currentForStart - opts.startingWeightKg };

  const flucts = [...map.values()].map((d) => d.fluctuation).filter((v): v is number => v !== null);

  return {
    latestDate,
    latestDaily,
    latestMorning: latestOf("morning"),
    latestNight: latestOf("night"),
    current7DayAverage: current7,
    changeVsPreviousDay,
    changeVsPreviousWeek: rollingChange(7),
    changeVsPreviousMonth: rollingChange(30),
    changeFromStart,
    toTarget: opts.targetWeightKg != null && currentForStart !== null ? opts.targetWeightKg - currentForStart : null,
    averageFluctuation: mean(flucts),
  };
}

export interface MissingDay {
  date: LocalDate;
  missingMorning: boolean;
  missingNight: boolean;
}

/** Days in range (up to today) lacking a morning and/or night weigh-in. */
export function missingEntries(readings: WeightReading[], start: LocalDate, end: LocalDate): MissingDay[] {
  const map = buildDailyMap(readings);
  return eachDate(start, end)
    .map((date) => {
      const d = map.get(date);
      return { date, missingMorning: d?.morning == null, missingNight: d?.night == null };
    })
    .filter((d) => d.missingMorning || d.missingNight);
}
