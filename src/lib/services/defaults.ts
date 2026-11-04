/**
 * First-run defaults for the unified app: a morning and a nightly routine
 * (stretching & mobility, reading, journaling, hygiene — all editable), one
 * shared daily mobility routine, and a few starter goals (run every day, both
 * routines, daily reading). Created once; anything the user deletes later stays
 * deleted. When the defaults change, `DEFAULTS_VERSION` is bumped and existing
 * accounts get a one-time, non-destructive upgrade.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { mobilityRoutines, routineActivities, settings as settingsTable, userGoals, type JournalPrompt, type MobilityItem, type RoutineSlot, type Settings } from "../db/schema";
import type { LocalDate } from "../time";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Bump when the defaults below change; `upgradeDefaults` brings older accounts up to date. */
export const DEFAULTS_VERSION = 2;

const item = (name: string, opts: Partial<MobilityItem> = {}): MobilityItem => ({ id: randomUUID(), name, instructions: "", sets: null, reps: null, perSide: false, targetNote: "", ...opts });
const prompt = (text: string): JournalPrompt => ({ id: randomUUID(), text, enabled: true });

/** Durations are labels only — the app never runs timers. */
export const DAILY_MOBILITY_NAME = "Daily mobility";
export const DAILY_MOBILITY: Omit<MobilityItem, "id">[] = [
  { name: "Cat-Cow", instructions: "On hands and knees, alternate rounding and arching the spine slowly.", sets: null, reps: null, perSide: false, targetNote: "45 seconds" },
  { name: "Pigeon Stretch", instructions: "Front shin across the body, back leg long; fold forward gently.", sets: null, reps: null, perSide: true, targetNote: "45 seconds" },
  { name: "90/90 Hip Rotations", instructions: "Seated with both knees bent at 90°, rotate the knees side to side.", sets: null, reps: null, perSide: false, targetNote: "1 minute" },
  { name: "Kneeling Hip Flexor Stretch", instructions: "Squeeze the glute of the back leg and shift forward gently.", sets: null, reps: null, perSide: true, targetNote: "30 seconds" },
  { name: "Deep Squat Hold", instructions: "Feet about shoulder-width, sink the hips low, chest up.", sets: null, reps: null, perSide: false, targetNote: "1 minute" },
  { name: "Lying Upper Hovers", instructions: "", sets: null, reps: null, perSide: false, targetNote: "1 minute" },
  { name: "Toe Touches", instructions: "Soft knees, hinge at the hips and reach toward the toes.", sets: null, reps: null, perSide: false, targetNote: "45 seconds" },
];

/** Names of the mobility routines created by version 1 of the defaults. */
const V1_MOBILITY_NAMES = ["Morning mobility", "Evening wind-down stretches"];

export const HYGIENE_INSTRUCTIONS: Record<RoutineSlot, string> = {
  morning: "Brush teeth, wash face, deodorant.",
  night: "Brush and floss teeth, wash face.",
};

const hygieneActivity = (slot: RoutineSlot, position: number, today: LocalDate) => ({
  slot,
  position,
  title: "Hygiene",
  kind: "checklist" as const,
  required: true,
  config: {},
  activeFrom: today,
  instructions: HYGIENE_INSTRUCTIONS[slot],
});

export const DEFAULT_MORNING_PROMPTS = ["What am I grateful for this morning?", "What is the one thing that would make today a success?", "How am I feeling, physically and mentally?"];
export const DEFAULT_NIGHT_PROMPTS = ["What went well today?", "What could I have done better?", "What did I accomplish?", "What do I want to accomplish tomorrow?"];

