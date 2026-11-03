import { readJson, route } from "@/lib/api";
import { deleteMobility, mobilityInputSchema, saveMobility } from "@/lib/services/routines";

export const PUT = route<{ id: string }>(async (req, { db }, { id }) => ({ routine: await saveMobility(db, await readJson(req, mobilityInputSchema), id) }));

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => {
  await deleteMobility(db, id);
  return { ok: true };
});
