/**
 * Morning and nightly routines. The two slots are fully independent: each has
 * its own activities, mobility routine, reading target and journal prompts.
 *
 * History is judged against the activities that existed on each day
 * (`activeFrom` / `archivedOn`), so changing a routine never rewrites past
 * completion percentages. No timers anywhere: completion is a checkbox, a count
 * (pages, reps, rounds) or a journal entry.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "../db";
import {
  journalEntries,
  mobilityRoutines,
  routineActivities,
  routineLogs,
  routineTemplates,
  type JournalEntry,
  type MobilityRoutine,
  type RoutineActivity,
  type RoutineLog,
  type RoutineSlot,
  type RoutineTemplateActivity,
} from "../db/schema";
import { badRequest, notFound } from "../errors";
import { addDays, eachDate, monthKey, startOfWeek, type LocalDate } from "../time";
import { localDateSchema } from "../validation";

export const slotSchema = z.enum(["morning", "night"]);

const promptSchema = z.object({ id: z.string().min(1).max(60), text: z.string().trim().min(1).max(300), enabled: z.boolean() });

export const activityInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  kind: z.enum(["mobility", "reading", "journal", "checklist", "count"]),
  required: z.boolean().default(true),
  targetValue: z.number().positive().max(100_000).nullable().default(null),
  targetUnit: z.string().trim().max(30).nullable().default(null),
  instructions: z.string().max(2000).nullable().default(null),
  config: z
    .object({
      mobilityRoutineId: z.uuid().nullable().optional(),
      prompts: z.array(promptSchema).max(20).optional(),
    })
    .default({}),
});
export const activityPatchSchema = activityInputSchema.partial();

export const logInputSchema = z.object({
  localDate: localDateSchema,
  activityId: z.uuid(),
  completed: z.boolean(),
  value: z.number().min(0).max(100_000).nullable().optional(),
  details: z
    .object({
      done: z.array(z.string().max(60)).max(100).optional(),
      title: z.string().max(200).nullable().optional(),
      note: z.string().max(1000).nullable().optional(),
    })
    .optional(),
});

const mobilityItemSchema = z.object({
  id: z.string().min(1).max(60).optional(),
  name: z.string().trim().min(1).max(100),
  instructions: z.string().max(2000).default(""),
  sets: z.number().int().min(1).max(50).nullable().default(null),
  reps: z.number().int().min(1).max(500).nullable().default(null),
  perSide: z.boolean().default(false),
  targetNote: z.string().max(120).default(""),
});

export const mobilityInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slot: slotSchema.nullable().default(null),
  items: z.array(mobilityItemSchema).max(60),
});

export const journalInputSchema = z.object({
  localDate: localDateSchema,
  slot: slotSchema,
  body: z.string().max(50_000).default(""),
  answers: z.array(z.object({ promptId: z.string().max(60), prompt: z.string().max(300), answer: z.string().max(10_000) })).max(20).default([]),
});

// ---------------------------------------------------------------------------

function activeOn(a: RoutineActivity, date: LocalDate): boolean {
  return a.activeFrom <= date && (!a.archivedOn || a.archivedOn > date);
}

export async function listActivities(db: DbOrTx, slot?: RoutineSlot, opts: { includeArchived?: boolean } = {}): Promise<RoutineActivity[]> {
  const conds = [];
  if (slot) conds.push(eq(routineActivities.slot, slot));
  if (!opts.includeArchived) conds.push(isNull(routineActivities.archivedOn));
  return db
    .select()
    .from(routineActivities)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(routineActivities.slot), asc(routineActivities.position));
}

export interface DayProgress {
  required: number;
  done: number;
  optionalDone: number;
  pct: number | null;
  complete: boolean;
}

export function dayProgress(activities: RoutineActivity[], logs: RoutineLog[], date: LocalDate): DayProgress {
  const active = activities.filter((a) => activeOn(a, date));
  const doneIds = new Set(logs.filter((l) => l.localDate === date && l.completed).map((l) => l.activityId));
  const req = active.filter((a) => a.required);
  const done = req.filter((a) => doneIds.has(a.id)).length;
  const optionalDone = active.filter((a) => !a.required && doneIds.has(a.id)).length;
  return { required: req.length, done, optionalDone, pct: req.length ? done / req.length : null, complete: req.length > 0 && done === req.length };
}

/** Everything the routine screen needs for one slot and day. */
export async function getRoutineDay(db: DbOrTx, slot: RoutineSlot, date: LocalDate) {
  const all = await listActivities(db, slot, { includeArchived: true });
  const current = all.filter((a) => !a.archivedOn);
  // Show what was active that day (for past days), otherwise the current routine.
  const shown = all.filter((a) => activeOn(a, date)).length ? all.filter((a) => activeOn(a, date)) : current;
  const [logs, mobility, [entry]] = await Promise.all([
    db.select().from(routineLogs).where(and(eq(routineLogs.localDate, date), eq(routineLogs.slot, slot))),
    db.select().from(mobilityRoutines).orderBy(asc(mobilityRoutines.name)),
    db.select().from(journalEntries).where(and(eq(journalEntries.localDate, date), eq(journalEntries.slot, slot))),
  ]);
  const mobilityById = new Map(mobility.map((m) => [m.id, m]));
  return {
    slot,
    date,
    activities: shown.map((a) => ({
      ...a,
      log: logs.find((l) => l.activityId === a.id) ?? null,
      mobility: a.config.mobilityRoutineId ? (mobilityById.get(a.config.mobilityRoutineId) ?? null) : null,
    })),
    progress: dayProgress(all, logs, date),
    journal: entry ?? null,
    mobilityRoutines: mobility,
  };
}

