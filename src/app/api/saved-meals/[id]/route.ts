import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { deleteSavedMeal, updateSavedMeal } from "@/lib/services/saved-meals";
import { mealItemInputSchema, uuidSchema } from "@/lib/validation";

type P = { id: string };

export const PATCH = route<P>(async (req, { db }, { id }) => {
  const input = await readJson(req, z.object({ name: z.string().trim().min(1).max(200).optional(), category: z.string().max(40).nullable().optional(), items: z.array(mealItemInputSchema).min(1).max(60).optional() }));
  return { savedMeal: await updateSavedMeal(db, uuidSchema.parse(id), input) };
});

export const DELETE = route<P>(async (_req, { db }, { id }) => {
  await deleteSavedMeal(db, uuidSchema.parse(id));
  return { ok: true };
});
