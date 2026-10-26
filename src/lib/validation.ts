import { z } from "zod";
import { isLocalDate, isValidTimeZone } from "./time";
import { NUTRIENT_KEYS } from "./nutrition/nutrients";

export const localDateSchema = z.string().refine(isLocalDate, "Expected a date like 2026-10-26");
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time like 07:30");
export const timezoneSchema = z.string().refine(isValidTimeZone, "Unknown time zone");
export const uuidSchema = z.uuid();
export const isoInstantSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const nutrientProfileSchema = z
  .partialRecord(z.enum(NUTRIENT_KEYS), z.number().min(0).max(100_000).nullable())
  .transform((p) => {
    const out: Partial<Record<(typeof NUTRIENT_KEYS)[number], number>> = {};
    for (const [k, v] of Object.entries(p)) if (typeof v === "number") out[k as (typeof NUTRIENT_KEYS)[number]] = v;
    return out;
  });

export const portionSchema = z.object({ label: z.string().min(1).max(120), grams: z.number().positive().max(10_000) });

export const mealItemInputSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(10_000),
  unit: z.string().trim().min(1).max(120),
  gramsPerUnit: z.number().positive().max(10_000),
  nutrientsPer100g: nutrientProfileSchema,
  nutrientSource: z.enum(["database", "ai_estimate", "manual"]),
  quantitySource: z.enum(["user_stated", "ai_estimate", "manual"]),
  manualNutrients: z.array(z.enum(NUTRIENT_KEYS)).default([]),
  foodId: uuidSchema.nullable().default(null),
  sourceRef: z
    .object({
      provider: z.enum(["usda", "custom"]),
      fdcId: z.string().max(40).optional(),
      dataType: z.string().max(40).optional(),
      description: z.string().max(300),
    })
    .nullable()
    .default(null),
  confidence: z.enum(["high", "medium", "low"]).nullable().default(null),
  cookingMethod: z.string().max(120).nullable().default(null),
  isAssumed: z.boolean().default(false),
  notes: z.string().max(1000).nullable().default(null),
  warnings: z.array(z.string().max(500)).max(10).default([]),
  portions: z.array(portionSchema).max(20).default([]),
  aiOriginal: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type MealItemInput = z.infer<typeof mealItemInputSchema>;

export const createMealSchema = z.object({
  clientRequestId: z.string().min(8).max(100).optional(),
  eatenAt: isoInstantSchema,
  localDate: localDateSchema.optional(),
  category: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  source: z.enum(["text", "photo", "manual", "saved_meal", "copy", "assistant"]),
  analysisId: uuidSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(mealItemInputSchema).min(1, "A meal needs at least one food").max(60),
  imageIds: z.array(uuidSchema).max(6).default([]),
});
export type CreateMealInput = z.input<typeof createMealSchema>;

export const updateMealSchema = z.object({
  eatenAt: isoInstantSchema.optional(),
  localDate: localDateSchema.optional(),
  category: z.string().trim().min(1).max(40).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(mealItemInputSchema).min(1).max(60).optional(),
});

export const weightInputSchema = z.object({
  value: z.number().positive().max(1500),
  unit: z.enum(["kg", "lb"]),
  period: z.enum(["morning", "night"]),
  measuredAt: isoInstantSchema.optional(),
  localDate: localDateSchema.optional(),
  note: z.string().max(500).nullable().optional(),
  /** Overwrite an existing entry for the same day + period. */
  replace: z.boolean().optional(),
});

export const weightUpdateSchema = z.object({
  value: z.number().positive().max(1500).optional(),
  unit: z.enum(["kg", "lb"]).optional(),
  period: z.enum(["morning", "night"]).optional(),
  measuredAt: isoInstantSchema.optional(),
  localDate: localDateSchema.optional(),
  note: z.string().max(500).nullable().optional(),
});

const optionalPositive = z.number().positive().max(100_000).nullable().optional();

export const goalsInputSchema = z.object({
  calories: optionalPositive,
  protein: optionalPositive,
  carbs: optionalPositive,
  fat: optionalPositive,
  extra: z.partialRecord(z.enum(NUTRIENT_KEYS), z.number().positive().max(100_000)).optional(),
  /** Defaults to today; past dates are rejected so history isn't rewritten. */
  effectiveFrom: localDateSchema.optional(),
});

export const settingsInputSchema = z.object({
  weightUnit: z.enum(["kg", "lb"]).optional(),
  timezone: timezoneSchema.optional(),
  dayStartHour: z.number().int().min(0).max(6).optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  startingWeight: z.object({ value: z.number().positive().max(1500), unit: z.enum(["kg", "lb"]), date: localDateSchema.optional() }).nullable().optional(),
  targetWeight: z.object({ value: z.number().positive().max(1500), unit: z.enum(["kg", "lb"]) }).nullable().optional(),
  mealCategories: z.array(z.string().trim().min(1).max(40)).min(1).max(12).optional(),
  reminders: z.object({ enabled: z.boolean(), morning: timeSchema, night: timeSchema }).optional(),
  onboarded: z.boolean().optional(),
});

export const rangeQuerySchema = z.object({
  start: localDateSchema,
  end: localDateSchema,
});
