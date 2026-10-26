/** Client-side helpers for building and editing meal items (math lives in nutrition/calc). */
import type { Portion } from "../db/schema";
import type { DraftItem } from "../drafts";
import { setNutrientTotal } from "../nutrition/calc";
import { knownValues, type NutrientKey, type NutrientProfile } from "../nutrition/nutrients";
import { newRequestId } from "./api";
import type { FoodSearchResultJ, MealItemJ } from "./types";

export const BASE_UNITS: Portion[] = [
  { label: "g", grams: 1 },
  { label: "oz", grams: 28.349523125 },
];

export function unitOptions(item: Pick<DraftItem, "unit" | "gramsPerUnit" | "portions">): Portion[] {
  const out: Portion[] = [];
  const seen = new Set<string>();
  const push = (p: Portion) => {
    const k = p.label.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  push({ label: item.unit, grams: item.gramsPerUnit });
  item.portions.forEach(push);
  BASE_UNITS.forEach(push);
  return out;
}

export function itemFromFood(food: FoodSearchResultJ): DraftItem {
  const portion = food.portions[0];
  return {
    key: newRequestId(),
    name: food.brand ? `${food.description} (${food.brand})` : food.description,
    quantity: portion ? 1 : 100,
    unit: portion ? portion.label : "g",
    gramsPerUnit: portion ? portion.grams : 1,
    nutrientsPer100g: knownValues(food.nutrientsPer100g),
    nutrientSource: "database",
    quantitySource: "manual",
    manualNutrients: [],
    foodId: food.id,
    sourceRef: { provider: food.source, fdcId: food.externalId ?? undefined, dataType: food.dataType, description: food.description },
    confidence: null,
    cookingMethod: null,
    isAssumed: false,
    notes: null,
    warnings: [],
    portions: food.portions,
    aiOriginal: null,
  };
}

/** Swap an item's nutrient data to a database food while keeping its amount in grams. */
export function rematchItem(item: DraftItem, food: FoodSearchResultJ): DraftItem {
  return {
    ...item,
    nutrientsPer100g: knownValues(food.nutrientsPer100g),
    nutrientSource: "database",
    manualNutrients: [],
    foodId: food.id,
    sourceRef: { provider: food.source, fdcId: food.externalId ?? undefined, dataType: food.dataType, description: food.description },
    portions: food.portions,
    warnings: [],
  };
}

export function manualItem(input: { name: string; grams: number; nutrients: NutrientProfile }): DraftItem {
  const per100: Partial<Record<NutrientKey, number>> = {};
  for (const [k, v] of Object.entries(input.nutrients)) if (typeof v === "number" && Number.isFinite(v)) per100[k as NutrientKey] = (v * 100) / input.grams;
  return {
    key: newRequestId(),
    name: input.name,
    quantity: input.grams,
    unit: "g",
    gramsPerUnit: 1,
    nutrientsPer100g: per100,
    nutrientSource: "manual",
    quantitySource: "manual",
    manualNutrients: Object.keys(per100) as NutrientKey[],
    foodId: null,
    sourceRef: null,
    confidence: null,
    cookingMethod: null,
    isAssumed: false,
    notes: null,
    warnings: [],
    portions: [],
    aiOriginal: null,
  };
}

export function withNutrientTotal(item: DraftItem, key: NutrientKey, total: number | null): DraftItem {
  const next = setNutrientTotal(item, key, total);
  return {
    ...item,
    nutrientsPer100g: knownValues(next),
    nutrientSource: "manual",
    manualNutrients: item.manualNutrients.includes(key) ? item.manualNutrients : [...item.manualNutrients, key],
  };
}

export function draftFromMealItem(i: MealItemJ): DraftItem {
  return {
    key: i.id,
    id: i.id,
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    gramsPerUnit: i.gramsPerUnit,
    nutrientsPer100g: knownValues(i.nutrientsPer100g),
    nutrientSource: i.nutrientSource,
    quantitySource: i.quantitySource,
    manualNutrients: i.manualNutrients,
    foodId: i.foodId,
    sourceRef: i.sourceRef,
    confidence: i.confidence,
    cookingMethod: i.cookingMethod,
    isAssumed: i.isAssumed,
    notes: i.notes,
    warnings: i.warnings,
    portions: i.portions,
    aiOriginal: i.aiOriginal,
  };
}

/** Strip client-only fields before sending to the API. */
export function toApiItem(item: DraftItem) {
  const { key: _key, ...rest } = item;
  void _key;
  return rest;
}
