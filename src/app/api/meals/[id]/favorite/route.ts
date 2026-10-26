import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { saveMealAsFavorite } from "@/lib/services/saved-meals";
import { uuidSchema } from "@/lib/validation";

export const POST = route<{ id: string }>(async (req, { db }, { id }) => {
  const { name } = await readJson(req, z.object({ name: z.string().trim().max(200).optional() }));
  return Response.json({ savedMeal: await saveMealAsFavorite(db, uuidSchema.parse(id), name) }, { status: 201 });
});
