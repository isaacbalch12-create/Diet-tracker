/**
 * Parse health payloads pushed from a phone into normalized daily records.
 *
 * Two formats are accepted:
 * 1. The app's own JSON (sent by the iOS Shortcut described in the Health
 *    setup page, or by any client — e.g. an Android Health Connect exporter):
 *    { days: [{ date, steps, sleep: {...}, sleepScore: {value, provider}, ... }],
 *      steps: [{ date, value }], sleepSamples: [{ start, end, stage, source }] }
 * 2. The JSON export of the "Health Auto Export" iOS app (REST API automation):
 *    { data: { metrics: [{ name, units, data: [...] }] } }
 *
 * Nothing is invented: values that are missing, implausible or unattributable
 * (e.g. a sleep score without a named provider) are reported as ignored.
 */
import type { HealthMetric, SleepDetails } from "../db/schema";
import { isLocalDate, localParts, type LocalDate } from "../time";
import { HEALTH_METRIC_BY_KEY } from "./metrics";
import { parseSleepStage, summarizeSleep, type SleepSample } from "./sleep";

export interface ParsedRecord {
  date: LocalDate;
  metric: HealthMetric;
  value: number;
  unit: string;
  origin: string | null;
  details: SleepDetails | Record<string, unknown> | null;
}

