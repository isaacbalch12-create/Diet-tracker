import { rangeFromQuery, route } from "@/lib/api";
import { routineStats } from "@/lib/services/routines";

export const GET = route(async (req, { db, settings, today }) => routineStats(db, rangeFromQuery(req, today), settings.weekStartsOn, today));
