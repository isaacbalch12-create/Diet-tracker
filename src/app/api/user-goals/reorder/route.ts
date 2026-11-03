import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { reorderGoals } from "@/lib/services/goals";

export const POST = route(async (req, { db }) => {
  await reorderGoals(db, (await readJson(req, z.object({ ids: z.array(z.string().max(100)).max(500) }))).ids);
  return { ok: true };
});
