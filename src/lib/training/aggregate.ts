/**
 * Weekly/monthly bucketing on UTC-midnight day keys (see types.ts), so buckets
 * match the user's calendar regardless of the server's time zone.
 */
export type Period = "week" | "month";

export const DAY_MS = 86_400_000;

/** UTC midnight of the day containing `ms`. */
export function dayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

export function dateToMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function msToDate(ms: number): string {
  return new Date(dayStart(ms)).toISOString().slice(0, 10);
}

export function periodStart(ms: number, period: Period, weekStartsOn: 0 | 1): number {
  const d = new Date(dayStart(ms));
  if (period === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const delta = (d.getUTCDay() - weekStartsOn + 7) % 7;
  return d.getTime() - delta * DAY_MS;
}

export function nextPeriod(ms: number, period: Period): number {
  const d = new Date(ms);
  if (period === "week") return ms + 7 * DAY_MS;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** Every bucket start from the bucket containing startMs through the one containing endMs. */
export function periodBuckets(startMs: number, endMs: number, period: Period, weekStartsOn: 0 | 1): number[] {
  const out: number[] = [];
  let cur = periodStart(startMs, period, weekStartsOn);
  const last = periodStart(endMs, period, weekStartsOn);
  while (cur <= last && out.length < 5000) {
    out.push(cur);
    cur = nextPeriod(cur, period);
  }
  return out;
}

const weekFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function periodLabel(ms: number, period: Period): string {
  return period === "week" ? weekFmt.format(ms) : monthFmt.format(ms);
}

export interface PeriodBucket {
  startMs: number;
  label: string;
  value: number;
  count: number;
}

/**
 * Sum values into weekly or monthly buckets. Empty periods inside the range are
 * included as zero so gaps in training are visible rather than hidden.
 */
export function aggregateByPeriod<T>(
  items: T[],
  getMs: (t: T) => number,
  getValue: (t: T) => number,
  period: Period,
  weekStartsOn: 0 | 1,
  bounds: { startMs: number | null; endMs: number | null } = { startMs: null, endMs: null },
): PeriodBucket[] {
  if (!items.length && (bounds.startMs == null || bounds.endMs == null)) return [];
  const times = items.map(getMs);
  const start = bounds.startMs ?? Math.min(...times);
  const end = bounds.endMs ?? Math.max(...times);
  const buckets = new Map<number, PeriodBucket>();
  for (const b of periodBuckets(start, end, period, weekStartsOn)) {
    buckets.set(b, { startMs: b, label: periodLabel(b, period), value: 0, count: 0 });
  }
  items.forEach((item, i) => {
    const b = buckets.get(periodStart(times[i], period, weekStartsOn));
    if (!b) return;
    b.value += getValue(item);
    b.count += 1;
  });
  return [...buckets.values()];
}

/** Count distinct keys (e.g. workout ids) per bucket. */
export function countDistinctByPeriod<T>(
  items: T[],
  getMs: (t: T) => number,
  getKey: (t: T) => string,
  period: Period,
  weekStartsOn: 0 | 1,
  bounds: { startMs: number | null; endMs: number | null } = { startMs: null, endMs: null },
): PeriodBucket[] {
  const seen = new Set<string>();
  const unique = items.filter((t) => {
    const k = getKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return aggregateByPeriod(unique, getMs, () => 1, period, weekStartsOn, bounds);
}
