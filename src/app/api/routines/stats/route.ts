import { rangeFromQuery, route } from "@/lib/api";
import { earliestRoutineDate, routineStats } from "@/lib/services/routines";

export const GET = route(async (req, { db, settings, today }) => routineStats(db, rangeFromQuery(req, today, await earliestRoutineDate(db)), settings.weekStartsOn, today));
