import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { activityInputSchema, createActivity, reorderActivities, slotSchema } from "@/lib/services/routines";

export const POST = route<{ slot: string }>(async (req, { db, today }, { slot }) => ({ activity: await createActivity(db, slotSchema.parse(slot), await readJson(req, activityInputSchema), today) }));

export const PUT = route<{ slot: string }>(async (req, { db }, { slot }) => {
  const { ids } = await readJson(req, z.object({ ids: z.array(z.uuid()).max(100) }));
  await reorderActivities(db, slotSchema.parse(slot), ids);
  return { ok: true };
});
