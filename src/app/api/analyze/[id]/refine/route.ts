import { z } from "zod";
import { readJson, route } from "@/lib/api";
import type { MealDraft } from "@/lib/drafts";
import { refineAnalysis } from "@/lib/services/analysis";
import { isoInstantSchema, mealItemInputSchema, uuidSchema } from "@/lib/validation";

export const maxDuration = 300;

const draftSchema = z.object({
  title: z.string().max(200),
  suggestedCategory: z.string().max(40).nullable(),
  items: z.array(mealItemInputSchema.extend({ key: z.string().max(100) })).max(60),
  questions: z.array(z.object({ id: z.string(), question: z.string().max(300), options: z.array(z.string().max(100)) })).max(10),
  uncertaintyNotes: z.string().max(4000).nullable(),
  isFood: z.boolean(),
  model: z.string().max(100),
});

const schema = z.object({
  answers: z.array(z.object({ question: z.string().max(300), answer: z.string().trim().min(1).max(500) })).max(10),
  note: z.string().max(1000).nullable().optional(),
  currentDraft: draftSchema.nullable().optional(),
  eatenAt: isoInstantSchema.optional(),
  category: z.string().max(40).nullable().optional(),
});

export const POST = route<{ id: string }>(async (req, { db, settings }, { id }) => {
  const input = await readJson(req, schema);
  const analysis = await refineAnalysis(db, uuidSchema.parse(id), { ...input, currentDraft: (input.currentDraft as MealDraft | null | undefined) ?? null }, settings);
  return { analysis };
});
