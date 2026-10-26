import { query, route } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { daySummary } from "@/lib/services/stats";
import { isLocalDate } from "@/lib/time";

export const GET = route(async (req, { db, today }) => {
  const date = query(req).get("date") ?? today;
  if (!isLocalDate(date)) throw badRequest("Invalid date");
  return { today, ...(await daySummary(db, date)) };
});
