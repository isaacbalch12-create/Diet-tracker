/**
 * Parsing for USDA FoodData Central CSV downloads (SR Legacy and FNDDS survey
 * foods). Nutrient amounts in these datasets are per 100 g of food.
 */
import Papa from "papaparse";
import type { Portion } from "../db/schema";
import { buildUsdaLookup, type NutrientKey, type NutrientProfile } from "../nutrition/nutrients";

export type UsdaDataType = "sr_legacy" | "fndds" | "foundation" | "branded";

export interface NormalizedFood {
  externalId: string;
  dataType: UsdaDataType;
  description: string;
  brand: string | null;
  category: string | null;
  nutrientsPer100g: NutrientProfile;
  portions: Portion[];
}

type Row = Record<string, string>;

function eachRow(csv: string, fn: (row: Row) => void) {
  Papa.parse<Row>(csv, {
    header: true,
    skipEmptyLines: true,
    step: (result) => fn(result.data),
  });
}

function rows(csv: string): Row[] {
  const out: Row[] = [];
  eachRow(csv, (r) => out.push(r));
  return out;
}

const SKIP_PORTION = /guideline amount|quantity not specified/i;

/** "1 large" → "large"; "0.5 cup" stays as is. */
export function normalizePortionLabel(label: string): string {
  const trimmed = label.replace(/\s+/g, " ").trim();
  const m = /^1(?:\.0+)?\s+(.+)$/.exec(trimmed);
  return m ? m[1] : trimmed;
}

