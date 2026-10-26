import { route } from "@/lib/api";
import { discardAnalysis } from "@/lib/services/analysis";
import { uuidSchema } from "@/lib/validation";

export const POST = route<{ id: string }>(async (_req, { db }, { id }) => {
  await discardAnalysis(db, uuidSchema.parse(id));
  return { ok: true };
});
