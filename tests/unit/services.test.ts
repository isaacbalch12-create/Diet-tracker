import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/lib/db";
import { createMeal, deleteMeal, duplicateMeal, getMeal, updateMeal } from "@/lib/services/meals";
import { getSettings, listGoals, setGoals, updateSettings } from "@/lib/services/settings";
import { analyticsOverview, daySummary } from "@/lib/services/stats";
import { createWeight, deleteWeight, updateWeight, weightOverview } from "@/lib/services/weights";
import { logSavedMeal, saveMealAsFavorite } from "@/lib/services/saved-meals";
import { dailyCsv, fullBackup, mealItemsCsv, restoreBackup, weightsCsv } from "@/lib/services/export";
import { createMealSchema, updateMealSchema, weightInputSchema } from "@/lib/validation";
import type { Settings } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

let db: Db;
let s: Settings;

const egg = {
  name: "Egg, fried",
  quantity: 2,
  unit: "large",
  gramsPerUnit: 50,
  nutrientsPer100g: { calories: 196, protein: 13.6, carbs: 0.8, fat: 14.8 },
  nutrientSource: "database" as const,
  quantitySource: "user_stated" as const,
};
const toast = {
  name: "Toast",
  quantity: 2,
  unit: "slice",
  gramsPerUnit: 25,
  nutrientsPer100g: { calories: 293, protein: 9, carbs: 54, fat: 4, fiber: 2.5 },
  nutrientSource: "ai_estimate" as const,
  quantitySource: "ai_estimate" as const,
};

function mealInput(over: Record<string, unknown> = {}) {
  return createMealSchema.parse({
    eatenAt: "2026-10-26T13:30:00Z", // 08:30 in Chicago
    category: "Breakfast",
    title: "Eggs and toast",
    source: "manual",
    items: [egg, toast],
    ...over,
  });
}

beforeEach(async () => {
  db = await createMemoryDb();
  s = await updateSettings(db, { timezone: "America/Chicago", weightUnit: "lb" });
});

describe("meals", () => {
  it("creates a meal, assigns the local day, and computes totals", async () => {
    const { meal } = await createMeal(db, mealInput(), s);
    expect(meal.localDate).toBe("2026-10-26");
    expect(meal.totals.values.calories).toBeCloseTo(196 + 146.5, 6);
    expect(meal.totals.incomplete).toContain("fiber");
  });

  it("assigns a late-night meal to the correct day in the user's zone", async () => {
    const { meal } = await createMeal(db, mealInput({ eatenAt: "2026-10-27T04:45:00Z" }), s); // 11:45 PM Chicago on the 26th
    expect(meal.localDate).toBe("2026-10-26");
  });

  it("does not duplicate a meal when a save is retried with the same request id", async () => {
    const a = await createMeal(db, mealInput({ clientRequestId: "req-12345678" }), s);
    const b = await createMeal(db, mealInput({ clientRequestId: "req-12345678" }), s);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.meal.id).toBe(a.meal.id);
    const day = await daySummary(db, "2026-10-26");
    expect(day.meals).toHaveLength(1);
  });

  it("updates daily totals after adding, editing and deleting meals", async () => {
    const { meal } = await createMeal(db, mealInput(), s);
    let day = await daySummary(db, "2026-10-26");
    expect(day.totals.values.calories).toBeCloseTo(342.5, 6);

    // Edit the egg quantity (keep ids) and drop the toast.
    const items = meal.items.slice(0, 1).map((i) => ({ ...i, quantity: 3 }));
    await updateMeal(db, meal.id, updateMealSchema.parse({ items }), s);
    day = await daySummary(db, "2026-10-26");
    expect(day.totals.values.calories).toBeCloseTo(294, 6);
    const edited = await getMeal(db, meal.id);
    expect(edited.items).toHaveLength(1);
    expect(edited.items[0].id).toBe(meal.items[0].id);

    const second = await createMeal(db, mealInput({ category: "Lunch", eatenAt: "2026-10-26T18:00:00Z" }), s);
    day = await daySummary(db, "2026-10-26");
    expect(day.meals.map((m) => m.category)).toEqual(["Breakfast", "Lunch"]);
    expect(day.topContributors.calories[0].mealId).toBe(second.meal.id);

    await deleteMeal(db, meal.id);
    day = await daySummary(db, "2026-10-26");
    expect(day.totals.values.calories).toBeCloseTo(342.5, 6);
    expect(day.meals).toHaveLength(1);
  });

  it("moves a meal to another day when its time changes", async () => {
    const { meal } = await createMeal(db, mealInput(), s);
    await updateMeal(db, meal.id, updateMealSchema.parse({ eatenAt: "2026-10-25T23:00:00Z" }), s);
    expect((await daySummary(db, "2026-10-26")).meals).toHaveLength(0);
    expect((await daySummary(db, "2026-10-25")).meals).toHaveLength(1);
  });

  it("duplicates meals and logs saved meals as independent copies", async () => {
    const { meal } = await createMeal(db, mealInput(), s);
    const copy = await duplicateMeal(db, meal.id, { eatenAt: new Date("2026-10-27T13:00:00Z") }, s);
    expect(copy.localDate).toBe("2026-10-27");
    expect(copy.items.map((i) => i.id)).not.toContain(meal.items[0].id);
    const fav = await saveMealAsFavorite(db, meal.id, "Usual breakfast");
    const logged = await logSavedMeal(db, fav.id, { eatenAt: new Date("2026-10-28T13:00:00Z"), servings: 2 }, s);
    expect(logged.totals.values.calories).toBeCloseTo(2 * 342.5, 6);
    await deleteMeal(db, meal.id);
    expect((await getMeal(db, copy.id)).items).toHaveLength(2);
  });
});

