/**
 * Deterministic nutrition math. This module is intentionally independent from the
 * AI layer: every total shown in the app is recomputed from (grams × per-100 g
 * values), so it can always be checked and re-derived.
 *
 * Storage keeps full precision; rounding happens only in formatting helpers.
 */
import { NUTRIENT_KEYS, type NutrientKey, type NutrientProfile } from "./nutrients";

export interface ItemAmount {
  quantity: number;
  gramsPerUnit: number;
}

export interface CalcItem extends ItemAmount {
  nutrientsPer100g: NutrientProfile;
}

/** A computed total plus how complete the underlying data is. */
export interface NutrientTotals {
  /** Sum of known values; null when no contributing item reports this nutrient. */
  values: Record<NutrientKey, number | null>;
  /** Number of contributing items that report the nutrient. */
  known: Record<NutrientKey, number>;
  /** Number of contributing items in total. */
  count: number;
}

export function itemGrams(item: ItemAmount): number {
  const g = item.quantity * item.gramsPerUnit;
  return Number.isFinite(g) && g > 0 ? g : 0;
}

/** Scale a per-100 g profile to an absolute amount. Unknown stays unknown. */
export function scaleProfile(per100g: NutrientProfile, grams: number): NutrientProfile {
  const out: NutrientProfile = {};
  for (const key of NUTRIENT_KEYS) {
    const v = per100g[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = (v * grams) / 100;
  }
  return out;
}

export function itemNutrients(item: CalcItem): NutrientProfile {
  return scaleProfile(item.nutrientsPer100g, itemGrams(item));
}

export function emptyTotals(): NutrientTotals {
  const values = {} as Record<NutrientKey, number | null>;
  const known = {} as Record<NutrientKey, number>;
  for (const key of NUTRIENT_KEYS) {
    values[key] = null;
    known[key] = 0;
  }
  return { values, known, count: 0 };
}

/** Sum absolute nutrient profiles (e.g. item totals) while tracking completeness. */
export function sumProfiles(profiles: NutrientProfile[]): NutrientTotals {
  const totals = emptyTotals();
  totals.count = profiles.length;
  for (const p of profiles) {
    for (const key of NUTRIENT_KEYS) {
      const v = p[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        totals.values[key] = (totals.values[key] ?? 0) + v;
        totals.known[key] += 1;
      }
    }
  }
  return totals;
}

/** Merge several totals (e.g. meal totals into a day total). */
export function mergeTotals(list: NutrientTotals[]): NutrientTotals {
  const totals = emptyTotals();
  for (const t of list) {
    totals.count += t.count;
    for (const key of NUTRIENT_KEYS) {
      const v = t.values[key];
      if (v !== null) totals.values[key] = (totals.values[key] ?? 0) + v;
      totals.known[key] += t.known[key];
    }
  }
  return totals;
}

export function itemsTotals(items: CalcItem[]): NutrientTotals {
  return sumProfiles(items.map(itemNutrients));
}

/** True when at least one contributing item is missing this nutrient. */
export function isIncomplete(totals: NutrientTotals, key: NutrientKey): boolean {
  return totals.count > 0 && totals.known[key] < totals.count;
}

/** Plain value map (unknown → null) for APIs and exports. */
export function totalsToProfile(totals: NutrientTotals): NutrientProfile {
  const out: NutrientProfile = {};
  for (const key of NUTRIENT_KEYS) out[key] = totals.values[key];
  return out;
}

/**
 * Overwrite the absolute amount of one nutrient for an item, by back-solving the
 * per-100 g value. Changing grams later keeps the corrected density.
 */
export function setNutrientTotal(item: CalcItem, key: NutrientKey, total: number | null): NutrientProfile {
  const grams = itemGrams(item);
  const next: NutrientProfile = { ...item.nutrientsPer100g };
  if (total === null) {
    delete next[key];
    return next;
  }
  if (grams <= 0) throw new Error("Cannot set a nutrient total for an item with zero grams");
  next[key] = (total * 100) / grams;
  return next;
}

/** Calories implied by macros (Atwater 4/4/9). Used only for plausibility checks. */
export function atwaterCalories(p: NutrientProfile): number | null {
  if (p.protein == null || p.carbs == null || p.fat == null) return null;
  return p.protein * 4 + p.carbs * 4 + p.fat * 9;
}

/**
 * Plausibility check between two per-100 g calorie values (database vs AI estimate).
 * Returns a ratio > 1 describing how far apart they are, or null when not comparable.
 */
export function calorieDisagreement(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  if (a < 5 && b < 5) return 1; // both ~zero-calorie (water, black coffee…)
  const lo = Math.max(Math.min(a, b), 1);
  const hi = Math.max(a, b);
  return hi / lo;
}

/** Share of calories from each macro (0–1), from absolute grams. */
export function macroCalorieSplit(p: NutrientProfile): { protein: number; carbs: number; fat: number } | null {
  const kcal = atwaterCalories(p);
  if (!kcal) return null;
  return {
    protein: ((p.protein ?? 0) * 4) / kcal,
    carbs: ((p.carbs ?? 0) * 4) / kcal,
    fat: ((p.fat ?? 0) * 9) / kcal,
  };
}

/** Grams of protein per 100 kcal — used to rank "protein for the calories". */
export function proteinPer100Kcal(p: NutrientProfile): number | null {
  if (p.protein == null || p.calories == null || p.calories <= 0) return null;
  return (p.protein / p.calories) * 100;
}
