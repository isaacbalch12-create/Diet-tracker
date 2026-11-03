/**
 * First-run defaults for the unified app: a morning and a nightly routine
 * (stretching & mobility, reading, journaling — all editable), two starter
 * mobility routines, and a few starter goals (run every day, both routines,
 * daily reading). Created once; anything the user deletes later stays deleted.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { mobilityRoutines, routineActivities, settings as settingsTable, userGoals, type JournalPrompt, type MobilityItem, type Settings } from "../db/schema";
import type { LocalDate } from "../time";

const item = (name: string, opts: Partial<MobilityItem> = {}): MobilityItem => ({ id: randomUUID(), name, instructions: "", sets: null, reps: null, perSide: false, targetNote: "", ...opts });
const prompt = (text: string): JournalPrompt => ({ id: randomUUID(), text, enabled: true });

export const DEFAULT_MORNING_MOBILITY: Omit<MobilityItem, "id">[] = [
  { name: "Cat–cow", instructions: "On hands and knees, alternate rounding and arching the spine slowly.", sets: null, reps: 10, perSide: false, targetNote: "" },
  { name: "World's greatest stretch", instructions: "Lunge forward, place the same-side hand inside the front foot, rotate the chest and reach up.", sets: null, reps: 5, perSide: true, targetNote: "" },
  { name: "Half-kneeling hip flexor stretch", instructions: "Squeeze the glute of the back leg and shift forward gently.", sets: null, reps: null, perSide: true, targetNote: "5 slow breaths" },
  { name: "Thoracic rotations", instructions: "Side-lying or on all fours; rotate the upper back while keeping the hips still.", sets: null, reps: 8, perSide: true, targetNote: "" },
  { name: "Glute bridge", instructions: "Drive through the heels and squeeze at the top.", sets: null, reps: 12, perSide: false, targetNote: "" },
];

export const DEFAULT_NIGHT_MOBILITY: Omit<MobilityItem, "id">[] = [
  { name: "Child's pose", instructions: "Knees wide, sit back toward the heels, arms long.", sets: null, reps: null, perSide: false, targetNote: "8 slow breaths" },
  { name: "Supine spinal twist", instructions: "Lying on your back, let the knees fall to one side, shoulders down.", sets: null, reps: null, perSide: true, targetNote: "5 slow breaths" },
  { name: "Figure-4 stretch", instructions: "On your back, cross the ankle over the opposite knee and pull gently.", sets: null, reps: null, perSide: true, targetNote: "5 slow breaths" },
  { name: "Lying hamstring stretch", instructions: "Use a strap or towel; keep the knee soft.", sets: null, reps: null, perSide: true, targetNote: "5 slow breaths" },
  { name: "Legs up the wall", instructions: "Relax and breathe slowly.", sets: null, reps: null, perSide: false, targetNote: "10 slow breaths" },
];

export const DEFAULT_MORNING_PROMPTS = ["What am I grateful for this morning?", "What is the one thing that would make today a success?", "How am I feeling, physically and mentally?"];
export const DEFAULT_NIGHT_PROMPTS = ["What went well today?", "What could I have done better?", "What did I accomplish?", "What do I want to accomplish tomorrow?"];

export async function ensureDefaults(db: Db, s: Settings, today: LocalDate): Promise<boolean> {
  if (s.defaultsSeeded) return false;
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ seeded: settingsTable.defaultsSeeded }).from(settingsTable).where(eq(settingsTable.id, 1));
    if (row?.seeded) return;
    const existingActs = await tx.select({ id: routineActivities.id, slot: routineActivities.slot }).from(routineActivities);
    const [morningMob, nightMob] = await tx
      .insert(mobilityRoutines)
      .values([
        { name: "Morning mobility", slot: "morning", items: DEFAULT_MORNING_MOBILITY.map((i) => item(i.name, i)) },
        { name: "Evening wind-down stretches", slot: "night", items: DEFAULT_NIGHT_MOBILITY.map((i) => item(i.name, i)) },
      ])
      .returning();
    for (const [slot, mob, prompts] of [
      ["morning", morningMob, DEFAULT_MORNING_PROMPTS],
      ["night", nightMob, DEFAULT_NIGHT_PROMPTS],
    ] as const) {
      if (existingActs.some((a) => a.slot === slot)) continue;
      await tx.insert(routineActivities).values([
        { slot, position: 0, title: "Stretching & mobility", kind: "mobility", required: true, config: { mobilityRoutineId: mob.id }, activeFrom: today, instructions: "Work through your mobility routine. Move gently — no pain." },
        { slot, position: 1, title: "Reading", kind: "reading", required: true, targetValue: 10, targetUnit: "pages", config: {}, activeFrom: today },
        { slot, position: 2, title: slot === "morning" ? "Morning journal" : "Nightly reflection", kind: "journal", required: true, config: { prompts: prompts.map(prompt) }, activeFrom: today },
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
    await tx.update(settingsTable).set({ defaultsSeeded: true }).where(eq(settingsTable.id, 1));
  });
  return true;
}