describe("weights", () => {
  it("prevents silent duplicates for the same day and period", async () => {
    await createWeight(db, weightInputSchema.parse({ value: 180, unit: "lb", period: "morning", measuredAt: "2026-10-26T12:00:00Z" }), s);
    await expect(createWeight(db, weightInputSchema.parse({ value: 181, unit: "lb", period: "morning", measuredAt: "2026-10-26T13:00:00Z" }), s)).rejects.toBeInstanceOf(AppError);
    const replaced = await createWeight(db, weightInputSchema.parse({ value: 181, unit: "lb", period: "morning", measuredAt: "2026-10-26T13:00:00Z", replace: true }), s);
    expect(replaced.inputValue).toBe(181);
  });

  it("files a just-after-midnight night weigh-in under the previous day", async () => {
    const w = await createWeight(db, weightInputSchema.parse({ value: 182, unit: "lb", period: "night", measuredAt: "2026-10-27T05:30:00Z" }), s); // 12:30 AM Chicago
    expect(w.localDate).toBe("2026-10-26");
  });

  it("edits, deletes and summarizes weights", async () => {
    for (let i = 0; i < 10; i++) {
      const d = String(10 + i).padStart(2, "0");
      await createWeight(db, weightInputSchema.parse({ value: 180 - i * 0.2, unit: "lb", period: "morning", localDate: `2026-10-${d}`, measuredAt: `2026-10-${d}T12:00:00Z` }), s);
    }
    const w = await createWeight(db, weightInputSchema.parse({ value: 182, unit: "lb", period: "night", localDate: "2026-10-19", measuredAt: "2026-10-20T03:00:00Z" }), s);
    await updateWeight(db, w.id, { value: 181.5 });
    const ov = await weightOverview(db, { start: "2026-10-10", end: "2026-10-19" }, s, "2026-10-19");
    const last = ov.days.at(-1)!;
    expect(last.fluctuation).toBeCloseTo((181.5 - 178.2) * 0.45359237, 6);
    expect(ov.summary.changeVsPreviousDay.value).not.toBeNull();
    expect(ov.trend!.slopePerWeek).toBeLessThan(0);
    await deleteWeight(db, w.id);
    const ov2 = await weightOverview(db, { start: "2026-10-10", end: "2026-10-19" }, s, "2026-10-19");
    expect(ov2.days.at(-1)!.night).toBeNull();
  });
});

describe("goals", () => {
  it("versions goals so earlier days keep the goals they had", async () => {
    await setGoals(db, { calories: 2000, protein: 150 }, "2026-10-01");
    await createMeal(db, mealInput({ eatenAt: "2026-10-05T13:00:00Z" }), s);
    expect((await daySummary(db, "2026-10-05")).goals.calories).toBe(2000);
    await setGoals(db, { calories: 2500, protein: 180 }, "2026-10-20");
    expect((await daySummary(db, "2026-10-05")).goals.calories).toBe(2000);
    expect((await daySummary(db, "2026-10-20")).goals.calories).toBe(2500);
    expect(await listGoals(db)).toHaveLength(2);
    await expect(setGoals(db, { calories: 1 }, "2026-10-20").then(() => setGoals(db, { calories: 3000, effectiveFrom: "2026-10-01" }, "2026-10-20"))).rejects.toThrow(/past days/);
  });
});

describe("analytics, export and backup", () => {
  it("produces analytics and round-trips a full backup", async () => {
    await setGoals(db, { calories: 2000, protein: 150 }, "2026-10-01");
    await createMeal(db, mealInput(), s);
    await createWeight(db, weightInputSchema.parse({ value: 180, unit: "lb", period: "morning", measuredAt: "2026-10-26T12:00:00Z" }), s);
    const ov = await analyticsOverview(db, { start: "2026-10-20", end: "2026-10-26" }, s);
    expect(ov.nutrition.range.loggedDays).toBe(1);
    expect(ov.weight.loggedDays).toBe(1);

    expect(await weightsCsv(db)).toContain("2026-10-26,morning");
    const items = await mealItemsCsv(db, { start: "2026-10-26", end: "2026-10-26" });
    expect(items.split("\r\n")[1]).toContain("Eggs and toast");
    const daily = await dailyCsv(db, { start: "2026-10-25", end: "2026-10-26" });
    expect(daily.split("\r\n")).toHaveLength(4);

    const backup = JSON.parse(JSON.stringify(await fullBackup(db, { includeImages: true })));
    const fresh = await createMemoryDb();
    const res = await restoreBackup(fresh, backup);
    expect(res).toEqual({ meals: 1, weights: 1 });
    const day = await daySummary(fresh, "2026-10-26");
    expect(day.totals.values.calories).toBeCloseTo(342.5, 6);
    expect((await getSettings(fresh)).timezone).toBe("America/Chicago");
  });
});
