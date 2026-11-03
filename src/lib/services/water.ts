import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db";
import { waterLogs, type Settings, type WaterLog } from "../db/schema";
import { badRequest, notFound } from "../errors";
import { addDays, logicalDate, type LocalDate } from "../time";
import { localDateSchema } from "../validation";

export const ML_PER_OZ = 29.5735295625;

export function toMl(value: number, unit: "ml" | "oz"): number {
  return unit === "oz" ? value * ML_PER_OZ : value;
}

export function fromMl(ml: number, unit: "ml" | "oz"): number {
  return unit === "oz" ? ml / ML_PER_OZ : ml;
}

export const waterInputSchema = z.object({
  clientRequestId: z.string().min(8).max(100).optional(),
  value: z.number().positive().max(10_000),
  unit: z.enum(["ml", "oz"]),
  localDate: localDateSchema.optional(),
});

export async function addWater(db: DbOrTx, input: z.infer<typeof waterInputSchema>, s: Settings, today: LocalDate): Promise<WaterLog> {
  if (input.clientRequestId) {
    const [dup] = await db.select().from(waterLogs).where(eq(waterLogs.clientRequestId, input.clientRequestId));
    if (dup) return dup;
  }
  const localDate = input.localDate ?? logicalDate(new Date(), s.timezone, s.dayStartHour);
  if (localDate > addDays(today, 1)) throw badRequest("Water can't be logged in the future.");
  const amountMl = toMl(input.value, input.unit);
  if (amountMl > 5000) throw badRequest("That's more than 5 liters in one entry — log it in smaller amounts.");
  const [row] = await db
    .insert(waterLogs)
    .values({ localDate, amountMl, inputValue: input.value, inputUnit: input.unit, clientRequestId: input.clientRequestId ?? null })
    .onConflictDoNothing({ target: waterLogs.clientRequestId })
    .returning();
  if (row) return row;
  const [dup] = await db.select().from(waterLogs).where(eq(waterLogs.clientRequestId, input.clientRequestId!));
  return dup;
}

export async function deleteWater(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(waterLogs).where(eq(waterLogs.id, id)).returning({ id: waterLogs.id });
  if (!rows.length) throw notFound("Water entry");
}

export async function listWater(db: DbOrTx, range: { start: LocalDate; end: LocalDate }): Promise<WaterLog[]> {
  return db
    .select()
    .from(waterLogs)
    .where(and(gte(waterLogs.localDate, range.start), lte(waterLogs.localDate, range.end)))
    .orderBy(asc(waterLogs.loggedAt));
}

export function dailyWater(rows: WaterLog[]): Map<LocalDate, number> {
  const map = new Map<LocalDate, number>();
  for (const r of rows) map.set(r.localDate, (map.get(r.localDate) ?? 0) + r.amountMl);
  return map;
}
