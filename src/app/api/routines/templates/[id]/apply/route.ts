import { route } from "@/lib/api";
import { applyRoutineTemplate } from "@/lib/services/routines";

export const POST = route<{ id: string }>(async (_req, { db, today }, { id }) => {
  await applyRoutineTemplate(db, id, today);
  return { ok: true };
});
