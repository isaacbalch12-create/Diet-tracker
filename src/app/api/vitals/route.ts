import { rangeFromQuery, readJson, route } from "@/lib/api";
import { healthOverview, manualHealthSchema, saveManualHealth } from "@/lib/services/health";

export const GET = route(async (req, { db, settings, today }) => healthOverview(db, rangeFromQuery(req, today), settings));

export const POST = route(async (req, { db, today }) => ({ value: await saveManualHealth(db, await readJson(req, manualHealthSchema), today) }));