async function validateConfig(db: DbOrTx, config: z.infer<typeof activityInputSchema>["config"] | undefined) {
  if (config?.mobilityRoutineId) {
    const [m] = await db.select({ id: mobilityRoutines.id }).from(mobilityRoutines).where(eq(mobilityRoutines.id, config.mobilityRoutineId));
    if (!m) throw badRequest("That mobility routine no longer exists.");
  }
}

export async function createActivity(db: DbOrTx, slot: RoutineSlot, input: z.infer<typeof activityInputSchema>, today: LocalDate): Promise<RoutineActivity> {
  await validateConfig(db, input.config);
  const current = await listActivities(db, slot);
  const [row] = await db
    .insert(routineActivities)
    .values({ slot, position: current.length ? Math.max(...current.map((a) => a.position)) + 1 : 0, ...input, config: input.config ?? {}, activeFrom: today })
    .returning();
  return row;
}

export async function updateActivity(db: DbOrTx, id: string, input: z.infer<typeof activityPatchSchema>): Promise<RoutineActivity> {
  await validateConfig(db, input.config);
  const [cur] = await db.select().from(routineActivities).where(eq(routineActivities.id, id));
  if (!cur) throw notFound("Activity");
  const patch: Partial<typeof routineActivities.$inferInsert> = { ...input };
  if (input.config) patch.config = { ...cur.config, ...input.config };
  const [row] = await db.update(routineActivities).set(patch).where(eq(routineActivities.id, id)).returning();
  return row;
}

/** Remove an activity: deleted outright if it was never logged, otherwise archived so history stays intact. */
export async function removeActivity(db: DbOrTx, id: string, today: LocalDate): Promise<"deleted" | "archived"> {
  const [cur] = await db.select().from(routineActivities).where(eq(routineActivities.id, id));
  if (!cur) throw notFound("Activity");
  const [logged] = await db.select({ id: routineLogs.id }).from(routineLogs).where(and(eq(routineLogs.activityId, id), lte(routineLogs.localDate, addDays(today, -1)))).limit(1);
  if (!logged) {
    await db.delete(routineActivities).where(eq(routineActivities.id, id));
    return "deleted";
  }
  await db.update(routineActivities).set({ archivedOn: today }).where(eq(routineActivities.id, id));
  return "archived";
}

export async function reorderActivities(db: Db, slot: RoutineSlot, ids: string[]): Promise<void> {
  const current = await listActivities(db, slot);
  if (ids.length !== current.length || !current.every((a) => ids.includes(a.id))) throw badRequest("Send every current activity id for this routine, in the new order.");
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) await tx.update(routineActivities).set({ position: i }).where(eq(routineActivities.id, id));
  });
}

