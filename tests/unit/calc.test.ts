import { describe, expect, it } from "vitest";
import {
  calorieDisagreement,
  isIncomplete,
  itemGrams,
  itemNutrients,
  itemsTotals,
  mergeTotals,
  proteinPer100Kcal,
  setNutrientTotal,
} from "@/lib/nutrition/calc";
import { cleanProfile } from "@/lib/nutrition/nutrients";
import { formatWeightDelta, fromKg, toKg } from "@/lib/units";

const egg = { quantity: 2, gramsPerUnit: 50, nutrientsPer100g: { calories: 143, protein: 12.6, carbs: 0.72, fat: 9.5, sodium: 142 } };
const toast = { quantity: 1, gramsPerUnit: 30, nutrientsPer100g: { calories: 293, protein: 9, carbs: 54, fat: 4 } };

describe("nutrition math", () => {
  it("scales per-100 g values by grams", () => {
    expect(itemGrams(egg)).toBe(100);
    const n = itemNutrients({ ...egg, quantity: 3 });
    expect(n.calories).toBeCloseTo(214.5, 6);
    expect(n.protein).toBeCloseTo(18.9, 6);
  });

  it("keeps full precision and only rounds for display", () => {
    const n = itemNutrients({ quantity: 1, gramsPerUnit: 33.3, nutrientsPer100g: { calories: 101 } });
    expect(n.calories).toBeCloseTo(33.633, 10);
  });

  it("sums totals and tracks nutrients missing from some items", () => {
    const totals = itemsTotals([egg, toast]);
    expect(totals.values.calories).toBeCloseTo(143 + 87.9, 6);
    expect(totals.values.sodium).toBeCloseTo(142, 6);
    expect(totals.known.sodium).toBe(1);
    expect(isIncomplete(totals, "sodium")).toBe(true);
    expect(isIncomplete(totals, "calories")).toBe(false);
    expect(totals.values.fiber).toBeNull();
  });

  it("merges meal totals into a day total", () => {
    const day = mergeTotals([itemsTotals([egg]), itemsTotals([toast])]);
    expect(day.count).toBe(2);
    expect(day.values.protein).toBeCloseTo(12.6 + 2.7, 6);
  });

  it("back-solves per-100 g values when a total is edited, so quantity edits keep the correction", () => {
    const per100 = setNutrientTotal(egg, "calories", 180);
    expect(per100.calories).toBeCloseTo(180, 6); // 100 g
    const tripled = itemNutrients({ ...egg, quantity: 3, nutrientsPer100g: per100 });
    expect(tripled.calories).toBeCloseTo(270, 6);
  });

  it("flags large disagreements between database and AI calorie densities", () => {
    expect(calorieDisagreement(100, 110)).toBeCloseTo(1.1);
    expect(calorieDisagreement(50, 400)).toBe(8);
    expect(calorieDisagreement(0, 2)).toBe(1);
    expect(calorieDisagreement(null, 100)).toBeNull();
  });

  it("ranks protein density", () => {
    expect(proteinPer100Kcal({ protein: 31, calories: 165 })).toBeCloseTo(18.79, 2);
    expect(proteinPer100Kcal({ protein: 5 })).toBeNull();
  });

  it("drops invalid nutrient values instead of treating them as zero", () => {
    expect(cleanProfile({ calories: 100, protein: Number.NaN, fat: -1, nonsense: 5, carbs: 0 })).toEqual({ calories: 100, carbs: 0 });
  });
});

describe("units", () => {
  it("converts pounds and kilograms exactly", () => {
    expect(toKg(180, "lb")).toBeCloseTo(81.6466266, 6);
    expect(fromKg(toKg(180.4, "lb"), "lb")).toBeCloseTo(180.4, 10);
    expect(formatWeightDelta(-0.5, "lb")).toBe("−1.1 lb");
    expect(formatWeightDelta(0.01, "kg")).toBe("±0 kg");
  });
});
