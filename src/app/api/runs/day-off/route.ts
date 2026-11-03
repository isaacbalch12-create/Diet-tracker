import { query, readJson, route } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { clearDayOff, dayOffSchema, setDayOff } from "@/lib/services/running";
import { isLocalDate } from "@/lib/time";

export const POST = route(async (req, { db }) => ({ entry: await setDayOff(db, await readJson(req, dayOffSchema)) }));

export const DELETE = route(async (req, { db }) => {
  const date = query(req).get("date");
  if (!date || !isLocalDate(date)) throw badRequest("date is required");
  await clearDayOff(db, date);
  return { ok: true };
});
