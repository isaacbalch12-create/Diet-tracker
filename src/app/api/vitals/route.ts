import { rangeFromQuery, readJson, route } from "@/lib/api";
import { earliestHealthDate, healthOverview, manualHealthSchema, saveManualHealth } from "@/lib/services/health";

export const GET = route(async (req, { db, settings, today }) => healthOverview(db, rangeFromQuery(req, today, await earliestHealthDate(db)), settings, today));

export const POST = route(async (req, { db, today }) => ({ value: await saveManualHealth(db, await readJson(req, manualHealthSchema), today) }));
