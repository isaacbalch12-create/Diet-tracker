import { describe, expect, it } from "vitest";
import { summarizeNutrition, type DayNutrition } from "@/lib/analytics/nutrition";
import { analyzeRelationship, pearson } from "@/lib/analytics/relationship";
import { itemsTotals } from "@/lib/nutrition/calc";
import { evaluateGoal, goalForDate, type GoalVersion } from "@/lib/nutrition/goals";
import { addDays } from "@/lib/time";
import { dailySeries } from "@/lib/weight/stats";

function day(date: string, meals: { category: string; calories: number; protein: number }[]): DayNutrition {
  const totalsOf = (ms: typeof meals) =>
    itemsTotals(ms.map((m) => ({ quantity: 1, gramsPerUnit: 100, nutrientsPer100g: { calories: m.calories, protein: m.protein, carbs: 0, fat: 0 } })));
  const byCategory: DayNutrition["byCategory"] = {};
  for (const cat of new Set(meals.map((m) => m.category))) {
    const ms = meals.filter((m) => m.category === cat);
    byCategory[cat] = { ...totalsOf(ms), meals: ms.length };
  }
  return { date, mealCount: meals.length, totals: totalsOf(meals), byCategory };
}

const goalsV: GoalVersion[] = [
  { effectiveFrom: "2000-01-01", calories: 2000, protein: 150, carbs: null, fat: null, extra: {} },
  { effectiveFrom: "2026-10-05", calories: 2500, protein: 180, carbs: null, fat: null, extra: { sodium: 2300 } },
];

describe("goals", () => {
  it("applies the goal version in force on each day (no retroactive changes)", () => {
    expect(goalForDate(goalsV, "2026-10-04")!.calories).toBe(2000);
    expect(goalForDate(goalsV, "2026-10-05")!.calories).toBe(2500);
  });

  it("judges target, minimum and maximum goals", () => {
    expect(evaluateGoal("calories", 2150, 2000).met).toBe(true);
    expect(evaluateGoal("calories", 2300, 2000).status).toBe("over");
    expect(evaluateGoal("protein", 149, 150).status).toBe("under");
    expect(evaluateGoal("sodium", 2400, 2300).status).toBe("over");
    expect(evaluateGoal("calories", 1500, 2000).remaining).toBe(500);
  });
});

describe("nutrition summary", () => {
  const days = [
    day("2026-10-01", [{ category: "Breakfast", calories: 500, protein: 30 }, { category: "Dinner", calories: 1500, protein: 120 }]),
    day("2026-10-02", [{ category: "Lunch", calories: 2600, protein: 100 }]),
    // 10-03 not logged
    day("2026-10-04", [{ category: "Breakfast", calories: 1900, protein: 160 }]),
    day("2026-10-05", [{ category: "Dinner", calories: 2400, protein: 185 }]),
  ];
  const s = summarizeNutrition(days, { start: "2026-10-01", end: "2026-10-05" }, goalsV);

  it("averages only logged days", () => {
    expect(s.range).toMatchObject({ totalDays: 5, loggedDays: 4 });
    expect(s.averages.calories.value).toBeCloseTo((2000 + 2600 + 1900 + 2400) / 4, 10);
    expect(s.daily.find((d) => d.date === "2026-10-03")!.calories).toBeNull();
  });

  it("finds extremes", () => {
    expect(s.extremes.calories.highest).toEqual({ date: "2026-10-02", value: 2600 });
    expect(s.extremes.protein.lowest).toEqual({ date: "2026-10-02", value: 100 });
  });

  it("measures adherence against the goals in force each day", () => {
    // calories met: 10-01 (2000/2000), 10-04 (1900/2000), 10-05 (2400/2500); 10-02 over.
    expect(s.adherence.calories).toMatchObject({ evaluated: 4, met: 3 });
    // protein met: 10-01 (150 ≥ 150), 10-04 (160 ≥ 150), 10-05 (185 ≥ 180); 10-02 under.
    expect(s.adherence.protein).toMatchObject({ evaluated: 4, met: 3 });
    expect(s.allPrimaryMetPct).toBeCloseTo(3 / 4, 10);
  });

  it("reports meal composition, streaks and meals per day", () => {
    expect(s.avgMealsPerDay).toBeCloseTo(5 / 4, 10);
    const dinner = s.categories.find((c) => c.category === "Dinner")!;
    expect(dinner.avgCalories).toBeCloseTo((1500 + 2400) / 4, 10);
    expect(s.consistency).toMatchObject({ longestStreak: 2, currentStreak: 2 });
  });
});

describe("weight vs nutrition relationship", () => {
  it("computes Pearson correlation", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });

  it("refuses to draw conclusions from too little data", () => {
    const rel = analyzeRelationship([], [], { start: "2026-10-01", end: "2026-10-07" });
    expect(rel.correlation).toBeNull();
    expect(rel.observations[0].kind).toBe("insufficient");
  });

  it("estimates maintenance only with enough logged days and weigh-ins", () => {
    const start = "2026-08-03"; // Monday
    const nDays: DayNutrition[] = [];
    const readings = [];
    for (let i = 0; i < 56; i++) {
      const date = addDays(start, i);
      // alternate high/low calorie weeks; weight follows with a lag
      const week = Math.floor(i / 7);
      const kcal = week % 2 === 0 ? 2800 : 2000;
      nDays.push(day(date, [{ category: "Dinner", calories: kcal, protein: 150 }]));
      readings.push({ localDate: date, period: "morning" as const, weightKg: 80 + (week % 2 === 0 ? 0.1 : -0.1) * (i % 7) - i * 0.02 });
    }
    const wDays = dailySeries(readings, start, addDays(start, 55));
    const rel = analyzeRelationship(nDays, wDays, { start, end: addDays(start, 55) });
    expect(rel.weeks).toHaveLength(8);
    expect(rel.correlation!.n).toBe(7);
    expect(rel.energyBalance).not.toBeNull();
    expect(rel.energyBalance!.avgCalories).toBeCloseTo(2400, 6);
    expect(rel.observations.some((o) => /not proof of cause|no clear link/.test(o.text))).toBe(true);
  });
});
