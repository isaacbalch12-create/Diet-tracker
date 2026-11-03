import { query, route } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { ensureDefaults } from "@/lib/services/defaults";
import { getRoutineDay, slotSchema } from "@/lib/services/routines";
import { isLocalDate } from "@/lib/time";

export const GET = route<{ slot: string }>(async (req, { db, settings, today }, { slot }) => {
  await ensureDefaults(db, settings, today);
  const date = query(req).get("date") ?? today;
  if (!isLocalDate(date)) throw badRequest("Invalid date");
  return { today, ...(await getRoutineDay(db, slotSchema.parse(slot), date)) };
});
