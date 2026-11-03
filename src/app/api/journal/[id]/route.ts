import { route } from "@/lib/api";
import { deleteJournal } from "@/lib/services/routines";

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => {
  await deleteJournal(db, id);
  return { ok: true };
});
