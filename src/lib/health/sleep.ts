/**
 * Sleep from raw Apple Health sleep-analysis samples.
 *
 * Phones often hold overlapping samples (iPhone "In Bed" + Apple Watch stages +
 * a third-party tracker). Totals use the union of intervals, so overlapping
 * samples are never double counted. Stage minutes come from the single source
 * that recorded the most staged sleep, rather than mixing devices.
 * A night is attributed to the local date on which it ends (the wake-up day).
 */
import { localParts, type LocalDate } from "../time";

export type SleepStage = "inBed" | "asleep" | "core" | "deep" | "rem" | "awake";

export interface SleepSample {
  start: Date;
  end: Date;
  stage: SleepStage;
  source: string | null;
}

/** Normalize the many spellings phones and apps use for sleep stages. */
export function parseSleepStage(raw: unknown): SleepStage | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).toLowerCase().replace(/hkcategoryvaluesleepanalysis/g, "").replace(/[_\s()-]/g, "");
  if (s.includes("inbed")) return "inBed";
  if (s.includes("awake")) return "awake";
  if (s.includes("deep")) return "deep";
  if (s.includes("rem")) return "rem";
  if (s.includes("core") || s.includes("light")) return "core";
  if (s.includes("asleep") || s.includes("unspecified") || s === "sleep") return "asleep";
  // HealthKit raw values: 0 in bed, 1 asleep (unspecified), 2 awake, 3 core, 4 deep, 5 REM.
  const map: Record<string, SleepStage> = { "0": "inBed", "1": "asleep", "2": "awake", "3": "core", "4": "deep", "5": "rem" };
  return map[s] ?? null;
}

type Interval = [number, number];

function union(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

const minutes = (ivs: Interval[]) => ivs.reduce((a, [s, e]) => a + (e - s), 0) / 60_000;

export interface NightSummary {
  date: LocalDate;
  asleepMinutes: number;
  inBedMinutes: number | null;
  stages: { deep: number; rem: number; core: number; awake: number; unspecified: number } | null;
  start: string;
  end: string;
  origins: string[];
}

const ASLEEP: SleepStage[] = ["asleep", "core", "deep", "rem"];

/**
 * Group samples into nights (a gap of 3+ hours starts a new night; the longest
 * night ending on a date wins) and summarize each.
 */
export function summarizeSleep(samples: SleepSample[], timeZone: string): NightSummary[] {
  const valid = samples.filter((s) => s.end.getTime() > s.start.getTime() && s.end.getTime() - s.start.getTime() < 24 * 3600_000);
  if (!valid.length) return [];
  const sorted = [...valid].sort((a, b) => a.start.getTime() - b.start.getTime());
  const groups: SleepSample[][] = [];
  let groupEnd = -Infinity;
  for (const s of sorted) {
    if (!groups.length || s.start.getTime() - groupEnd > 3 * 3600_000) {
      groups.push([s]);
      groupEnd = s.end.getTime();
    } else {
      groups[groups.length - 1].push(s);
      groupEnd = Math.max(groupEnd, s.end.getTime());
    }
  }
  const byDate = new Map<LocalDate, NightSummary>();
  for (const g of groups) {
    const asleep = union(g.filter((s) => ASLEEP.includes(s.stage)).map((s) => [s.start.getTime(), s.end.getTime()]));
    if (!asleep.length) continue;
    const inBedIvs = union(g.filter((s) => s.stage === "inBed").map((s) => [s.start.getTime(), s.end.getTime()]));
    // Pick the source with the most staged (core/deep/rem) sleep for the stage breakdown.
    const bySource = new Map<string, SleepSample[]>();
    for (const s of g) {
      const k = s.source ?? "";
      bySource.set(k, [...(bySource.get(k) ?? []), s]);
    }
    let stages: NightSummary["stages"] = null;
    let bestStaged = 0;
    for (const list of bySource.values()) {
      const stage = (st: SleepStage) => minutes(union(list.filter((s) => s.stage === st).map((s) => [s.start.getTime(), s.end.getTime()])));
      const staged = stage("core") + stage("deep") + stage("rem");
      if (staged > bestStaged) {
        bestStaged = staged;
        stages = { deep: stage("deep"), rem: stage("rem"), core: stage("core"), awake: stage("awake"), unspecified: stage("asleep") };
      }
    }
    const start = Math.min(...g.map((s) => s.start.getTime()));
    const end = Math.max(...asleep.map(([, e]) => e));
    const date = localParts(new Date(end), timeZone).date;
    const night: NightSummary = {
      date,
      asleepMinutes: Math.round(minutes(asleep) * 10) / 10,
      inBedMinutes: inBedIvs.length ? Math.round(minutes(inBedIvs) * 10) / 10 : null,
      stages: stages ? Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, Math.round(v * 10) / 10])) as NightSummary["stages"] : null,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      origins: [...new Set(g.map((s) => s.source).filter((x): x is string => !!x))],
    };
    const prev = byDate.get(date);
    if (!prev || night.asleepMinutes > prev.asleepMinutes) byDate.set(date, night);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