export async function logActivity(db: DbOrTx, input: z.infer<typeof logInputSchema>, today: LocalDate): Promise<RoutineLog> {
  if (input.localDate > addDays(today, 1)) throw badRequest("Routines can't be logged for future days.");
  const [a] = await db.select().from(routineActivities).where(eq(routineActivities.id, input.activityId));
  if (!a) throw notFound("Activity");
  const now = new Date();
  // Reaching a numeric target (e.g. pages) counts as complete.
  const value = input.value ?? null;
  const completed = input.completed || (value != null && a.targetValue != null && value >= a.targetValue);
  const values = { completed, value, details: input.details ?? {}, completedAt: completed ? now : null };
  const [row] = await db
    .insert(routineLogs)
    .values({ localDate: input.localDate, activityId: a.id, slot: a.slot, ...values })
    .onConflictDoUpdate({ target: [routineLogs.localDate, routineLogs.activityId], set: { ...values, updatedAt: now } })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Mobility routines

function normalizeItems(items: z.infer<typeof mobilityInputSchema>["items"]) {
  return items.map((i) => ({ ...i, id: i.id ?? randomUUID() }));
}

export async function listMobility(db: DbOrTx): Promise<MobilityRoutine[]> {
  return db.select().from(mobilityRoutines).orderBy(asc(mobilityRoutines.name));
}

export async function saveMobility(db: DbOrTx, input: z.infer<typeof mobilityInputSchema>, id?: string): Promise<MobilityRoutine> {
  const values = { name: input.name, slot: input.slot, items: normalizeItems(input.items) };
  if (id) {
    const [row] = await db.update(mobilityRoutines).set(values).where(eq(mobilityRoutines.id, id)).returning();
    if (!row) throw notFound("Mobility routine");
    return row;
  }
  const [row] = await db.insert(mobilityRoutines).values(values).returning();
  return row;
}

export async function deleteMobility(db: DbOrTx, id: string): Promise<void> {
  const acts = await db.select().from(routineActivities).where(isNull(routineActivities.archivedOn));
  const users = acts.filter((a) => a.config.mobilityRoutineId === id);
  if (users.length) throw badRequest(`It's used by: ${users.map((a) => `${a.slot} · ${a.title}`).join(", ")}. Pick a different mobility routine there first.`);
  const rows = await db.delete(mobilityRoutines).where(eq(mobilityRoutines.id, id)).returning({ id: mobilityRoutines.id });
  if (!rows.length) throw notFound("Mobility routine");
}

// ---------------------------------------------------------------------------
// Templates

export async function listRoutineTemplates(db: DbOrTx, slot: RoutineSlot) {
  return db.select().from(routineTemplates).where(eq(routineTemplates.slot, slot)).orderBy(desc(routineTemplates.updatedAt));
}

export async function saveRoutineTemplate(db: DbOrTx, slot: RoutineSlot, name: string): Promise<typeof routineTemplates.$inferSelect> {
  const acts = await listActivities(db, slot);
  if (!acts.length) throw badRequest("Add at least one activity before saving a template.");
  const activities: RoutineTemplateActivity[] = acts.map((a) => ({ title: a.title, kind: a.kind, required: a.required, targetValue: a.targetValue, targetUnit: a.targetUnit, instructions: a.instructions, config: a.config }));
  const [row] = await db.insert(routineTemplates).values({ slot, name: name.trim(), activities }).returning();
  return row;
}

export async function deleteRoutineTemplate(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(routineTemplates).where(eq(routineTemplates.id, id)).returning({ id: routineTemplates.id });
  if (!rows.length) throw notFound("Template");
}

/** Replace a slot's routine with a template from today on. Past days keep the activities they had. */
export async function applyRoutineTemplate(db: Db, id: string, today: LocalDate): Promise<void> {
  const [t] = await db.select().from(routineTemplates).where(eq(routineTemplates.id, id));
  if (!t) throw notFound("Template");
  const mobilityIds = new Set((await listMobility(db)).map((m) => m.id));
  await db.transaction(async (tx) => {
    for (const a of await listActivities(tx, t.slot)) await removeActivity(tx, a.id, today);
    await tx.insert(routineActivities).values(
      t.activities.map((a, i) => ({
        slot: t.slot,
        position: i,
        title: a.title,
        kind: a.kind,
        required: a.required,
        targetValue: a.targetValue,
        targetUnit: a.targetUnit,
        instructions: a.instructions,
        config: { ...a.config, mobilityRoutineId: a.config.mobilityRoutineId && mobilityIds.has(a.config.mobilityRoutineId) ? a.config.mobilityRoutineId : null },
        activeFrom: today,
      })),
    );
  });
}

// ---------------------------------------------------------------------------
// Journal

/** Save a journal entry; writing something also ticks off that routine's journaling activity. */
export async function saveJournal(db: DbOrTx, input: z.infer<typeof journalInputSchema>, today: LocalDate): Promise<JournalEntry> {
  if (input.localDate > addDays(today, 1)) throw badRequest("Journal entries can't be written for future days.");
  const answers = input.answers.filter((a) => a.answer.trim());
  const now = new Date();
  const [row] = await db
    .insert(journalEntries)
    .values({ localDate: input.localDate, slot: input.slot, body: input.body, answers })
    .onConflictDoUpdate({ target: [journalEntries.localDate, journalEntries.slot], set: { body: input.body, answers, updatedAt: now } })
    .returning();
  const hasContent = input.body.trim().length > 0 || answers.length > 0;
  if (hasContent) {
    const acts = (await listActivities(db, input.slot, { includeArchived: true })).filter((a) => a.kind === "journal" && activeOn(a, input.localDate));
    for (const a of acts) {
      await db
        .insert(routineLogs)
        .values({ localDate: input.localDate, activityId: a.id, slot: a.slot, completed: true, completedAt: now })
        .onConflictDoUpdate({ target: [routineLogs.localDate, routineLogs.activityId], set: { completed: true, completedAt: now, updatedAt: now } });
    }
  }
  return row;
}

export async function deleteJournal(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(journalEntries).where(eq(journalEntries.id, id)).returning({ id: journalEntries.id });
  if (!rows.length) throw notFound("Journal entry");
}

export async function listJournal(db: DbOrTx, opts: { start?: LocalDate; end?: LocalDate; slot?: RoutineSlot; q?: string; limit?: number }): Promise<JournalEntry[]> {
  const conds = [];
  if (opts.start) conds.push(gte(journalEntries.localDate, opts.start));
  if (opts.end) conds.push(lte(journalEntries.localDate, opts.end));
  if (opts.slot) conds.push(eq(journalEntries.slot, opts.slot));
  if (opts.q?.trim()) conds.push(or(ilike(journalEntries.body, `%${opts.q.trim().replace(/[%_]/g, "")}%`))!);
  return db
    .select()
    .from(journalEntries)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(journalEntries.localDate), asc(journalEntries.slot))
    .limit(opts.limit ?? 200);
}

