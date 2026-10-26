import { readJson, route } from "@/lib/api";
import { deleteWeight, updateWeight } from "@/lib/services/weights";
import { uuidSchema, weightUpdateSchema } from "@/lib/validation";

type P = { id: string };

export const PATCH = route<P>(async (req, { db }, { id }) => {
  const input = await readJson(req, weightUpdateSchema);
  return { entry: await updateWeight(db, uuidSchema.parse(id), input) };
});

export const DELETE = route<P>(async (_req, { db }, { id }) => {
  await deleteWeight(db, uuidSchema.parse(id));
  return { ok: true };
});
