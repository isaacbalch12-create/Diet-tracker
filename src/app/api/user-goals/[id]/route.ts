import { readJson, route } from "@/lib/api";
import { badRequest, notFound } from "@/lib/errors";
import { deleteGoal, goalPatchSchema, goalsWithProgress, updateGoal } from "@/lib/services/goals";

const isLinked = (id: string) => id.includes(":");

export const GET = route<{ id: string }>(async (_req, { db, settings, today }, { id }) => {
  const goalId = decodeURIComponent(id);
  const [goal] = await goalsWithProgress(db, settings, today, { onlyId: goalId, full: true, includeLinked: isLinked(goalId) });
  if (!goal) throw notFound("Goal");
  return { today, goal };
});

export const PATCH = route<{ id: string }>(async (req, { db, today }, { id }) => {
  if (isLinked(decodeURIComponent(id))) throw badRequest("This goal is linked to your nutrition targets or weight settings — edit it there.");
  return { goal: await updateGoal(db, id, await readJson(req, goalPatchSchema), today) };
});

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => {
  if (isLinked(decodeURIComponent(id))) throw badRequest("This goal is linked to your nutrition targets or weight settings — clear it there.");
  await deleteGoal(db, id);
  return { ok: true };
});