// ---------------------------------------------------------------------------
// Statistics

export async function loadRoutineData(db: DbOrTx, range: { start: LocalDate; end: LocalDate }) {
  const [activities, logs, journal] = await Promise.all([
    listActivities(db, undefined, { includeArchived: true }),
    db.select().from(routineLogs).where(and(gte(routineLogs.localDate, range.start), lte(routineLogs.localDate, range.end))),
    db.select({ localDate: journalEntries.localDate, slot: journalEntries.slot, body: journalEntries.body, answers: journalEntries.answers }).from(journalEntries).where(and(gte(journalEntries.localDate, range.start), lte(journalEntries.localDate, range.end))),
  ]);
  return { activities, logs, journal };
}

export type RoutineData = Awaited<ReturnType<typeof loadRoutineData>>;

export interface RoutineDayStat {
  date: LocalDate;
  morning: DayProgress;
  night: DayProgress;
  readingValue: number;
  journaled: { morning: boolean; night: boolean };
  mobility: { morning: boolean; night: boolean };
}

export function routineDays(data: RoutineData, range: { start: LocalDate; end: LocalDate }): RoutineDayStat[] {
  const bySlot = (slot: RoutineSlot) => data.activities.filter((a) => a.slot === slot);
  const kindDone = (date: LocalDate, slot: RoutineSlot, kind: string) =>
    data.logs.some((l) => l.localDate === date && l.slot === slot && l.completed && data.activities.find((a) => a.id === l.activityId)?.kind === kind);
  return eachDate(range.start, range.end).map((date) => {
    const reading = data.logs
      .filter((l) => l.localDate === date && data.activities.find((a) => a.id === l.activityId)?.kind === "reading")
      .reduce((s, l) => s + (l.value ?? 0), 0);
    const journaled = (slot: RoutineSlot) => data.journal.some((j) => j.localDate === date && j.slot === slot && (j.body.trim() || j.answers.length)) || kindDone(date, slot, "journal");
    return {
      date,
      morning: dayProgress(bySlot("morning"), data.logs, date),
      night: dayProgress(bySlot("night"), data.logs, date),
      readingValue: reading,
      journaled: { morning: journaled("morning"), night: journaled("night") },
      mobility: { morning: kindDone(date, "morning", "mobility"), night: kindDone(date, "night", "mobility") },
    };
  });
}

