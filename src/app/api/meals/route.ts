import { query, readJson, route } from "@/lib/api";
import { createMeal, listMeals } from "@/lib/services/meals";
import { createMealSchema, rangeQuerySchema } from "@/lib/validation";

export const GET = route(async (req, { db, today }) => {
  const q = query(req);
  const range = rangeQuerySchema.parse({ start: q.get("start") ?? q.get("date") ?? today, end: q.get("end") ?? q.get("date") ?? today });
  return { meals: await listMeals(db, range) };
});

export const POST = route(async (req, { db, settings }) => {
  const input = await readJson(req, createMealSchema);
  const { meal, created } = await createMeal(db, input, settings);
  return Response.json({ meal, created }, { status: created ? 201 : 200 });
});
