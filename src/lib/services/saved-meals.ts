import { desc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db";
import { savedMeals, type SavedMeal, type SavedMealItem, type Settings } from "../db/schema";
import { notFound } from "../errors";
import { itemsTotals } from "../nutrition/calc";
import { knownValues } from "../nutrition/nutrients";
import type { MealItemInput } from "../validation";
import { createMeal, getMeal, totalsView, type MealView, type TotalsView } from "./meals";

export interface SavedMealView extends SavedMeal {
  totals: TotalsView;
}

function view(row: SavedMeal): SavedMealView {
  return { ...row, totals: totalsView(itemsTotals(row.items)) };
}

function toSavedItem(i: MealItemInput | MealView["items"][number]): SavedMealItem {
  return {
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    gramsPerUnit: i.gramsPerUnit,
    nutrientsPer100g: i.nutrientsPer100g,
    nutrientSource: i.nutrientSource,
    quantitySource: i.quantitySource,
    manualNutrients: i.manualNutrients,
    foodId: i.foodId,
    sourceRef: i.sourceRef,
    confidence: i.confidence,
    cookingMethod: i.cookingMethod,
    isAssumed: i.isAssumed,
    notes: i.notes,
    portions: i.portions,
  };
}

export async function listSavedMeals(db: DbOrTx): Promise<SavedMealView[]> {
  const rows = await db.select().from(savedMeals).orderBy(desc(savedMeals.useCount), desc(savedMeals.updatedAt));
  return rows.map(view);
}

export async function saveMealAsFavorite(db: DbOrTx, mealId: string, name?: string): Promise<SavedMealView> {
  const meal = await getMeal(db, mealId);
  const [row] = await db
    .insert(savedMeals)
    .values({ name: name?.trim() || meal.title, category: meal.category, items: meal.items.map(toSavedItem) })
    .returning();
  return view(row);
}

export async function createSavedMeal(db: DbOrTx, input: { name: string; category?: string | null; items: MealItemInput[] }): Promise<SavedMealView> {
  const [row] = await db
    .insert(savedMeals)
    .values({ name: input.name.trim(), category: input.category ?? null, items: input.items.map(toSavedItem) })
    .returning();
  return view(row);
}

export async function updateSavedMeal(db: DbOrTx, id: string, input: { name?: string; category?: string | null; items?: MealItemInput[] }): Promise<SavedMealView> {
  const patch: Partial<typeof savedMeals.$inferInsert> = { updatedAt: new Date() };
  if (input.name) patch.name = input.name.trim();
  if (input.category !== undefined) patch.category = input.category;
  if (input.items) patch.items = input.items.map(toSavedItem);
  const [row] = await db.update(savedMeals).set(patch).where(eq(savedMeals.id, id)).returning();
  if (!row) throw notFound("Saved meal");
  return view(row);
}

export async function deleteSavedMeal(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(savedMeals).where(eq(savedMeals.id, id)).returning({ id: savedMeals.id });
  if (rows.length === 0) throw notFound("Saved meal");
}

/** Log a saved meal. Items are copied, so editing the template later never changes this entry. */
export async function logSavedMeal(
  db: Db,
  id: string,
  opts: { eatenAt: Date; category?: string; clientRequestId?: string; servings?: number },
  s: Settings,
): Promise<MealView> {
  const [tpl] = await db.select().from(savedMeals).where(eq(savedMeals.id, id));
  if (!tpl) throw notFound("Saved meal");
  const servings = opts.servings && opts.servings > 0 ? opts.servings : 1;
  const { meal, created } = await createMeal(
    db,
    {
      clientRequestId: opts.clientRequestId,
      eatenAt: opts.eatenAt,
      category: opts.category ?? tpl.category ?? "Snack",
      title: servings === 1 ? tpl.name : `${tpl.name} ×${servings}`,
      description: null,
      source: "saved_meal",
      notes: null,
      imageIds: [],
      items: tpl.items.map((i) => ({ ...i, nutrientsPer100g: knownValues(i.nutrientsPer100g), quantity: i.quantity * servings, warnings: [], aiOriginal: null })),
    },
    s,
  );
  if (created) {
    await db.update(savedMeals).set({ useCount: sql`${savedMeals.useCount} + 1`, lastUsedAt: new Date() }).where(eq(savedMeals.id, id));
  }
  return meal;
}
