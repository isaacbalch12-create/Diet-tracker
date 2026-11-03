import { route } from "@/lib/api";
import { deleteRoutineTemplate } from "@/lib/services/routines";

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => {
  await deleteRoutineTemplate(db, id);
  return { ok: true };
});
