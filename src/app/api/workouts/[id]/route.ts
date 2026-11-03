import { readJson, route } from "@/lib/api";
import { deleteWorkout, getWorkout, saveWorkout, workoutDocSchema } from "@/lib/services/training";

export const GET = route<{ id: string }>(async (_req, { db, settings }, { id }) => ({ workout: await getWorkout(db, id, settings) }));

export const PUT = route<{ id: string }>(async (req, { db, today }, { id }) => ({ workout: await saveWorkout(db, id, await readJson(req, workoutDocSchema), today) }));

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => {
  await deleteWorkout(db, id);
  return { ok: true };
});
