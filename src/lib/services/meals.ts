import { and, asc, desc, eq, gte, inArray, isNull, lte, min } from "drizzle-orm";
import type { z } from "zod";
import type { Db, DbOrTx } from "../db";
import { mealAnalyses, mealImages, mealItems, meals, type Meal, type MealItem, type Settings } from "../db/schema";
import { notFound } from "../errors";
import { type CalcItem, type NutrientTotals, isIncomplete, itemGrams, itemNutrients, itemsTotals, mergeTotals } from "../nutrition/calc";
import { NUTRIENT_KEYS, knownValues, type NutrientKey, type NutrientProfile } from "../nutrition/nutrients";
import { type LocalDate, logicalDate } from "../time";
import type { createMealSchema, MealItemInput, updateMealSchema } from "../validation";

export interface TotalsView {
  values: NutrientProfile;
  /** Nutrients where at least one food has no data (total is a lower bound). */
  incomplete: NutrientKey[];
  itemCount: number;
}

export interface MealItemView extends MealItem {
  grams: number;
  nutrients: NutrientProfile;
}

export interface MealView extends Meal {
  items: MealItemView[];
  totals: TotalsView;
  images: { id: string; url: string }[];
}

export function totalsView(t: NutrientTotals): TotalsView {
  const values: NutrientProfile = {};
  const incomplete: NutrientKey[] = [];
  for (const k of NUTRIENT_KEYS) {
    values[k] = t.values[k];
    if (isIncomplete(t, k)) incomplete.push(k);
  }
  return { values, incomplete, itemCount: t.count };
}

function toCalc(i: Pick<MealItem, "quantity" | "gramsPerUnit" | "nutrientsPer100g">): CalcItem {
  return { quantity: i.quantity, gramsPerUnit: i.gramsPerUnit, nutrientsPer100g: i.nutrientsPer100g };
}

export function mealTotalsRaw(items: Pick<MealItem, "quantity" | "gramsPerUnit" | "nutrientsPer100g">[]): NutrientTotals {
  return itemsTotals(items.map(toCalc));
}

function itemRow(mealId: string, item: MealItemInput, position: number) {
  return {
    mealId,
    position,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    gramsPerUnit: item.gramsPerUnit,
    nutrientsPer100g: item.nutrientsPer100g,
    nutrientSource: item.nutrientSource,
    quantitySource: item.quantitySource,
    manualNutrients: item.manualNutrients,
    foodId: item.foodId,
    sourceRef: item.sourceRef,
    confidence: item.confidence,
    cookingMethod: item.cookingMethod,
    isAssumed: item.isAssumed,
    notes: item.notes,
    warnings: item.warnings,
    portions: item.portions,
    aiOriginal: item.aiOriginal,
  };
}

async function hydrate(db: DbOrTx, rows: Meal[]): Promise<MealView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((m) => m.id);
  const [items, images] = await Promise.all([
    db.select().from(mealItems).where(inArray(mealItems.mealId, ids)).orderBy(asc(mealItems.position)),
    db.select({ id: mealImages.id, mealId: mealImages.mealId }).from(mealImages).where(inArray(mealImages.mealId, ids)).orderBy(asc(mealImages.createdAt)),
  ]);
  return rows.map((m) => {
    const its = items.filter((i) => i.mealId === m.id);
    return {
      ...m,
      items: its.map((i) => ({ ...i, grams: itemGrams(i), nutrients: itemNutrients(toCalc(i)) })),
      totals: totalsView(mealTotalsRaw(its)),
      images: images.filter((im) => im.mealId === m.id).map((im) => ({ id: im.id, url: `/api/images/${im.id}` })),
    };
  });
}

export async function getMeal(db: DbOrTx, id: string): Promise<MealView> {
  const [row] = await db.select().from(meals).where(eq(meals.id, id));
  if (!row) throw notFound("Meal");
  return (await hydrate(db, [row]))[0];
}

export async function listMeals(db: DbOrTx, range: { start: LocalDate; end: LocalDate }): Promise<MealView[]> {
  const rows = await db
    .select()
    .from(meals)
    .where(and(gte(meals.localDate, range.start), lte(meals.localDate, range.end)))
    .orderBy(asc(meals.localDate), asc(meals.eatenAt));
  return hydrate(db, rows);
}

export async function earliestMealDate(db: DbOrTx): Promise<LocalDate | null> {
  const [row] = await db.select({ d: min(meals.localDate) }).from(meals);
  return row?.d ?? null;
}

/**
 * Create a meal and its items in one transaction. A repeated `clientRequestId`
 * (e.g. a retried request after a network error) returns the original meal
 * instead of inserting a duplicate.
 */
