/**
 * Canonical nutrient definitions. Every nutrient value stored in the database is
 * expressed per 100 g of food (or as a computed total for a given gram amount)
 * in the unit listed here. `null`/missing means "unknown", never zero.
 */

export const NUTRIENT_KEYS = [
  "calories",
  "protein",
  "carbs",
  "fat",
  "saturatedFat",
  "transFat",
  "fiber",
  "sugar",
  "sodium",
  "cholesterol",
  "potassium",
  "calcium",
  "iron",
  "magnesium",
  "zinc",
  "vitaminA",
  "vitaminC",
  "vitaminD",
  "vitaminB12",
  "folate",
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** A nutrient profile. Missing keys / null values mean "unknown". */
export type NutrientProfile = Partial<Record<NutrientKey, number | null>>;

/**
 * How a goal for this nutrient is judged:
 * - `target`: met when intake is within ±10% of the goal (calories, carbs, fat)
 * - `min`: met when intake is at or above the goal (protein, fiber, vitamins…)
 * - `max`: met when intake is at or below the goal (sodium, saturated fat…)
 */
export type GoalType = "target" | "min" | "max";

export interface NutrientDef {
  key: NutrientKey;
  label: string;
  shortLabel: string;
  unit: "kcal" | "g" | "mg" | "µg";
  /** USDA FoodData Central nutrient ids (first match wins). */
  usdaIds: number[];
  /** USDA legacy nutrient numbers (used by some CSV exports instead of ids). */
  usdaNumbers: string[];
  primary: boolean;
  goalType: GoalType;
  /** Decimal places used for display only — storage keeps full precision. */
  decimals: number;
}

export const NUTRIENTS: NutrientDef[] = [
  { key: "calories", label: "Calories", shortLabel: "Cal", unit: "kcal", usdaIds: [1008, 2047, 2048], usdaNumbers: ["208", "957", "958"], primary: true, goalType: "target", decimals: 0 },
  { key: "protein", label: "Protein", shortLabel: "Protein", unit: "g", usdaIds: [1003], usdaNumbers: ["203"], primary: true, goalType: "min", decimals: 1 },
  { key: "carbs", label: "Carbohydrates", shortLabel: "Carbs", unit: "g", usdaIds: [1005, 1050], usdaNumbers: ["205", "205.2"], primary: true, goalType: "target", decimals: 1 },
  { key: "fat", label: "Fat", shortLabel: "Fat", unit: "g", usdaIds: [1004, 1085], usdaNumbers: ["204", "298"], primary: true, goalType: "target", decimals: 1 },
  { key: "saturatedFat", label: "Saturated fat", shortLabel: "Sat. fat", unit: "g", usdaIds: [1258], usdaNumbers: ["606"], primary: false, goalType: "max", decimals: 1 },
  { key: "transFat", label: "Trans fat", shortLabel: "Trans fat", unit: "g", usdaIds: [1257], usdaNumbers: ["605"], primary: false, goalType: "max", decimals: 2 },
  { key: "fiber", label: "Fiber", shortLabel: "Fiber", unit: "g", usdaIds: [1079], usdaNumbers: ["291"], primary: false, goalType: "min", decimals: 1 },
  { key: "sugar", label: "Sugar", shortLabel: "Sugar", unit: "g", usdaIds: [2000, 1063], usdaNumbers: ["269", "269.3"], primary: false, goalType: "max", decimals: 1 },
  { key: "sodium", label: "Sodium", shortLabel: "Sodium", unit: "mg", usdaIds: [1093], usdaNumbers: ["307"], primary: false, goalType: "max", decimals: 0 },
  { key: "cholesterol", label: "Cholesterol", shortLabel: "Chol.", unit: "mg", usdaIds: [1253], usdaNumbers: ["601"], primary: false, goalType: "max", decimals: 0 },
  { key: "potassium", label: "Potassium", shortLabel: "Potassium", unit: "mg", usdaIds: [1092], usdaNumbers: ["306"], primary: false, goalType: "min", decimals: 0 },
  { key: "calcium", label: "Calcium", shortLabel: "Calcium", unit: "mg", usdaIds: [1087], usdaNumbers: ["301"], primary: false, goalType: "min", decimals: 0 },
  { key: "iron", label: "Iron", shortLabel: "Iron", unit: "mg", usdaIds: [1089], usdaNumbers: ["303"], primary: false, goalType: "min", decimals: 1 },
  { key: "magnesium", label: "Magnesium", shortLabel: "Magnesium", unit: "mg", usdaIds: [1090], usdaNumbers: ["304"], primary: false, goalType: "min", decimals: 0 },
  { key: "zinc", label: "Zinc", shortLabel: "Zinc", unit: "mg", usdaIds: [1095], usdaNumbers: ["309"], primary: false, goalType: "min", decimals: 1 },
  { key: "vitaminA", label: "Vitamin A (RAE)", shortLabel: "Vit. A", unit: "µg", usdaIds: [1106], usdaNumbers: ["320"], primary: false, goalType: "min", decimals: 0 },
  { key: "vitaminC", label: "Vitamin C", shortLabel: "Vit. C", unit: "mg", usdaIds: [1162], usdaNumbers: ["401"], primary: false, goalType: "min", decimals: 1 },
  { key: "vitaminD", label: "Vitamin D", shortLabel: "Vit. D", unit: "µg", usdaIds: [1114], usdaNumbers: ["328"], primary: false, goalType: "min", decimals: 1 },
  { key: "vitaminB12", label: "Vitamin B12", shortLabel: "Vit. B12", unit: "µg", usdaIds: [1178], usdaNumbers: ["418"], primary: false, goalType: "min", decimals: 2 },
  { key: "folate", label: "Folate (DFE)", shortLabel: "Folate", unit: "µg", usdaIds: [1190], usdaNumbers: ["435"], primary: false, goalType: "min", decimals: 0 },
];

export const NUTRIENT_BY_KEY: Record<NutrientKey, NutrientDef> = Object.fromEntries(
  NUTRIENTS.map((n) => [n.key, n]),
) as Record<NutrientKey, NutrientDef>;

export const PRIMARY_KEYS: NutrientKey[] = ["calories", "protein", "carbs", "fat"];
export const SECONDARY_KEYS: NutrientKey[] = NUTRIENTS.filter((n) => !n.primary).map((n) => n.key);

export function isNutrientKey(value: string): value is NutrientKey {
  return (NUTRIENT_KEYS as readonly string[]).includes(value);
}

/** Lookup tables used when importing USDA data: id or legacy number -> key (in priority order). */
export function buildUsdaLookup(): Map<string, { key: NutrientKey; priority: number }> {
  const map = new Map<string, { key: NutrientKey; priority: number }>();
  for (const def of NUTRIENTS) {
    def.usdaIds.forEach((id, i) => map.set(`id:${id}`, { key: def.key, priority: i }));
    def.usdaNumbers.forEach((nbr, i) => map.set(`nbr:${nbr}`, { key: def.key, priority: i }));
  }
  return map;
}

/** Remove non-finite numbers and unknown keys; keeps nulls out entirely. */
export function cleanProfile(input: Record<string, unknown> | null | undefined): NutrientProfile {
  const out: NutrientProfile = {};
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    if (!isNutrientKey(k)) continue;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

/** Drop unknown (null) entries, leaving only known numeric values. */
export function knownValues(p: NutrientProfile): Partial<Record<NutrientKey, number>> {
  const out: Partial<Record<NutrientKey, number>> = {};
  for (const [k, v] of Object.entries(p)) if (typeof v === "number" && Number.isFinite(v)) out[k as NutrientKey] = v;
  return out;
}
