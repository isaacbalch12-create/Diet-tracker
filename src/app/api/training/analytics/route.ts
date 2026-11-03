import { rangeFromQuery, route } from "@/lib/api";
import { earliestWorkoutDate, trainingAnalytics } from "@/lib/services/training";

export const GET = route(async (req, { db, settings, today }) => trainingAnalytics(db, settings, rangeFromQuery(req, today, await earliestWorkoutDate(db), "90d"), today));
