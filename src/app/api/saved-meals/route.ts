import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { createSavedMeal, listSavedMeals } from "@/lib/services/saved-meals";
import { mealItemInputSchema } from "@/lib/validation";

export const GET = route(async (_req, { db }) => ({ savedMeals: await listSavedMeals(db) }));

export const POST = route(async (req, { db }) => {
  const input = await readJson(req, z.object({ name: z.string().trim().min(1).max(200), category: z.string().max(40).nullable().optional(), items: z.array(mealItemInputSchema).min(1).max(60) }));
  return Response.json({ savedMeal: await createSavedMeal(db, input) }, { status: 201 });
});
