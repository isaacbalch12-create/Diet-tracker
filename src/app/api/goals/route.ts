import { readJson, route } from "@/lib/api";
import { listGoals, setGoals, toGoalVersion } from "@/lib/services/settings";
import { goalsInputSchema } from "@/lib/validation";

export const GET = route(async (_req, { db }) => ({ goals: (await listGoals(db)).map(toGoalVersion) }));

export const POST = route(async (req, { db, today }) => {
  const input = await readJson(req, goalsInputSchema);
  return { goal: toGoalVersion(await setGoals(db, input, today)) };
});