export async function routineStats(db: DbOrTx, range: { start: LocalDate; end: LocalDate }, weekStartsOn: number, today: LocalDate) {
  const data = await loadRoutineData(db, range);
  const days = routineDays(data, range).filter((d) => d.date <= today);
  const summarize = (slot: RoutineSlot) => {
    // Today counts only once it's complete, so an unfinished day in progress never lowers the rate.
    const relevant = days.filter((d) => d[slot].required > 0 && (d.date < today || d[slot].complete));
    const complete = relevant.filter((d) => d[slot].complete).length;
    const avgPct = relevant.length ? relevant.reduce((a, d) => a + (d[slot].pct ?? 0), 0) / relevant.length : null;
    let current = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      if (d.date === today && !d[slot].complete) continue;
      if (d[slot].required === 0) continue;
      if (d[slot].complete) current += 1;
      else break;
    }
    let longest = 0;
    let run = 0;
    for (const d of days) {
      if (d[slot].required === 0) continue;
      if (d[slot].complete) longest = Math.max(longest, ++run);
      else if (d.date !== today) run = 0;
    }
    const group = (key: (d: LocalDate) => string) => {
      const m = new Map<string, { days: number; complete: number; pctSum: number }>();
      for (const d of relevant) {
        const k = key(d.date);
        const v = m.get(k) ?? { days: 0, complete: 0, pctSum: 0 };
        v.days += 1;
        if (d[slot].complete) v.complete += 1;
        v.pctSum += d[slot].pct ?? 0;
        m.set(k, v);
      }
      return [...m.entries()].sort().map(([start, v]) => ({ start, days: v.days, complete: v.complete, completionPct: v.complete / v.days, avgPct: v.pctSum / v.days }));
    };
    const activityRates = data.activities
      .filter((a) => a.slot === slot)
      .map((a) => {
        const eligible = days.filter((d) => activeOn(a, d.date) && d.date < today).map((d) => d.date);
        const doneDates = new Set(data.logs.filter((l) => l.activityId === a.id && l.completed).map((l) => l.localDate));
        const done = eligible.filter((d) => doneDates.has(d)).length;
        return { id: a.id, title: a.title, kind: a.kind, required: a.required, archived: !!a.archivedOn, eligibleDays: eligible.length, doneDays: done, rate: eligible.length ? done / eligible.length : null };
      })
      .filter((a) => a.eligibleDays > 0 || !a.archived);
    return { trackedDays: relevant.length, completeDays: complete, completionPct: relevant.length ? complete / relevant.length : null, avgPct, streak: { current, longest }, weekly: group((d) => startOfWeek(d, weekStartsOn)), monthly: group(monthKey), activities: activityRates };
  };
  return {
    range,
    days,
    morning: summarize("morning"),
    night: summarize("night"),
    reading: { total: days.reduce((a, d) => a + d.readingValue, 0), days: days.filter((d) => d.readingValue > 0).length },
    journaling: { days: days.filter((d) => d.journaled.morning || d.journaled.night).length, morning: days.filter((d) => d.journaled.morning).length, night: days.filter((d) => d.journaled.night).length },
  };
}

export async function activitiesByIds(db: DbOrTx, ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(routineActivities).where(inArray(routineActivities.id, ids));
}
