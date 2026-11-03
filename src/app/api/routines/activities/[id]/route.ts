import { readJson, route } from "@/lib/api";
import { activityPatchSchema, removeActivity, updateActivity } from "@/lib/services/routines";

export const PATCH = route<{ id: string }>(async (req, { db }, { id }) => ({ activity: await updateActivity(db, id, await readJson(req, activityPatchSchema)) }));

export const DELETE = route<{ id: string }>(async (_req, { db, today }, { id }) => ({ result: await removeActivity(db, id, today) }));