export async function ensureDefaults(db: Db, s: Settings, today: LocalDate): Promise<boolean> {
  // Wait for onboarding: until the time zone is chosen, "today" may be a different calendar day.
  if (!s.onboarded) return false;
  if (s.defaultsSeeded) return s.defaultsVersion < DEFAULTS_VERSION ? upgradeDefaults(db, today) : false;
  let seeded = false;
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ seeded: settingsTable.defaultsSeeded }).from(settingsTable).where(eq(settingsTable.id, 1));
    if (row?.seeded) return;
    const existingActs = await tx.select({ id: routineActivities.id, slot: routineActivities.slot }).from(routineActivities);
    const [mob] = await tx.insert(mobilityRoutines).values({ name: DAILY_MOBILITY_NAME, slot: null, items: DAILY_MOBILITY.map((i) => item(i.name, i)) }).returning();
    for (const [slot, prompts] of [
      ["morning", DEFAULT_MORNING_PROMPTS],
      ["night", DEFAULT_NIGHT_PROMPTS],
    ] as const) {
      if (existingActs.some((a) => a.slot === slot)) continue;
      await tx.insert(routineActivities).values([
        { slot, position: 0, title: "Stretching & mobility", kind: "mobility", required: true, config: { mobilityRoutineId: mob.id }, activeFrom: today, instructions: "Work through your mobility routine. Move gently — no pain." },
        { slot, position: 1, title: "Reading", kind: "reading", required: true, targetValue: 10, targetUnit: "pages", config: {}, activeFrom: today },
        { slot, position: 2, title: slot === "morning" ? "Morning journal" : "Nightly reflection", kind: "journal", required: true, config: { prompts: prompts.map(prompt) }, activeFrom: today },
        hygieneActivity(slot, 3, today),
      ]);
    }
    const goals = await tx.select({ metric: userGoals.metric, params: userGoals.params }).from(userGoals);
    const has = (metric: string, slot?: string) => goals.some((g) => g.metric === metric && (!slot || g.params.slot === slot));
    const starter: (typeof userGoals.$inferInsert)[] = [];
    const base = (title: string, category: (typeof userGoals.$inferInsert)["category"], metric: string, unit: string, target: number, params: Record<string, unknown> = {}, notes: string | null = null) => ({
      title,
      category,
      metric,
      unit,
      params,
      comparator: "at_least" as const,
      targetValue: target,
      period: "daily" as const,
      startDate: today,
      targetHistory: [{ from: today, value: target, max: null }],
      notes,
    });
    if (!has("run_completed")) starter.push({ ...base("Run every day", "running", "run_completed", "days", 1, {}, "Mark planned rest or recovery days on the Running page — they never break your streak."), position: 0 });
    if (!has("routine_completion", "morning")) starter.push({ ...base("Complete my morning routine", "routine", "routine_completion", "fraction", 1, { slot: "morning" }), position: 1 });
    if (!has("routine_completion", "night")) starter.push({ ...base("Complete my nightly routine", "routine", "routine_completion", "fraction", 1, { slot: "night" }), position: 2 });
    if (!has("reading")) starter.push({ ...base("Read 20 pages a day", "routine", "reading", "pages", 20, { slot: "any", agg: "sum" }), position: 3 });
    if (starter.length) await tx.insert(userGoals).values(starter);
    await tx.update(settingsTable).set({ defaultsSeeded: true, defaultsVersion: DEFAULTS_VERSION }).where(eq(settingsTable.id, 1));
    seeded = true;
  });
  return seeded;
}

/** One-time upgrade of an existing account to the current defaults. Never deletes anything. */
async function upgradeDefaults(db: Db, today: LocalDate): Promise<boolean> {
  let upgraded = false;
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ version: settingsTable.defaultsVersion }).from(settingsTable).where(eq(settingsTable.id, 1));
    if (!row || row.version >= DEFAULTS_VERSION) return;
    if (row.version < 2) await upgradeToV2(tx, today);
    await tx.update(settingsTable).set({ defaultsVersion: DEFAULTS_VERSION }).where(eq(settingsTable.id, 1));
    upgraded = true;
  });
  return upgraded;
}

/**
 * v2: one shared mobility routine for both slots, plus a Hygiene check-off in
 * each routine. Mobility activities the user pointed at their own routine are
 * left alone; the old default routines stay in the library. Hygiene starts
 * today, so past days keep the activities they had.
 */
async function upgradeToV2(tx: Tx, today: LocalDate): Promise<void> {
  const acts = await tx.select().from(routineActivities).where(isNull(routineActivities.archivedOn));
  const mobs = await tx.select({ id: mobilityRoutines.id, name: mobilityRoutines.name }).from(mobilityRoutines);
  const nameOf = new Map(mobs.map((m) => [m.id, m.name]));
  const relink = acts.filter((a) => {
    if (a.kind !== "mobility") return false;
    const linked = a.config.mobilityRoutineId ? nameOf.get(a.config.mobilityRoutineId) : undefined;
    return linked == null || V1_MOBILITY_NAMES.includes(linked);
  });
  if (relink.length) {
    let dailyId = mobs.find((m) => m.name === DAILY_MOBILITY_NAME)?.id;
    if (!dailyId) {
      const [created] = await tx.insert(mobilityRoutines).values({ name: DAILY_MOBILITY_NAME, slot: null, items: DAILY_MOBILITY.map((i) => item(i.name, i)) }).returning({ id: mobilityRoutines.id });
      dailyId = created.id;
    }
    for (const a of relink) {
      await tx
        .update(routineActivities)
        .set({ config: { ...a.config, mobilityRoutineId: dailyId } })
        .where(and(eq(routineActivities.id, a.id), isNull(routineActivities.archivedOn)));
    }
  }
  for (const slot of ["morning", "night"] as const) {
    const inSlot = acts.filter((a) => a.slot === slot);
    // An emptied routine was the user's choice; a routine that already has hygiene needs nothing.
    if (!inSlot.length || inSlot.some((a) => a.title.trim().toLowerCase() === "hygiene")) continue;
    await tx.insert(routineActivities).values(hygieneActivity(slot, Math.max(...inSlot.map((a) => a.position)) + 1, today));
  }
}
