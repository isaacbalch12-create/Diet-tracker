import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { createCustomFood } from "@/lib/foods/repo";
import { nutrientProfileSchema } from "@/lib/validation";

const schema = z.object({
  description: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).nullable().optional(),
  servingGrams: z.number().positive().max(5000),
  servingLabel: z.string().trim().max(80).nullable().optional(),
  nutrientsPerServing: nutrientProfileSchema.refine((p) => p.calories !== undefined, "Calories are required"),
});

export const POST = route(async (req, { db }) => {
  const input = await readJson(req, schema);
  return Response.json({ food: await createCustomFood(db, input) }, { status: 201 });
});
