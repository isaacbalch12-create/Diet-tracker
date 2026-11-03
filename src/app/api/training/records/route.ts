import { query, rangeFromQuery, route } from "@/lib/api";
import { earliestWorkoutDate, trainingRecords } from "@/lib/services/training";

export const GET = route(async (req, { db, settings, today }) => {
  const all = query(req).get("range") === "all" || (!query(req).get("range") && !query(req).get("start"));
  const range = all ? null : rangeFromQuery(req, today, await earliestWorkoutDate(db));
  return trainingRecords(db, settings, range);
});
