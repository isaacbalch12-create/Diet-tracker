import { and, asc, desc, eq, gte, lte, min, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "../db";
import { runEntries, userGoals, type RunEntry, type Settings } from "../db/schema";
import { AppError, badRequest, notFound } from "../errors";
import { runOverview, toMeters, type RunLike } from "../running/stats";
import { addDays, type LocalDate } from "../time";
import { localDateSchema } from "../validation";

const distanceSchema = z.object({ value: z.number().min(0).max(500), unit: z.enum(["mi", "km"]) }).nullable();

export const runInputSchema = z.object({
  clientRequestId: z.string().min(8).max(100).optional(),
  localDate: localDateSchema,
  distance: distanceSchema.default(null),
  runType: z.string().trim().max(40).nullable().default(null),
  effort: z.number().int().min(1).max(10).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
});

export const runPatchSchema = z.object({
  localDate: localDateSchema.optional(),
  distance: distanceSchema.optional(),
  runType: z.string().trim().max(40).nullable().optional(),
  effort: z.number().int().min(1).max(10).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const dayOffSchema = z.object({
  localDate: localDateSchema,
  kind: z.enum(["rest", "recovery"]),
  notes: z.string().max(1000).nullable().default(null),
});

export async function listRuns(db: DbOrTx, range?: { start?: LocalDate; end?: LocalDate }): Promise<RunEntry[]> {
  const conds = [];
  if (range?.start) conds.push(gte(runEntries.localDate, range.start));
  if (range?.end) conds.push(lte(runEntries.localDate, range.end));
  return db
    .select()
    .from(runEntries)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(runEntries.localDate), asc(runEntries.loggedAt));
}

export async function earliestRunDate(db: DbOrTx): Promise<LocalDate | null> {
  const [row] = await db.select({ d: min(runEntries.localDate) }).from(runEntries);
  return row?.d ?? null;
}

/**
 * Log a run. Logging a run on a day marked as rest/recovery replaces the marker
 * (you ran after all). Retried requests with the same clientRequestId return the
 * original entry.
 */
export async function createRun(db: Db, input: z.infer<typeof runInputSchema>, today: LocalDate): Promise<{ run: RunEntry; created: boolean }> {
  if (input.localDate > addDays(today, 1)) throw badRequest("Runs can't be logged in the future.");
  if (input.clientRequestId) {
    const [dup] = await db.select().from(runEntries).where(eq(runEntries.clientRequestId, input.clientRequestId));
    if (dup) return { run: dup, created: false };
  }
  const values = {
    localDate: input.localDate,
    kind: "run" as const,
    distanceM: input.distance ? toMeters(input.distance.value, input.distance.unit) : null,
    inputDistance: input.distance?.value ?? null,
    inputUnit: input.distance?.unit ?? null,
    runType: input.runType || null,
    effort: input.effort,
    notes: input.notes || null,
    clientRequestId: input.clientRequestId ?? null,
  };
  const run = await db.transaction(async (tx) => {
    await tx.delete(runEntries).where(and(eq(runEntries.localDate, input.localDate), ne(runEntries.kind, "run")));
    const rows = await tx.insert(runEntries).values(values).onConflictDoNothing({ target: runEntries.clientRequestId }).returning();
    return rows[0] ?? null;
  });
  if (!run) {
    const [dup] = await db.select().from(runEntries).where(eq(runEntries.clientRequestId, input.clientRequestId!));
    return { run: dup, created: false };
  }
  return { run, created: true };
}

export async function updateRun(db: DbOrTx, id: string, input: z.infer<typeof runPatchSchema>): Promise<RunEntry> {
  const [cur] = await db.select().from(runEntries).where(eq(runEntries.id, id));
  if (!cur || cur.kind !== "run") throw notFound("Run");
  const patch: Partial<typeof runEntries.$inferInsert> = {};
  if (input.localDate) patch.localDate = input.localDate;
  if (input.distance !== undefined) {
    patch.distanceM = input.distance ? toMeters(input.distance.value, input.distance.unit) : null;
    patch.inputDistance = input.distance?.value ?? null;
    patch.inputUnit = input.distance?.unit ?? null;
  }
  if (input.runType !== undefined) patch.runType = input.runType || null;
  if (input.effort !== undefined) patch.effort = input.effort;
  if (input.notes !== undefined) patch.notes = input.notes || null;
  const [row] = await db.update(runEntries).set(patch).where(eq(runEntries.id, id)).returning();
  return row;
}

export async function deleteRunEntry(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(runEntries).where(eq(runEntries.id, id)).returning({ id: runEntries.id });
  if (!rows.length) throw notFound("Entry");
}

/** Mark a day as a planned rest or recovery day (one per day; not allowed when a run is logged). */
export async function setDayOff(db: DbOrTx, input: z.infer<typeof dayOffSchema>): Promise<RunEntry> {
  const existing = await db.select().from(runEntries).where(eq(runEntries.localDate, input.localDate));
  if (existing.some((e) => e.kind === "run")) throw new AppError(409, "run_logged", "A run is already logged for this day. Delete it first to mark the day as rest.");
  const off = existing.find((e) => e.kind !== "run");
  if (off) {
    const [row] = await db.update(runEntries).set({ kind: input.kind, notes: input.notes }).where(eq(runEntries.id, off.id)).returning();
    return row;
  }
  const [row] = await db.insert(runEntries).values({ localDate: input.localDate, kind: input.kind, notes: input.notes }).returning();
  return row;
}

export async function clearDayOff(db: DbOrTx, localDate: LocalDate): Promise<void> {
  await db.delete(runEntries).where(and(eq(runEntries.localDate, localDate), ne(runEntries.kind, "run")));
}

/** The active "run every day" goal, if any: its minimum distance and start date shape run statistics. */
export async function dailyRunGoal(db: DbOrTx): Promise<{ id: string; minDistanceM: number | null; startDate: LocalDate } | null> {
  const [g] = await db
    .select()
    .from(userGoals)
    .where(and(eq(userGoals.metric, "run_completed"), eq(userGoals.status, "active")))
    .orderBy(desc(userGoals.createdAt))
    .limit(1);
  if (!g) return null;
  const min = typeof g.params.minDistanceM === "number" && g.params.minDistanceM > 0 ? g.params.minDistanceM : null;
  return { id: g.id, minDistanceM: min, startDate: g.startDate };
}

export function toRunLike(e: RunEntry): RunLike {
  return { id: e.id, localDate: e.localDate, kind: e.kind, distanceM: e.distanceM, effort: e.effort, runType: e.runType };
}

export async function runningOverview(db: DbOrTx, range: { start: LocalDate; end: LocalDate }, s: Settings, today: LocalDate) {
  const [entries, goal, earliest] = await Promise.all([listRuns(db, { end: range.end }), dailyRunGoal(db), earliestRunDate(db)]);
  const trackingStart = [earliest, goal?.startDate].filter((x): x is string => !!x).sort()[0] ?? null;
  const overview = runOverview(entries.map(toRunLike), range, today, { minDistanceM: goal?.minDistanceM ?? null, weekStartsOn: s.weekStartsOn, trackingStart });
  return {
    range,
    goal,
    ...overview,
    entries: entries.filter((e) => e.localDate >= range.start && e.localDate <= range.end).reverse(),
  };
}
