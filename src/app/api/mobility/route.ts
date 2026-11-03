import { readJson, route } from "@/lib/api";
import { listMobility, mobilityInputSchema, saveMobility } from "@/lib/services/routines";

export const GET = route(async (_req, { db }) => ({ routines: await listMobility(db) }));

export const POST = route(async (req, { db }) => ({ routine: await saveMobility(db, await readJson(req, mobilityInputSchema)) }));
