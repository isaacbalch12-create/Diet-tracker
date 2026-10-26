import { and, asc, eq, gte, lte, min } from "drizzle-orm";
import type { z } from "zod";
import type { DbOrTx } from "../db";
import { weightEntries, type Settings, type WeightEntry } from "../db/schema";
import { AppError, notFound } from "../errors";
import { addDays, eachDate, type LocalDate, weightLocalDate } from "../time";
import { toKg } from "../units";
import type { weightInputSchema, weightUpdateSchema } from "../validation";
import {
  buildDailyMap,
  dailySeries,
  linearTrend,
  missingEntries,
  monthlyAverages,
  rollingAverage,
  summarizeWeights,
  weeklyAverages,
} from "../weight/stats";

export async function listWeights(db: DbOrTx, range?: { start?: LocalDate; end?: LocalDate }): Promise<WeightEntry[]> {
  const conds = [];
  if (range?.start) conds.push(gte(weightEntries.localDate, range.start));
  if (range?.end) conds.push(lte(weightEntries.localDate, range.end));
  return db
    .select()
    .from(weightEntries)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(weightEntries.localDate), asc(weightEntries.period));
}

export async function earliestWeightDate(db: DbOrTx): Promise<LocalDate | null> {
  const [row] = await db.select({ d: min(weightEntries.localDate) }).from(weightEntries);
  return row?.d ?? null;
}

export async function createWeight(db: DbOrTx, input: z.infer<typeof weightInputSchema>, s: Settings, now = new Date()): Promise<WeightEntry> {
  const measuredAt = input.measuredAt ?? now;
  const localDate = input.localDate ?? weightLocalDate(measuredAt, s.timezone, input.period, s.dayStartHour);
  const values = {
    localDate,
    period: input.period,
    measuredAt,
    timezone: s.timezone,
    weightKg: toKg(input.value, input.unit),
    inputValue: input.value,
    inputUnit: input.unit,
    note: input.note ?? null,
  };
  const [existing] = await db
    .select()
    .from(weightEntries)
    .where(and(eq(weightEntries.localDate, localDate), eq(weightEntries.period, input.period)));
  if (existing) {
    if (!input.replace) {
      throw new AppError(409, "weight_exists", `A ${input.period} weight is already logged for ${localDate}. Edit it or choose replace.`, { existing });
    }
    const [row] = await db.update(weightEntries).set(values).where(eq(weightEntries.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(weightEntries).values(values).returning();
  return row;
}

export async function updateWeight(db: DbOrTx, id: string, input: z.infer<typeof weightUpdateSchema>): Promise<WeightEntry> {
  const [current] = await db.select().from(weightEntries).where(eq(weightEntries.id, id));
  if (!current) throw notFound("Weight entry");
  const patch: Partial<typeof weightEntries.$inferInsert> = {};
  if (input.value !== undefined || input.unit !== undefined) {
    const value = input.value ?? current.inputValue;
    const unit = input.unit ?? current.inputUnit;
    patch.weightKg = toKg(value, unit);
    patch.inputValue = value;
    patch.inputUnit = unit;
  }
  if (input.period) patch.period = input.period;
  if (input.measuredAt) patch.measuredAt = input.measuredAt;
  if (input.localDate) patch.localDate = input.localDate;
  if (input.note !== undefined) patch.note = input.note;
  const targetDate = patch.localDate ?? current.localDate;
  const targetPeriod = patch.period ?? current.period;
  if (targetDate !== current.localDate || targetPeriod !== current.period) {
    const [clash] = await db
      .select({ id: weightEntries.id })
      .from(weightEntries)
      .where(and(eq(weightEntries.localDate, targetDate), eq(weightEntries.period, targetPeriod)));
    if (clash) throw new AppError(409, "weight_exists", `There is already a ${targetPeriod} weight on ${targetDate}.`);
  }
  const [row] = await db.update(weightEntries).set(patch).where(eq(weightEntries.id, id)).returning();
  return row;
}

export async function deleteWeight(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(weightEntries).where(eq(weightEntries.id, id)).returning({ id: weightEntries.id });
  if (rows.length === 0) throw notFound("Weight entry");
}

/** Everything the weight page and the assistant need for a date range. */
export async function weightOverview(db: DbOrTx, range: { start: LocalDate; end: LocalDate }, s: Settings, today: LocalDate) {
  // Load 30 days before the range so rolling averages are complete at its start,
  // and everything up to today for headline changes.
  const all = await listWeights(db, { start: addDays(range.start, -40), end: today > range.end ? today : range.end });
  const readings = all.map((w) => ({ localDate: w.localDate, period: w.period, weightKg: w.weightKg }));
  const map = buildDailyMap(readings);
  const days = dailySeries(readings, range.start, range.end);
  const rolling = rollingAverage(map, eachDate(range.start, range.end));
  const trend = linearTrend(days);
  const fullHistory = await listWeights(db, { end: today });
  const summary = summarizeWeights(
    fullHistory.map((w) => ({ localDate: w.localDate, period: w.period, weightKg: w.weightKg })),
    today,
    { startingWeightKg: s.startingWeightKg, targetWeightKg: s.targetWeightKg },
  );
  return {
    range,
    days: days.map((d, i) => ({
      ...d,
      rolling7: rolling[i].value,
      trend: trend ? trend.valueAt(d.date) : null,
    })),
    weekly: weeklyAverages(days, s.weekStartsOn),
    monthly: monthlyAverages(days),
    trend: trend ? { slopePerWeek: trend.slopePerWeek, r2: trend.r2, n: trend.n } : null,
    summary,
    missing: missingEntries(readings, range.start, range.end < today ? range.end : today),
    entries: all.filter((w) => w.localDate >= range.start && w.localDate <= range.end).reverse(),
    loggedDays: days.filter((d) => d.average !== null).length,
    totalDays: days.length,
  };
}
