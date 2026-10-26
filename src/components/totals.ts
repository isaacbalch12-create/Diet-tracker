import { isIncomplete, type NutrientTotals } from "@/lib/nutrition/calc";
import { NUTRIENT_KEYS, type NutrientKey, type NutrientProfile } from "@/lib/nutrition/nutrients";

/** Same shape as the server's TotalsView, computed in the browser for live editing. */
export function totalsViewClient(t: NutrientTotals): { values: NutrientProfile; incomplete: NutrientKey[] } {
  const values: NutrientProfile = {};
  const incomplete: NutrientKey[] = [];
  for (const k of NUTRIENT_KEYS) {
    values[k] = t.values[k];
    if (isIncomplete(t, k)) incomplete.push(k);
  }
  return { values, incomplete };
}
