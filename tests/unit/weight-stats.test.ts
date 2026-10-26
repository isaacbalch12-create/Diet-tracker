import { describe, expect, it } from "vitest";
import {
  buildDailyMap,
  dailySeries,
  linearTrend,
  missingEntries,
  monthlyAverages,
  rollingAverage,
  summarizeWeights,
  weeklyAverages,
  type WeightReading,
} from "@/lib/weight/stats";
import { addDays, eachDate } from "@/lib/time";

function readings(start: string, days: number, morning: (i: number) => number | null, night: (i: number) => number | null): WeightReading[] {
  const out: WeightReading[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const m = morning(i);
    const n = night(i);
    if (m !== null) out.push({ localDate: date, period: "morning", weightKg: m });
    if (n !== null) out.push({ localDate: date, period: "night", weightKg: n });
  }
  return out;
}

describe("weight statistics", () => {
  it("computes daily average, fluctuation and partial days", () => {
    const map = buildDailyMap([
      { localDate: "2026-10-01", period: "morning", weightKg: 80 },
      { localDate: "2026-10-01", period: "night", weightKg: 81.2 },
      { localDate: "2026-10-02", period: "morning", weightKg: 79.8 },
    ]);
    expect(map.get("2026-10-01")).toMatchObject({ average: 80.6, partial: false });
    expect(map.get("2026-10-01")!.fluctuation).toBeCloseTo(1.2, 10);
    expect(map.get("2026-10-02")).toMatchObject({ average: 79.8, partial: true, fluctuation: null });
  });

  it("never treats a missing weigh-in as zero", () => {
    const series = dailySeries([{ localDate: "2026-10-03", period: "morning", weightKg: 80 }], "2026-10-01", "2026-10-03");
    expect(series.map((d) => d.average)).toEqual([null, null, 80]);
    const weekly = weeklyAverages(series);
    expect(weekly[0].average).toBe(80);
    expect(weekly[0].days).toBe(1);
  });

  it("requires 3 days of data for a 7-day rolling average", () => {
    const rs = readings("2026-10-01", 10, (i) => (i === 3 || i === 5 || i === 9 ? 80 + i * 0.1 : null), () => null);
    const map = buildDailyMap(rs);
    const roll = rollingAverage(map, eachDate("2026-10-01", "2026-10-10"));
    expect(roll[4].value).toBeNull(); // Oct 5 window has only Oct 4
    expect(roll[9].days).toBe(3); // Oct 10 window: Oct 4, 6, 10
    expect(roll[9].value).toBeCloseTo((80.3 + 80.5 + 80.9) / 3, 10);
  });

  it("groups weekly and monthly averages over days with data only", () => {
    const series = dailySeries(
      readings("2026-09-28", 14, (i) => 80 - i * 0.1, (i) => 81 - i * 0.1),
      "2026-09-28",
      "2026-10-11",
    );
    const weeks = weeklyAverages(series, 1);
    expect(weeks.map((w) => w.start)).toEqual(["2026-09-28", "2026-10-05"]);
    expect(weeks[0].average).toBeCloseTo(80.5 - 0.3, 10);
    const months = monthlyAverages(series);
    expect(months.map((m) => m.key)).toEqual(["2026-09", "2026-10"]);
    expect(months[0].days).toBe(3);
  });

  it("fits a linear trend", () => {
    const series = dailySeries(readings("2026-01-01", 28, (i) => 90 - i * 0.05, () => null), "2026-01-01", "2026-01-28");
    const trend = linearTrend(series)!;
    expect(trend.slopePerWeek).toBeCloseTo(-0.35, 6);
    expect(trend.r2).toBeCloseTo(1, 6);
    expect(trend.valueAt("2026-01-08")).toBeCloseTo(89.65, 6);
  });

  it("summarizes day/week/month/start changes and target distance", () => {
    const rs = readings("2026-09-01", 56, (i) => 85 - i * 0.05, (i) => 86 - i * 0.05);
    const today = "2026-10-26";
    const s = summarizeWeights(rs, today, { startingWeightKg: 86, targetWeightKg: 80 });
    expect(s.latestDate).toBe(today);
    expect(s.changeVsPreviousDay.value).toBeCloseTo(-0.05, 10);
    expect(s.changeVsPreviousWeek.value).toBeCloseTo(-0.35, 10);
    expect(s.changeVsPreviousMonth.value).toBeCloseTo(-1.5, 10);
    expect(s.current7DayAverage).toBeCloseTo(85.5 - 0.05 * 52, 10);
    expect(s.changeFromStart.value).toBeCloseTo(s.current7DayAverage! - 86, 10);
    expect(s.toTarget).toBeCloseTo(80 - s.current7DayAverage!, 10);
    expect(s.averageFluctuation).toBeCloseTo(1, 10);
  });

  it("explains why a change cannot be computed", () => {
    const s = summarizeWeights([{ localDate: "2026-10-26", period: "morning", weightKg: 80 }], "2026-10-26");
    expect(s.changeVsPreviousDay.value).toBeNull();
    expect(s.changeVsPreviousDay.reason).toMatch(/previous day/);
    expect(s.changeFromStart.reason).toMatch(/starting weight/);
  });

  it("lists missing morning/night entries", () => {
    const missing = missingEntries(
      [
        { localDate: "2026-10-01", period: "morning", weightKg: 80 },
        { localDate: "2026-10-01", period: "night", weightKg: 81 },
        { localDate: "2026-10-02", period: "morning", weightKg: 80 },
      ],
      "2026-10-01",
      "2026-10-03",
    );
    expect(missing).toEqual([
      { date: "2026-10-02", missingMorning: false, missingNight: true },
      { date: "2026-10-03", missingMorning: true, missingNight: true },
    ]);
  });
});
