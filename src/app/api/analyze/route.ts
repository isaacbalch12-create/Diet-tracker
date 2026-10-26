import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { startAnalysis } from "@/lib/services/analysis";
import { isoInstantSchema, uuidSchema } from "@/lib/validation";

export const maxDuration = 300;

const schema = z
  .object({
    requestId: z.string().min(8).max(100),
    text: z.string().trim().max(4000).nullable().optional(),
    imageIds: z.array(uuidSchema).max(4).default([]),
    category: z.string().trim().max(40).nullable().optional(),
    eatenAt: isoInstantSchema.optional(),
    quickSave: z.boolean().optional(),
  })
  .refine((v) => (v.text && v.text.length > 0) || v.imageIds.length > 0, "Describe the meal or add a photo");

export const POST = route(async (req, { db, settings }) => {
  const input = await readJson(req, schema);
  return startAnalysis(db, input, settings);
});
