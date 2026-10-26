import { readJson, route } from "@/lib/api";
import { deleteMeal, getMeal, updateMeal } from "@/lib/services/meals";
import { updateMealSchema, uuidSchema } from "@/lib/validation";

type P = { id: string };

export const GET = route<P>(async (_req, { db }, { id }) => ({ meal: await getMeal(db, uuidSchema.parse(id)) }));

export const PATCH = route<P>(async (req, { db, settings }, { id }) => {
  const input = await readJson(req, updateMealSchema);
  return { meal: await updateMeal(db, uuidSchema.parse(id), input, settings) };
});

export const DELETE = route<P>(async (_req, { db }, { id }) => {
  await deleteMeal(db, uuidSchema.parse(id));
  return { ok: true };
});
