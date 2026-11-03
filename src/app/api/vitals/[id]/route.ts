import { route } from "@/lib/api";
import { deleteHealthValue } from "@/lib/services/health";

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => {
  await deleteHealthValue(db, id);
  return { ok: true };
});