export interface ParseResult {
  format: "native" | "health_auto_export";
  records: ParsedRecord[];
  ignored: { item: string; reason: string }[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A number, or a numeric string as Shortcuts often sends ("8,123", "7.5"). */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim().replace(/,/g, "");
    if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "2026-11-01 23:10:00 -0500" → "2026-11-01T23:10:00-05:00"; ISO strings pass through. */
export function parseInstant(raw: unknown): Date | null {
  const s = str(raw);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    const off = m[3] ? (m[3] === "Z" ? "Z" : m[3].includes(":") ? m[3] : `${m[3].slice(0, 3)}:${m[3].slice(3)}`) : "Z";
    const d = new Date(`${m[1]}T${m[2]}${off}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s);
  return /\d{4}/.test(s) && !Number.isNaN(d.getTime()) && /T|:/.test(s) ? d : null;
}

/**
 * The local calendar day of a timestamp. When the timestamp carries a UTC
 * offset, its wall-clock date is used (that is the phone's local day);
 * UTC ("Z") timestamps are converted with the app's time zone.
 */
export function localDateOf(raw: unknown, timeZone: string): LocalDate | null {
  const s = str(raw);
  if (!s) return null;
  if (isLocalDate(s)) return s;
  const withOffset = /^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*[+-]\d{2}:?\d{2}$/.exec(s);
  if (withOffset && isLocalDate(withOffset[1])) return withOffset[1];
  const d = parseInstant(s);
  return d ? localParts(d, timeZone).date : null;
}

class Collector {
  records: ParsedRecord[] = [];
  ignored: { item: string; reason: string }[] = [];
  private sums = new Map<string, { date: LocalDate; metric: HealthMetric; total: number; n: number; origins: Set<string>; mode: "sum" | "avg" }>();

  ignore(item: string, reason: string) {
    if (this.ignored.length < 50) this.ignored.push({ item, reason });
  }

  /** Accumulate a value for (date, metric); sums or averages are emitted in finish(). */
  add(date: LocalDate | null, metric: HealthMetric, value: number | null, origin: string | null, mode: "sum" | "avg", item: string) {
    if (!date) return this.ignore(item, "missing or unreadable date (use ISO 8601, e.g. 2026-11-02 or 2026-11-02T07:00:00-05:00)");
    if (value == null) return this.ignore(item, "missing or non-numeric value");
    const key = `${date}|${metric}`;
    const cur = this.sums.get(key) ?? { date, metric, total: 0, n: 0, origins: new Set<string>(), mode };
    cur.total += value;
    cur.n += 1;
    if (origin) cur.origins.add(origin);
    this.sums.set(key, cur);
  }

  push(r: ParsedRecord, item: string) {
    const def = HEALTH_METRIC_BY_KEY[r.metric];
    if (r.value < def.min || r.value > def.max) return this.ignore(item, `${def.label} value ${r.value} is outside the plausible range ${def.min}–${def.max}`);
    const i = this.records.findIndex((x) => x.date === r.date && x.metric === r.metric);
    if (i >= 0) this.records[i] = r;
    else this.records.push(r);
  }

  finish(): ParsedRecord[] {
    for (const s of this.sums.values()) {
      const def = HEALTH_METRIC_BY_KEY[s.metric];
      const value = s.mode === "sum" ? s.total : s.total / s.n;
      this.push({ date: s.date, metric: s.metric, value: Math.round(value * 10) / 10, unit: def.unit, origin: [...s.origins].join(", ") || null, details: null }, `${def.label} ${s.date}`);
    }
    return this.records.sort((a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric));
  }
}

function sleepRecord(c: Collector, date: LocalDate | null, asleepMin: number | null, d: Partial<SleepDetails> & { origin?: string | null }, item: string) {
  if (!date) return c.ignore(item, "missing or unreadable date");
  if (asleepMin == null || asleepMin <= 0) return c.ignore(item, "no time asleep recorded");
  c.push({ date, metric: "sleep", value: Math.round(asleepMin * 10) / 10, unit: "min", origin: d.origin ?? null, details: { inBedMinutes: d.inBedMinutes ?? null, stages: d.stages ?? null, start: d.start ?? null, end: d.end ?? null, origins: d.origins ?? (d.origin ? [d.origin] : []) } }, item);
}

function sleepScoreRecord(c: Collector, date: LocalDate | null, raw: unknown, provider: string | null, item: string) {
  const value = num(isObj(raw) ? raw.value ?? raw.score : raw);
  const prov = provider ?? (isObj(raw) ? str(raw.provider) ?? str(raw.source) : null);
  if (value == null) return c.ignore(item, "sleep score is not a number");
  if (!prov) return c.ignore(item, "sleep score ignored: it must name the device or app that calculated it (provider)");
  if (!date) return c.ignore(item, "missing or unreadable date");
  c.push({ date, metric: "sleep_score", value, unit: "score", origin: prov, details: { provider: prov } }, item);
}

function samplesFrom(list: unknown[], c: Collector, label: string): SleepSample[] {
  const out: SleepSample[] = [];
  list.forEach((raw, i) => {
    if (!isObj(raw)) return c.ignore(`${label}[${i}]`, "not an object");
    const start = parseInstant(raw.start ?? raw.startDate ?? raw.start_date);
    const end = parseInstant(raw.end ?? raw.endDate ?? raw.end_date);
    const stage = parseSleepStage(raw.stage ?? raw.value ?? raw.type);
    if (!start || !end) return c.ignore(`${label}[${i}]`, "start/end must be ISO 8601 timestamps with a UTC offset");
    if (!stage) return c.ignore(`${label}[${i}]`, `unknown sleep stage "${String(raw.stage ?? raw.value)}"`);
    out.push({ start, end, stage, source: str(raw.source) ?? str(raw.sourceName) });
  });
  return out;
}

function parseNative(body: Obj, timeZone: string): ParseResult {
  const c = new Collector();
  const tz = str(body.timezone) ?? timeZone;
  const days = Array.isArray(body.days) ? body.days : [];
  days.forEach((raw, i) => {
    if (!isObj(raw)) return c.ignore(`days[${i}]`, "not an object");
    const date = localDateOf(raw.date, tz);
    const origin = str(raw.source) ?? str(body.device) ?? null;
    if (raw.steps !== undefined) c.add(date, "steps", num(raw.steps), origin, "sum", `days[${i}].steps`);
    if (raw.restingHeartRate !== undefined) c.add(date, "resting_hr", num(raw.restingHeartRate), origin, "avg", `days[${i}].restingHeartRate`);
    if (raw.hrv !== undefined) c.add(date, "hrv", num(raw.hrv), origin, "avg", `days[${i}].hrv`);
    if (raw.activeEnergy !== undefined) c.add(date, "active_energy", num(raw.activeEnergy), origin, "sum", `days[${i}].activeEnergy`);
    if (isObj(raw.sleep)) {
      const sl = raw.sleep;
      const stages = { deep: num(sl.deepMinutes), rem: num(sl.remMinutes), core: num(sl.coreMinutes), awake: num(sl.awakeMinutes), unspecified: null };
      const hasStages = stages.deep != null || stages.rem != null || stages.core != null;
      sleepRecord(c, date, num(sl.asleepMinutes), { inBedMinutes: num(sl.inBedMinutes), stages: hasStages ? stages : null, start: str(sl.start), end: str(sl.end), origin: str(sl.source) ?? origin }, `days[${i}].sleep`);
    }
    if (raw.sleepScore !== undefined && raw.sleepScore !== null) sleepScoreRecord(c, date, raw.sleepScore, null, `days[${i}].sleepScore`);
  });
  const flat: [string, HealthMetric, "sum" | "avg"][] = [
    ["steps", "steps", "sum"],
    ["activeEnergy", "active_energy", "sum"],
    ["restingHeartRate", "resting_hr", "avg"],
    ["hrv", "hrv", "avg"],
  ];
  for (const [key, metric, mode] of flat) {
    const list = body[key];
    if (!Array.isArray(list)) continue;
    list.forEach((raw, i) => {
      if (!isObj(raw)) return c.ignore(`${key}[${i}]`, "not an object");
      c.add(localDateOf(raw.date ?? raw.startDate ?? raw.start, tz), metric, num(raw.value ?? raw.qty), str(raw.source), mode, `${key}[${i}]`);
    });
  }
  if (Array.isArray(body.sleepSamples)) {
    for (const n of summarizeSleep(samplesFrom(body.sleepSamples, c, "sleepSamples"), tz)) {
      sleepRecord(c, n.date, n.asleepMinutes, { inBedMinutes: n.inBedMinutes, stages: n.stages, start: n.start, end: n.end, origins: n.origins, origin: n.origins.join(", ") || null }, `sleep ${n.date}`);
    }
  }
  if (Array.isArray(body.sleepScores)) {
    body.sleepScores.forEach((raw, i) => {
      if (!isObj(raw)) return c.ignore(`sleepScores[${i}]`, "not an object");
      sleepScoreRecord(c, localDateOf(raw.date, tz), raw, str(raw.provider) ?? str(raw.source), `sleepScores[${i}]`);
    });
  }
  return { format: "native", records: c.finish(), ignored: c.ignored };
}

const HAE_NAMES: Record<string, { metric: HealthMetric; mode: "sum" | "avg" } | "sleep" | "sleep_score"> = {
  step_count: { metric: "steps", mode: "sum" },
  steps: { metric: "steps", mode: "sum" },
  resting_heart_rate: { metric: "resting_hr", mode: "avg" },
  heart_rate_variability: { metric: "hrv", mode: "avg" },
  heart_rate_variability_sdnn: { metric: "hrv", mode: "avg" },
  active_energy: { metric: "active_energy", mode: "sum" },
  active_energy_burned: { metric: "active_energy", mode: "sum" },
  sleep_analysis: "sleep",
  sleep_score: "sleep_score",
};

function parseHealthAutoExport(body: Obj, timeZone: string): ParseResult {
  const c = new Collector();
  const container = isObj(body.data) ? body.data : body;
  const metrics = Array.isArray(container.metrics) ? container.metrics : [];
  for (const m of metrics) {
    if (!isObj(m)) continue;
    const name = (str(m.name) ?? "").toLowerCase();
    const units = (str(m.units) ?? "").toLowerCase();
    const data = Array.isArray(m.data) ? m.data : [];
    const def = HAE_NAMES[name];
    if (!def) {
      c.ignore(name || "unnamed metric", "not used by this app");
      continue;
    }
    if (def === "sleep") {
      const toMin = (v: unknown) => {
        const n = num(v);
        if (n == null) return null;
        return units.startsWith("min") ? n : n * 60;
      };
      const unaggregated = data.filter((d) => isObj(d) && (d.value !== undefined || d.stage !== undefined) && (d.startDate !== undefined || d.start !== undefined));
      if (unaggregated.length) {
        for (const n of summarizeSleep(samplesFrom(unaggregated, c, "sleep_analysis"), timeZone)) {
          sleepRecord(c, n.date, n.asleepMinutes, { inBedMinutes: n.inBedMinutes, stages: n.stages, start: n.start, end: n.end, origins: n.origins, origin: n.origins.join(", ") || null }, `sleep ${n.date}`);
        }
      }
      data.forEach((raw, i) => {
        if (!isObj(raw) || unaggregated.includes(raw)) return;
        const deep = toMin(raw.deep);
        const rem = toMin(raw.rem);
        const core = toMin(raw.core);
        const unspecified = toMin(raw.asleep);
        const staged = (deep ?? 0) + (rem ?? 0) + (core ?? 0);
        const total = toMin(raw.totalSleep) ?? (staged > 0 ? staged + (unspecified ?? 0) : unspecified);
        const date = localDateOf(raw.sleepEnd ?? raw.inBedEnd ?? raw.date, timeZone);
        const source = str(raw.source);
        sleepRecord(
          c,
          date,
          total,
          {
            inBedMinutes: toMin(raw.inBed),
            stages: staged > 0 ? { deep, rem, core, awake: toMin(raw.awake), unspecified: staged > 0 && raw.totalSleep !== undefined ? unspecified : null } : null,
            start: parseInstant(raw.sleepStart ?? raw.inBedStart)?.toISOString() ?? null,
            end: parseInstant(raw.sleepEnd ?? raw.inBedEnd)?.toISOString() ?? null,
            origin: source,
          },
          `sleep_analysis[${i}]`,
        );
      });
      continue;
    }
    if (def === "sleep_score") {
      data.forEach((raw, i) => {
        if (!isObj(raw)) return;
        sleepScoreRecord(c, localDateOf(raw.date, timeZone), raw.qty ?? raw.value, str(raw.source) ?? str(raw.provider), `sleep_score[${i}]`);
      });
      continue;
    }
    data.forEach((raw, i) => {
      if (!isObj(raw)) return c.ignore(`${name}[${i}]`, "not an object");
      let value = num(raw.qty ?? raw.Avg ?? raw.avg ?? raw.value);
      if (value != null && def.metric === "active_energy" && units === "kj") value = value / 4.184;
      c.add(localDateOf(raw.date ?? raw.startDate, timeZone), def.metric, value, str(raw.source), def.mode, `${name}[${i}]`);
    });
  }
  return { format: "health_auto_export", records: c.finish(), ignored: c.ignored };
}

export function parseHealthPayload(body: unknown, timeZone: string): ParseResult {
  if (!isObj(body)) return { format: "native", records: [], ignored: [{ item: "body", reason: "expected a JSON object" }] };
  const looksHae = (isObj(body.data) && Array.isArray(body.data.metrics)) || Array.isArray(body.metrics);
  return looksHae ? parseHealthAutoExport(body, timeZone) : parseNative(body, timeZone);
}
