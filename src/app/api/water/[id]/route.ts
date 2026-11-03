import { route } from "@/lib/api";
import { deleteWater } from "@/lib/services/water";

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => {
  await deleteWater(db, id);
  return { ok: true };
});
