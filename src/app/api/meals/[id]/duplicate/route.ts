import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { duplicateMeal } from "@/lib/services/meals";
import { isoInstantSchema, localDateSchema, uuidSchema } from "@/lib/validation";

const schema = z.object({
  eatenAt: isoInstantSchema,
  localDate: localDateSchema.optional(),
  category: z.string().trim().min(1).max(40).optional(),
  clientRequestId: z.string().min(8).max(100).optional(),
});

export const POST = route<{ id: string }>(async (req, { db, settings }, { id }) => {
  const input = await readJson(req, schema);
  return Response.json({ meal: await duplicateMeal(db, uuidSchema.parse(id), input, settings) }, { status: 201 });
});
