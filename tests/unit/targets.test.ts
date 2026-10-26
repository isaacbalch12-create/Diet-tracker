import { describe, expect, it } from "vitest";
import { suggestTargets } from "@/lib/nutrition/targets";

describe("optional target suggestions", () => {
  it("computes maintenance from Mifflin–St Jeor × activity and splits macros", () => {
    const s = suggestTargets({ sex: "male", age: 35, heightCm: 180, weightKg: 85, activity: "moderate", aim: "maintain" });
    expect(s.restingKcal).toBe(Math.round(10 * 85 + 6.25 * 180 - 5 * 35 + 5));
    expect(s.maintenanceKcal).toBe(Math.round(s.restingKcal * 1.55));
    expect(s.protein).toBe(136);
    expect(s.protein * 4 + s.carbs * 4 + s.fat * 9).toBeGreaterThan(s.calories - 20);
  });

  it("caps deficits and never suggests below the calorie floor", () => {
    const lose = suggestTargets({ sex: "female", age: 60, heightCm: 150, weightKg: 50, activity: "sedentary", aim: "lose" });
    expect(lose.calories).toBe(1200);
    expect(lose.floorApplied).toBe(true);
    const mild = suggestTargets({ sex: "male", age: 30, heightCm: 180, weightKg: 90, activity: "light", aim: "lose_slow" });
    expect(mild.calories).toBeCloseTo(mild.maintenanceKcal * 0.9, -1);
  });
});
