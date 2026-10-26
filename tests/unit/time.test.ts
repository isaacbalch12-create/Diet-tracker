import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  diffDays,
  eachDate,
  isLocalDate,
  localParts,
  logicalDate,
  logicalDayTimeToInstant,
  presetRange,
  startOfWeek,
  weightLocalDate,
  zonedToInstant,
} from "@/lib/time";

describe("local dates and time zones", () => {
  it("validates calendar dates", () => {
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("26-1-1")).toBe(false);
  });

  it("assigns a meal near midnight to the correct local day per time zone", () => {
    // 2026-03-01T04:30Z is 11:30 PM on Feb 28 in New York (EST) but Mar 1 in London.
    const instant = new Date("2026-03-01T04:30:00Z");
    expect(logicalDate(instant, "America/New_York")).toBe("2026-02-28");
    expect(logicalDate(instant, "Europe/London")).toBe("2026-03-01");
    expect(logicalDate(instant, "Asia/Tokyo")).toBe("2026-03-01");
  });

  it("supports a custom day boundary for late-night eating", () => {
    const oneAm = zonedToInstant("2026-05-10", "01:15", "America/Chicago");
    expect(logicalDate(oneAm, "America/Chicago", 0)).toBe("2026-05-10");
    expect(logicalDate(oneAm, "America/Chicago", 3)).toBe("2026-05-09");
  });

  it("puts post-midnight night weigh-ins on the previous day", () => {
    const t = zonedToInstant("2026-05-10", "00:40", "America/Los_Angeles");
    expect(weightLocalDate(t, "America/Los_Angeles", "night")).toBe("2026-05-09");
    expect(weightLocalDate(t, "America/Los_Angeles", "morning")).toBe("2026-05-10");
  });

  it("round-trips wall-clock times across DST changes", () => {
    // US DST starts 2026-03-08 at 2 AM local.
    const before = zonedToInstant("2026-03-07", "08:00", "America/New_York");
    const after = zonedToInstant("2026-03-08", "08:00", "America/New_York");
    expect(after.getTime() - before.getTime()).toBe(23 * 3600 * 1000);
    expect(localParts(after, "America/New_York")).toMatchObject({ date: "2026-03-08", time: "08:00" });
  });

  it("does date arithmetic without time-zone drift", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(diffDays("2026-01-01", "2026-03-01")).toBe(59);
    expect(eachDate("2026-01-30", "2026-02-02")).toEqual(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
    expect(startOfWeek("2026-10-25", 1)).toBe("2026-10-19"); // Sunday → Monday before
    expect(startOfWeek("2026-10-25", 0)).toBe("2026-10-25");
  });

  it("computes preset ranges inclusively", () => {
    expect(presetRange("7d", "2026-10-26")).toEqual({ start: "2026-10-20", end: "2026-10-26" });
    expect(presetRange("6m", "2026-10-26").start).toBe("2026-04-27");
    expect(presetRange("all", "2026-10-26", "2025-01-01").start).toBe("2025-01-01");
  });
});

describe("logical-day time entry", () => {
  it("maps after-midnight times to the next calendar date", () => {
    const t = logicalDayTimeToInstant("2026-05-09", "01:30", "America/Chicago", 3);
    expect(localParts(t, "America/Chicago")).toMatchObject({ date: "2026-05-10", time: "01:30" });
    expect(logicalDate(t, "America/Chicago", 3)).toBe("2026-05-09");
    expect(localParts(logicalDayTimeToInstant("2026-05-09", "22:00", "America/Chicago", 3), "America/Chicago").date).toBe("2026-05-09");
  });
});
