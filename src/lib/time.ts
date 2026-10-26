/**
 * Calendar-day helpers. Calendar days are always handled as `YYYY-MM-DD`
 * strings ("local dates") so that time zones never shift a day boundary by
 * accident. Instants are `Date` objects (UTC internally).
 */
import { fromZonedTime } from "date-fns-tz";

export type LocalDate = string; // YYYY-MM-DD

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  date: LocalDate;
  hour: number;
  minute: number;
  /** HH:mm */
  time: string;
}

/** Wall-clock date/time of an instant in a time zone. */
export function localParts(instant: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/**
 * The logical day an instant belongs to. With `dayStartHour` > 0, events between
 * midnight and that hour count toward the previous day (e.g. a 1 AM snack with a
 * 3 AM day boundary is logged on the previous evening's day).
 */
export function logicalDate(instant: Date, tz: string, dayStartHour = 0): LocalDate {
  const p = localParts(instant, tz);
  return p.hour < dayStartHour ? addDays(p.date, -1) : p.date;
}

/**
 * Default day for a weigh-in. Night weigh-ins taken shortly after midnight
 * (before 5 AM, or before the configured day start if later) belong to the
 * previous day; morning weigh-ins always belong to the calendar day.
 */
export function weightLocalDate(instant: Date, tz: string, period: "morning" | "night", dayStartHour = 0): LocalDate {
  const p = localParts(instant, tz);
  if (period === "night" && p.hour < Math.max(5, dayStartHour)) return addDays(p.date, -1);
  return p.date;
}

export function todayIn(tz: string, dayStartHour = 0, now: Date = new Date()): LocalDate {
  return logicalDate(now, tz, dayStartHour);
}

/** Convert a wall-clock date + time in a zone to an instant. */
export function zonedToInstant(date: LocalDate, time: string, tz: string): Date {
  const t = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  return fromZonedTime(`${date}T${t}`, tz);
}

function toUTC(date: LocalDate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(dt: Date): LocalDate {
  return dt.toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const dt = toUTC(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUTC(dt);
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const dt = toUTC(date);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, lastDay));
  return fromUTC(dt);
}

/** Whole days from a to b (b − a). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

export function eachDate(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  if (start > end) return out;
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(date: LocalDate): number {
  return toUTC(date).getUTCDay();
}

/** First day of the week containing `date`. weekStartsOn: 0 = Sunday, 1 = Monday. */
export function startOfWeek(date: LocalDate, weekStartsOn = 1): LocalDate {
  const dow = dayOfWeek(date);
  const delta = (dow - weekStartsOn + 7) % 7;
  return addDays(date, -delta);
}

export function monthKey(date: LocalDate): string {
  return date.slice(0, 7);
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a < b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b;
}

export const RANGE_PRESETS = ["7d", "30d", "90d", "6m", "1y", "all"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Record<RangePreset, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "6m": "6 months",
  "1y": "1 year",
  all: "All time",
};

/** Inclusive date range ending on `today` for a preset. `earliest` is used for "all". */
export function presetRange(preset: RangePreset, today: LocalDate, earliest?: LocalDate | null): { start: LocalDate; end: LocalDate } {
  switch (preset) {
    case "7d":
      return { start: addDays(today, -6), end: today };
    case "30d":
      return { start: addDays(today, -29), end: today };
    case "90d":
      return { start: addDays(today, -89), end: today };
    case "6m":
      return { start: addDays(addMonths(today, -6), 1), end: today };
    case "1y":
      return { start: addDays(addMonths(today, -12), 1), end: today };
    case "all":
      return { start: earliest && earliest < today ? earliest : addDays(today, -29), end: today };
  }
}

export function formatLocalDate(date: LocalDate, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(toUTC(date));
}

export function formatTimeInZone(instant: Date | string, tz: string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
}

/**
 * Instant for a wall-clock time entered against a *logical* day. Times before
 * the day boundary (e.g. 01:30 with a 3 AM day start, or a night weigh-in
 * after midnight) happen on the following calendar date.
 */
export function logicalDayTimeToInstant(day: LocalDate, time: string, tz: string, boundaryHour: number): Date {
  const hour = Number(time.slice(0, 2));
  return zonedToInstant(hour < boundaryHour ? addDays(day, 1) : day, time, tz);
}
