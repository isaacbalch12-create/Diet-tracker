import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { logSavedMeal } from "@/lib/services/saved-meals";
import { isoInstantSchema, uuidSchema } from "@/lib/validation";

const schema = z.object({
  eatenAt: isoInstantSchema,
  category: z.string().trim().min(1).max(40).optional(),
  servings: z.number().positive().max(20).optional(),
  clientRequestId: z.string().min(8).max(100).optional(),
});

export const POST = route<{ id: string }>(async (req, { db, settings }, { id }) => {
  const input = await readJson(req, schema);
  return Response.json({ meal: await logSavedMeal(db, uuidSchema.parse(id), input, settings) }, { status: 201 });
});