export async function createMeal(db: Db, input: z.infer<typeof createMealSchema>, s: Settings): Promise<{ meal: MealView; created: boolean }> {
  if (input.clientRequestId) {
    const [dup] = await db.select().from(meals).where(eq(meals.clientRequestId, input.clientRequestId));
    if (dup) return { meal: await getMeal(db, dup.id), created: false };
  }
  const localDate = input.localDate ?? logicalDate(input.eatenAt, s.timezone, s.dayStartHour);
  const id = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(meals)
      .values({
        localDate,
        eatenAt: input.eatenAt,
        timezone: s.timezone,
        category: input.category,
        title: input.title,
        description: input.description ?? null,
        source: input.source,
        analysisId: input.analysisId ?? null,
        clientRequestId: input.clientRequestId ?? null,
        notes: input.notes ?? null,
      })
      .onConflictDoNothing({ target: meals.clientRequestId })
      .returning({ id: meals.id });
    if (inserted.length === 0) return null; // concurrent duplicate
    const mealId = inserted[0].id;
    await tx.insert(mealItems).values(input.items.map((it, i) => itemRow(mealId, it, i)));
    if (input.imageIds.length) {
      await tx.update(mealImages).set({ mealId }).where(and(inArray(mealImages.id, input.imageIds), isNull(mealImages.mealId)));
    }
    if (input.analysisId) {
      await tx.update(mealAnalyses).set({ status: "confirmed", mealId }).where(eq(mealAnalyses.id, input.analysisId));
    }
    return mealId;
  });
  if (id === null) {
    const [dup] = await db.select().from(meals).where(eq(meals.clientRequestId, input.clientRequestId!));
    return { meal: await getMeal(db, dup.id), created: false };
  }
  return { meal: await getMeal(db, id), created: true };
}

export async function updateMeal(db: Db, id: string, input: z.infer<typeof updateMealSchema>, s: Settings): Promise<MealView> {
  const [current] = await db.select().from(meals).where(eq(meals.id, id));
  if (!current) throw notFound("Meal");
  await db.transaction(async (tx) => {
    const patch: Partial<typeof meals.$inferInsert> = {};
    if (input.eatenAt) {
      patch.eatenAt = input.eatenAt;
      // Re-derive the day in the zone the meal was logged in, unless a date was given.
      patch.localDate = input.localDate ?? logicalDate(input.eatenAt, current.timezone || s.timezone, s.dayStartHour);
    } else if (input.localDate) patch.localDate = input.localDate;
    if (input.category) patch.category = input.category;
    if (input.title) patch.title = input.title;
    if (input.notes !== undefined) patch.notes = input.notes;
    patch.updatedAt = new Date();
    await tx.update(meals).set(patch).where(eq(meals.id, id));
    if (input.items) {
      const keep = input.items.map((i) => i.id).filter((x): x is string => !!x);
      const existing = await tx.select({ id: mealItems.id }).from(mealItems).where(eq(mealItems.mealId, id));
      const existingIds = new Set(existing.map((e) => e.id));
      const toDelete = existing.filter((e) => !keep.includes(e.id)).map((e) => e.id);
      if (toDelete.length) await tx.delete(mealItems).where(inArray(mealItems.id, toDelete));
      for (const [i, item] of input.items.entries()) {
        if (item.id && existingIds.has(item.id)) {
          await tx.update(mealItems).set({ ...itemRow(id, item, i), updatedAt: new Date() }).where(eq(mealItems.id, item.id));
        } else {
          await tx.insert(mealItems).values(itemRow(id, item, i));
        }
      }
    }
  });
  return getMeal(db, id);
}

export async function deleteMeal(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(meals).where(eq(meals.id, id)).returning({ id: meals.id });
  if (rows.length === 0) throw notFound("Meal");
}

/** Copy a meal (all items, fresh ids) to a new time. */
export async function duplicateMeal(db: Db, id: string, opts: { eatenAt: Date; localDate?: LocalDate; category?: string; clientRequestId?: string }, s: Settings): Promise<MealView> {
  const src = await getMeal(db, id);
  const { meal } = await createMeal(
    db,
    {
      clientRequestId: opts.clientRequestId,
      eatenAt: opts.eatenAt,
      localDate: opts.localDate,
      category: opts.category ?? src.category,
      title: src.title,
      description: src.description,
      source: "copy",
      notes: null,
      imageIds: [],
      items: src.items.map((i) => ({
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
      })),
    },
    s,
  );
  return meal;
}

/** Recently logged meals with distinct titles, for one-tap re-logging. */
export async function recentMeals(db: DbOrTx, limit = 12): Promise<MealView[]> {
  const rows = await db.select().from(meals).orderBy(desc(meals.eatenAt)).limit(150);
  const seen = new Set<string>();
  const pick: Meal[] = [];
  for (const r of rows) {
    const key = r.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pick.push(r);
    if (pick.length >= limit) break;
  }
  return hydrate(db, pick);
}

export function dayTotalsFromMeals(list: MealView[]): NutrientTotals {
  return mergeTotals(list.map((m) => mealTotalsRaw(m.items)));
}
