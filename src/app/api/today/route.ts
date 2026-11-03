import { query, route } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { todayOverview } from "@/lib/services/today";
import { isLocalDate } from "@/lib/time";

export const GET = route(async (req, { db, settings, today }) => {
  const date = query(req).get("date") ?? today;
  if (!isLocalDate(date)) throw badRequest("Invalid date");
  return todayOverview(db, settings, today, date);
});
