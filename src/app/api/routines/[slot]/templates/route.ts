import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { listRoutineTemplates, saveRoutineTemplate, slotSchema } from "@/lib/services/routines";

export const GET = route<{ slot: string }>(async (_req, { db }, { slot }) => ({ templates: await listRoutineTemplates(db, slotSchema.parse(slot)) }));

export const POST = route<{ slot: string }>(async (req, { db }, { slot }) => {
  const { name } = await readJson(req, z.object({ name: z.string().trim().min(1).max(80) }));
  return { template: await saveRoutineTemplate(db, slotSchema.parse(slot), name) };
});
