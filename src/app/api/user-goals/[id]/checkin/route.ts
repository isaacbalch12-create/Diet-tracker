import { readJson, route } from "@/lib/api";
import { checkinSchema, saveCheckin } from "@/lib/services/goals";

export const POST = route<{ id: string }>(async (req, { db, today }, { id }) => {
  await saveCheckin(db, id, await readJson(req, checkinSchema), today);
  return { ok: true };
});
