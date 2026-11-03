import { readJson, route } from "@/lib/api";
import { deleteRunEntry, runPatchSchema, updateRun } from "@/lib/services/running";

export const PATCH = route<{ id: string }>(async (req, { db }, { id }) => ({ run: await updateRun(db, id, await readJson(req, runPatchSchema)) }));

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => {
  await deleteRunEntry(db, id);
  return { ok: true };
});