export function dedupePortions(portions: Portion[]): Portion[] {
  const seen = new Set<string>();
  const out: Portion[] = [];
  for (const p of portions) {
    if (!(p.grams > 0) || !p.label) continue;
    const key = `${p.label.toLowerCase()}|${p.grams.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.slice(0, 12);
}

/**
 * Parse one dataset given its CSV files (by base name, e.g. "food.csv").
 */
export function parseUsdaCsv(files: Record<string, string>, dataType: UsdaDataType): NormalizedFood[] {
  const lookup = buildUsdaLookup();
  const required = ["food.csv", "food_nutrient.csv"];
  for (const f of required) if (!files[f]) throw new Error(`Missing ${f} in USDA dataset`);

  const categories = new Map<string, string>();
  for (const r of rows(files["food_category.csv"] ?? "")) categories.set(r.id, r.description);
  for (const r of rows(files["wweia_food_category.csv"] ?? "")) categories.set(r.wweia_food_category ?? r.id, r.wweia_food_category_description ?? r.description);

  const units = new Map<string, string>();
  for (const r of rows(files["measure_unit.csv"] ?? "")) units.set(r.id, r.name);

  const foods = new Map<string, NormalizedFood>();
  for (const r of rows(files["food.csv"])) {
    foods.set(r.fdc_id, {
      externalId: r.fdc_id,
      dataType,
      description: r.description.trim(),
      brand: null,
      category: categories.get(r.food_category_id) ?? null,
      nutrientsPer100g: {},
      portions: [],
    });
  }

  // Track the priority of the id that supplied each nutrient (e.g. Energy 1008 beats Atwater 2047).
  const priorities = new Map<string, Partial<Record<NutrientKey, number>>>();
  eachRow(files["food_nutrient.csv"], (r) => {
    const food = foods.get(r.fdc_id);
    if (!food) return;
    const hit = lookup.get(`id:${r.nutrient_id}`) ?? lookup.get(`nbr:${r.nutrient_id}`);
    if (!hit) return;
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount < 0) return;
    const pri = priorities.get(r.fdc_id) ?? {};
    const existing = pri[hit.key];
    if (existing !== undefined && existing <= hit.priority) return;
    pri[hit.key] = hit.priority;
    priorities.set(r.fdc_id, pri);
    food.nutrientsPer100g[hit.key] = amount;
  });

  if (files["food_portion.csv"]) {
    eachRow(files["food_portion.csv"], (r) => {
      const food = foods.get(r.fdc_id);
      if (!food) return;
      const grams = Number(r.gram_weight);
      if (!(grams > 0)) return;
      let label = (r.portion_description ?? "").trim();
      if (!label) {
        const unit = units.get(r.measure_unit_id);
        const parts = [r.amount && Number(r.amount) > 0 ? String(Number(r.amount)) : "1", unit && unit !== "undetermined" ? unit : null, r.modifier?.trim() || null];
        label = parts.filter(Boolean).join(" ");
      }
      if (!label || SKIP_PORTION.test(label) || /^\d+$/.test(label)) return;
      food.portions.push({ label: normalizePortionLabel(label), grams });
    });
  }

  const out: NormalizedFood[] = [];
  for (const f of foods.values()) {
    // Foods without an energy value are not useful for logging (e.g. "Milk, human" in FNDDS).
    if (f.nutrientsPer100g.calories == null) continue;
    f.portions = dedupePortions(f.portions);
    out.push(f);
  }
  return out;
}

/** Shape of a food in FDC API search/detail responses (subset we use). */
export interface FdcApiFood {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  foodCategory?: string | { description?: string };
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: Array<{
    nutrientId?: number;
    nutrientNumber?: string;
    value?: number;
    amount?: number;
    nutrient?: { id?: number; number?: string };
  }>;
  foodMeasures?: Array<{ disseminationText?: string; gramWeight?: number }>;
  foodPortions?: Array<{ portionDescription?: string; modifier?: string; gramWeight?: number; amount?: number; measureUnit?: { name?: string } }>;
}

export function fdcDataType(dt: string | undefined): UsdaDataType {
  const v = (dt ?? "").toLowerCase();
  if (v.includes("survey")) return "fndds";
  if (v.includes("legacy")) return "sr_legacy";
  if (v.includes("branded")) return "branded";
  return "foundation";
}

export function normalizeFdcApiFood(f: FdcApiFood): NormalizedFood | null {
  const lookup = buildUsdaLookup();
  const nutrients: NutrientProfile = {};
  const pri: Partial<Record<NutrientKey, number>> = {};
  for (const n of f.foodNutrients ?? []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const nbr = n.nutrientNumber ?? n.nutrient?.number;
    const hit = (id !== undefined ? lookup.get(`id:${id}`) : undefined) ?? (nbr ? lookup.get(`nbr:${nbr}`) : undefined);
    const amount = n.value ?? n.amount;
    if (!hit || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) continue;
    const existing = pri[hit.key];
    if (existing !== undefined && existing <= hit.priority) continue;
    pri[hit.key] = hit.priority;
    nutrients[hit.key] = amount;
  }
  if (nutrients.calories == null) return null;
  const dataType = fdcDataType(f.dataType);
  const portions: Portion[] = [];
  for (const m of f.foodMeasures ?? []) {
    if (m.disseminationText && m.gramWeight && !SKIP_PORTION.test(m.disseminationText)) {
      portions.push({ label: normalizePortionLabel(m.disseminationText), grams: m.gramWeight });
    }
  }
  for (const p of f.foodPortions ?? []) {
    const label = p.portionDescription?.trim() || [p.amount ?? 1, p.measureUnit?.name !== "undetermined" ? p.measureUnit?.name : null, p.modifier].filter(Boolean).join(" ");
    if (label && p.gramWeight && !SKIP_PORTION.test(label)) portions.push({ label: normalizePortionLabel(label), grams: p.gramWeight });
  }
  if (dataType === "branded" && f.servingSize && /^(g|grm|ml|mlt)$/i.test(f.servingSizeUnit ?? "")) {
    portions.unshift({ label: f.householdServingFullText ? `serving (${f.householdServingFullText})` : "serving", grams: f.servingSize });
  }
  const category = typeof f.foodCategory === "string" ? f.foodCategory : (f.foodCategory?.description ?? null);
  return {
    externalId: String(f.fdcId),
    dataType,
    description: f.description.trim(),
    brand: f.brandName || f.brandOwner || null,
    category,
    nutrientsPer100g: nutrients,
    portions: dedupePortions(portions),
  };
}
