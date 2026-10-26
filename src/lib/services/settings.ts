import { asc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { DbOrTx } from "../db";
import { goals, settings, type Goal, type Settings } from "../db/schema";
import { badRequest } from "../errors";
import type { GoalVersion } from "../nutrition/goals";
import { goalForDate } from "../nutrition/goals";
import { todayIn, type LocalDate } from "../time";
import { toKg } from "../units";
import type { goalsInputSchema, settingsInputSchema } from "../validation";

/** Effective date used for the very first goal version, so it covers all earlier history. */
export const FIRST_GOAL_DATE = "2000-01-01";

export async function getSettings(db: DbOrTx): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  const [created] = await db.select().from(settings).where(eq(settings.id, 1));
  return created;
}

export function settingsToday(s: Pick<Settings, "timezone" | "dayStartHour">, now = new Date()): LocalDate {
  return todayIn(s.timezone, s.dayStartHour, now);
}

export async function updateSettings(db: DbOrTx, input: z.infer<typeof settingsInputSchema>): Promise<Settings> {
  const current = await getSettings(db);
  const patch: Partial<typeof settings.$inferInsert> = {};
  if (input.weightUnit) patch.weightUnit = input.weightUnit;
  if (input.timezone) patch.timezone = input.timezone;
  if (input.dayStartHour !== undefined) patch.dayStartHour = input.dayStartHour;
  if (input.weekStartsOn !== undefined) patch.weekStartsOn = input.weekStartsOn;
  if (input.startingWeight === null) {
    patch.startingWeightKg = null;
    patch.startingWeightDate = null;
  } else if (input.startingWeight) {
    patch.startingWeightKg = toKg(input.startingWeight.value, input.startingWeight.unit);
    patch.startingWeightDate = input.startingWeight.date ?? current.startingWeightDate ?? settingsToday(current);
  }
  if (input.targetWeight === null) patch.targetWeightKg = null;
  else if (input.targetWeight) patch.targetWeightKg = toKg(input.targetWeight.value, input.targetWeight.unit);
  if (input.mealCategories) {
    const unique = [...new Map(input.mealCategories.map((c) => [c.toLowerCase(), c])).values()];
    patch.mealCategories = unique;
  }
  if (input.reminders) patch.reminders = input.reminders;
  if (input.onboarded !== undefined) patch.onboarded = input.onboarded;
  if (Object.keys(patch).length === 0) return current;
  const [row] = await db.update(settings).set(patch).where(eq(settings.id, 1)).returning();
  return row;
}

export function toGoalVersion(g: Goal): GoalVersion {
  return { effectiveFrom: g.effectiveFrom, calories: g.calories, protein: g.protein, carbs: g.carbs, fat: g.fat, extra: g.extra ?? {} };
}

export async function listGoals(db: DbOrTx): Promise<Goal[]> {
  return db.select().from(goals).orderBy(asc(goals.effectiveFrom));
}

export async function goalsForDate(db: DbOrTx, date: LocalDate): Promise<Goal | null> {
  return goalForDate(await listGoals(db), date);
}

/**
 * Save new goals. They take effect from today (or a future date); the previous
 * version keeps applying to earlier days so past adherence is never rewritten.
 */
export async function setGoals(db: DbOrTx, input: z.infer<typeof goalsInputSchema>, today: LocalDate): Promise<Goal> {
  const existing = await listGoals(db);
  let effectiveFrom = input.effectiveFrom ?? today;
  if (effectiveFrom < today) throw badRequest("Goals can only take effect today or later, so past days keep the goals they had.");
  if (existing.length === 0) effectiveFrom = FIRST_GOAL_DATE;
  const values = {
    calories: input.calories ?? null,
    protein: input.protein ?? null,
    carbs: input.carbs ?? null,
    fat: input.fat ?? null,
    extra: input.extra ?? {},
  };
  const [row] = await db
    .insert(goals)
    .values({ effectiveFrom, ...values })
    .onConflictDoUpdate({ target: goals.effectiveFrom, set: { ...values, updatedAt: new Date() } })
    .returning();
  return row;
}
