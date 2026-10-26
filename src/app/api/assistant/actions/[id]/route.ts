import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { resolveAction } from "@/lib/services/assistant-actions";
import { uuidSchema } from "@/lib/validation";

export const POST = route<{ id: string }>(async (req, { db, settings, today }, { id }) => {
  const { decision } = await readJson(req, z.object({ decision: z.enum(["confirm", "dismiss"]) }));
  return { action: await resolveAction(db, uuidSchema.parse(id), decision, settings, today) };
});
