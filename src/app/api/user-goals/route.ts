import { readJson, route } from "@/lib/api";
import { ensureDefaults } from "@/lib/services/defaults";
import { createGoal, goalInputSchema, goalsWithProgress } from "@/lib/services/goals";

export const GET = route(async (_req, { db, settings, today }) => {
  await ensureDefaults(db, settings, today);
  return { today, goals: await goalsWithProgress(db, settings, today, { includeLinked: true, recent: 14 }) };
});

export const POST = route(async (req, { db, today }) => ({ goal: await createGoal(db, await readJson(req, goalInputSchema), today) }));
